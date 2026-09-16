/**
 * Map regions back to original pixels, score the whole comparison, decide
 * pass/fail and assemble the result with its artifacts.
 */
import { clampBox, decompose, makeTransform } from '../../core/geometry.ts'
import { cloneImage, strokeRect, type RGBA } from '../../core/image.ts'
import { evaluate } from '../../core/thresholds.ts'
import type { AlignmentResult, Band, CompareArtifacts, CompareResult, DiffRegion, RegionKind, Warning } from '../../core/types.ts'
import { matToImage, rowRange } from '../cv/convert.ts'
import type { ClassifyOutput, WorkingRegion } from '../model.ts'
import { similarityScore } from '../pure/scoring.ts'
import type { Stage } from '../stage.ts'

export const REGION_COLOURS: Record<RegionKind, RGBA> = {
  added: [34, 197, 94, 255],
  removed: [239, 68, 68, 255],
  changed: [217, 70, 239, 255],
  moved: [59, 130, 246, 255],
}

const WHITESPACE_WEIGHT = 0.25
const MOVED_WEIGHT = 0.25

function toOriginal(r: WorkingRegion, input: ClassifyOutput): DiffRegion {
  const { mapper } = input
  const B = input.baseline.original
  const C = input.candidate.original
  const sB = input.baseline.scale
  const region: DiffRegion = {
    id: '',
    kind: r.kind,
    boxBaseline: null,
    boxCandidate: null,
    score: r.score,
    pixelsChanged: Math.round(r.pixelsChanged / (sB * sB)),
    areaFraction: r.areaFraction,
    meanDelta: r.meanDelta,
    confidence: r.confidence,
    tags: r.tags,
  }
  if (r.boxBaseline) {
    const b = mapper.baselineWorkingToOriginal(r.boxBaseline)
    region.boxBaseline = clampBox(b, B) ?? b
  }
  if (r.boxWarped) {
    const c = mapper.warpedToCandidateOriginal(r.boxWarped)
    region.boxCandidate = clampBox(c, C) ?? c
  }
  if (r.anchorBaseline) region.anchorBaseline = mapper.pointBaselineWorkingToOriginal(r.anchorBaseline)
  if (r.anchorWarped) region.anchorCandidate = mapper.pointWarpedToCandidateOriginal(r.anchorWarped)
  if (r.band !== undefined) region.band = r.band
  return region
}

function sortKey(r: DiffRegion): [number, number] {
  if (r.boxBaseline) return [r.boxBaseline.y, r.boxBaseline.x]
  if (r.anchorBaseline) return [r.anchorBaseline.y, r.anchorBaseline.x]
  return [Number.MAX_SAFE_INTEGER, 0]
}

/** Working-pixel weight of a region towards the changed-pixel fraction. */
function weigh(w: WorkingRegion): { changed: number; added: number } {
  const whitespace = w.tags.includes('whitespace-only') ? WHITESPACE_WEIGHT : 1
  switch (w.kind) {
    case 'changed':
      return { changed: w.pixelsChanged, added: 0 }
    case 'removed':
      return { changed: w.boxBaseline ? w.boxBaseline.w * w.boxBaseline.h * whitespace : 0, added: 0 }
    case 'moved':
      return { changed: w.boxBaseline ? w.boxBaseline.w * w.boxBaseline.h * MOVED_WEIGHT : 0, added: 0 }
    case 'added':
      return { changed: 0, added: w.boxWarped ? w.boxWarped.w * w.boxWarped.h * whitespace : 0 }
  }
}

function dedupeWarnings(warnings: Warning[]): Warning[] {
  const seen = new Set<string>()
  return warnings.filter((w) => {
    const key = `${w.code}:${w.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const verdictStage: Stage<ClassifyOutput, CompareResult> = {
  name: 'verdict',
  run(input, ctx) {
    const { cv, mats, options } = ctx
    const B = input.baseline
    const C = input.candidate
    const W = input.warped
    const sB = B.scale
    const pageArea = B.width * B.height

    let pairs = input.classified.map((w) => ({ w, r: toOriginal(w, input) }))
    for (const filter of ctx.regionFilters) pairs = pairs.filter((p) => filter(p.r))
    pairs.sort((a, b) => {
      const [ay, ax] = sortKey(a.r)
      const [by, bx] = sortKey(b.r)
      return ay - by || ax - bx
    })
    pairs.forEach((p, i) => (p.r.id = `r${i + 1}`))
    const regions = pairs.map((p) => p.r)

    let changedPx = 0
    let addedPx = 0
    for (const { w } of pairs) {
      const weight = weigh(w)
      changedPx += weight.changed
      addedPx += weight.added
    }
    const changedPixelFraction = (changedPx + addedPx) / (pageArea + addedPx)
    // A fallback alignment (edge profiles, plain resize) can never claim a perfect
    // match; a feature-based one is trusted whatever its inlier ratio.
    const trusted = input.method.startsWith('features') || input.method === 'identity'
    const similarity = similarityScore(changedPixelFraction, trusted ? 1 : input.confidence)
    const verdict = evaluate({ summary: { similarity }, regions }, {
      threshold: options.thresholds.similarity,
      failOn: options.thresholds.failOn,
      minRegionScore: options.thresholds.minRegionScore,
    })
    const counts: Record<RegionKind, number> = { added: 0, removed: 0, changed: 0, moved: 0 }
    for (const r of regions) counts[r.kind]++

    const structural = { matchedRows: 0, insertedRows: 0, deletedRows: 0 }
    const toOriginalRows = (v: number) => Math.round(v / sB)
    const bandMap: Band[] = input.bands.map((b) => {
      const rows = b.baseline.end - b.baseline.start
      // A lane band covers part of the width: it counts for that share of a row.
      const share = b.columns ? (b.columns.end - b.columns.start) / Math.max(1, input.baseline.width) : 1
      if (b.kind === 'matched') structural.matchedRows += rows * share
      else if (b.kind === 'deleted') structural.deletedRows += rows * share
      else structural.insertedRows += (b.candidate.end - b.candidate.start) * share
      return {
        kind: b.kind,
        axis: b.axis,
        baseline: { start: toOriginalRows(b.baseline.start), end: toOriginalRows(b.baseline.end) },
        candidate: { start: toOriginalRows(b.candidate.start), end: toOriginalRows(b.candidate.end) },
        similarity: b.similarity,
        offset: toOriginalRows(b.offset),
        ...(b.columns ? { columns: { start: toOriginalRows(b.columns.start), end: toOriginalRows(b.columns.end) } } : {}),
      }
    })
    structural.matchedRows = toOriginalRows(structural.matchedRows)
    structural.insertedRows = toOriginalRows(structural.insertedRows)
    structural.deletedRows = toOriginalRows(structural.deletedRows)

    const originalM = input.mapper.originalTransform()
    const d = decompose(originalM)
    const alignment: AlignmentResult = {
      method: input.method,
      transform: makeTransform(originalM, input.transformKind),
      scale: d.scale,
      scaleX: d.scaleX,
      scaleY: d.scaleY,
      rotationDeg: d.rotationDeg,
      translation: { x: d.tx, y: d.ty },
      keypoints: input.keypoints,
      matches: input.matches,
      inliers: input.inliers,
      inlierRatio: input.inlierRatio,
      spread: input.spread,
      reprojectionRms: input.reprojectionRms / sB,
      confidence: input.confidence,
      bandMap,
      fallbackChain: input.fallbackChain,
    }

    const artifacts: CompareArtifacts = {}
    ctx.time('artifacts', () => {
      if (options.artifacts.diffMask) {
        const full = mats.mat()
        cv.resize(input.diffMask, full, new cv.Size(B.original.width, B.original.height), 0, 0, cv.INTER_NEAREST)
        artifacts.diffMask = matToImage(cv, full)
        mats.release(full)
      }
      if (options.artifacts.warpedCandidate && W.height > W.padTop) {
        const view = rowRange(mats, W.rgba, W.padTop, W.height)
        const full = mats.mat()
        cv.resize(view, full, new cv.Size(B.original.width, Math.max(1, Math.round((W.height - W.padTop) / sB))), 0, 0, cv.INTER_LINEAR)
        artifacts.warpedCandidate = matToImage(cv, full)
        mats.release(full)
        mats.release(view)
      }
      if (options.artifacts.overlay) {
        const img = cloneImage(B.original)
        for (const r of regions) if (r.boxBaseline) strokeRect(img, r.boxBaseline, REGION_COLOURS[r.kind], 2)
        artifacts.overlay = img
      }
      if (options.artifacts.candidateOverlay) {
        const img = cloneImage(C.original)
        for (const r of regions) if (r.boxCandidate) strokeRect(img, r.boxCandidate, REGION_COLOURS[r.kind], 2)
        artifacts.candidateOverlay = img
      }
    })

    const timingsMs: Record<string, number> = {}
    for (const [k, v] of Object.entries(ctx.timings)) timingsMs[k] = Math.round(v * 10) / 10

    return {
      summary: {
        passed: verdict.pass,
        similarity,
        counts,
        changedPixelFraction,
        alignMethod: input.method,
        scale: d.scale,
        baselineSize: { width: B.original.width, height: B.original.height },
        candidateSize: { width: C.original.width, height: C.original.height },
        workingScale: { baseline: B.scale, candidate: C.scale },
        structural,
        warnings: dedupeWarnings(ctx.warnings),
        timingsMs,
      },
      alignment,
      regions,
      artifacts,
    }
  },
}
