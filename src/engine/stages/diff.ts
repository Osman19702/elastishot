/**
 * Pixel diff of the matched bands: perceptual colour distance, antialiasing
 * cleanup, connected components, merge into regions, score.
 */
import { union } from '../../core/geometry.ts'
import type { Box } from '../../core/types.ts'
import { rowRange } from '../cv/convert.ts'
import type { DiffOutput, StructuralAlignOutput, WorkingRegion } from '../model.ts'
import { mergeBoxes } from '../pure/boxes.ts'
import { regionScore } from '../pure/scoring.ts'
import { pixelDiff } from '../pure/yiq.ts'
import type { Stage } from '../stage.ts'

interface Component {
  /** Baseline working coordinates. */
  box: Box
  /** Warped coordinates (baseline box shifted by the band offset). */
  boxWarped: Box
  band: number
  pixels: number
  deltaSum: number
}

const NOISE_FRACTION = 0.005
const NOISE_MAX_AREA = 36

function zeroBoxes(mask: Uint8Array, width: number, rows: number, boxes: Box[], rowOffset: number): void {
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x))
    const x1 = Math.min(width, Math.ceil(b.x + b.w))
    const y0 = Math.max(0, Math.floor(b.y - rowOffset))
    const y1 = Math.min(rows, Math.ceil(b.y + b.h - rowOffset))
    for (let y = y0; y < y1; y++) mask.fill(0, y * width + x0, y * width + x1)
  }
}

export const diffStage: Stage<StructuralAlignOutput, DiffOutput> = {
  name: 'diff',
  run(input, ctx) {
    const { cv, mats, options } = ctx
    const d = options.diff
    const B = input.baseline
    const W = input.warped
    const mapper = input.mapper
    const sB = B.scale
    const minArea = d.minRegionAreaPx * sB * sB
    const gap = d.mergeGapPx * sB
    const pageArea = B.width * B.height
    const ignoreB = options.ignoreRegions.map((b) => mapper.baselineOriginalToWorking(b))
    const ignoreW = options.ignoreRegionsCandidate.map((b) => mapper.candidateOriginalToWarped(b))
    const diffMask = mats.zeros(B.height, B.width, cv.CV_8UC1)
    const components: Component[] = []
    const anchor = new cv.Point(-1, -1)
    const border = cv.morphologyDefaultBorderValue()
    const k = Math.round(d.antialiasTolerance) + 1
    const openKernel = d.antialiasTolerance > 0 ? mats.track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k), anchor)) : null
    const closeKernel = mats.track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3), anchor))

    const radius = Math.round(d.antialiasTolerance)
    input.bands.forEach((band, bandIndex) => {
      if (band.kind !== 'matched') return
      const b0 = band.baseline.start
      const c0 = band.candidate.start
      const canvasRow = c0 + W.padTop
      const rows = Math.min(band.baseline.end - b0, W.height - canvasRow, B.height - b0)
      if (rows <= 0 || canvasRow < 0) return
      const width = B.width
      const rowBytes = width * 4
      const pd = ctx.time('pixelDiff', () => {
        // Views over WASM memory: take them right before use and do not allocate in between.
        const a = B.rgba.data.subarray(b0 * rowBytes, (b0 + rows) * rowBytes)
        const b = W.rgba.data.subarray(canvasRow * rowBytes, (canvasRow + rows) * rowBytes)
        const cov = W.coverage.data.subarray(canvasRow * width, (canvasRow + rows) * width)
        return pixelDiff(a, b, width, rows, d.threshold, cov, radius)
      })
      if (pd.changed === 0) return
      if (ignoreB.length) zeroBoxes(pd.mask, width, rows, ignoreB, b0)
      if (ignoreW.length) zeroBoxes(pd.mask, width, rows, ignoreW, c0)

      const maskMat = mats.fromArray(rows, width, cv.CV_8UC1, pd.mask)
      ctx.time('morphology', () => {
        if (openKernel) cv.morphologyEx(maskMat, maskMat, cv.MORPH_OPEN, openKernel, anchor, 1, cv.BORDER_CONSTANT, border)
        cv.morphologyEx(maskMat, maskMat, cv.MORPH_CLOSE, closeKernel, anchor, 1, cv.BORDER_CONSTANT, border)
      })
      const labels = mats.mat()
      const stats = mats.mat()
      const centroids = mats.mat()
      const n = ctx.time('components', () => cv.connectedComponentsWithStats(maskMat, labels, stats, centroids, 8, cv.CV_32S))
      const deltaSum = new Float64Array(n)
      const lab = labels.data32S
      for (let p = 0; p < lab.length; p++) {
        const l = lab[p]!
        if (l > 0) deltaSum[l] += pd.delta[p]!
      }
      const st = Int32Array.from(stats.data32S)
      const found: Component[] = []
      let maxArea = 0
      for (let l = 1; l < n; l++) {
        const area = st[l * 5 + cv.CC_STAT_AREA]!
        maxArea = Math.max(maxArea, area)
        if (area < minArea) continue
        const box = { x: st[l * 5 + cv.CC_STAT_LEFT]!, y: st[l * 5 + cv.CC_STAT_TOP]! + b0, w: st[l * 5 + cv.CC_STAT_WIDTH]!, h: st[l * 5 + cv.CC_STAT_HEIGHT]! }
        found.push({ box, boxWarped: { ...box, y: box.y + band.offset }, band: bandIndex, pixels: area, deltaSum: deltaSum[l]! })
      }
      const noisy = pd.changed / (width * rows) > NOISE_FRACTION && maxArea < NOISE_MAX_AREA && found.length > 0
      if (noisy) {
        ctx.warn('DIFF_LOW_TEXTURE_NOISE', 'a band differed only in scattered specks (font hinting or antialiasing); ignored', { band: bandIndex })
      } else {
        components.push(...found)
        const dst = rowRange(mats, diffMask, b0, b0 + rows)
        maskMat.copyTo(dst)
        mats.release(dst)
      }
      for (const m of [labels, stats, centroids, maskMat]) mats.release(m)
    })

    let groups = mergeBoxes(components, (c) => c.box, gap)
    const initialGroups = groups.length
    let g = gap
    for (let round = 0; groups.length > d.maxRegions && round < 3; round++) {
      g *= 2
      groups = mergeBoxes(components, (c) => c.box, g)
    }
    if (initialGroups > d.maxRegions) {
      ctx.warn('DIFF_TOO_MANY_REGIONS', `${initialGroups} changed regions found; nearby ones were merged (gap ${Math.round(g / sB)} px) and at most ${d.maxRegions} are reported`, {
        found: initialGroups,
        mergeGapPx: Math.round(g / sB),
      })
    }
    let changed: WorkingRegion[] = groups.map((group) => {
      const pixels = group.members.reduce((s, c) => s + c.pixels, 0)
      const deltaSum = group.members.reduce((s, c) => s + c.deltaSum, 0)
      const boxWarped = group.members.slice(1).reduce((b, c) => union(b, c.boxWarped), group.members[0]!.boxWarped)
      const bands = new Set(group.members.map((c) => c.band))
      const areaFraction = pixels / Math.max(1, group.box.w * group.box.h)
      const meanDelta = pixels ? deltaSum / pixels : 0
      return {
        kind: 'changed',
        boxBaseline: group.box,
        boxWarped,
        pixelsChanged: pixels,
        areaFraction,
        meanDelta,
        score: regionScore(areaFraction, meanDelta, pixels, pageArea),
        confidence: 0.5 + 0.5 * Math.min(1, meanDelta * 3),
        ...(bands.size === 1 ? { band: group.members[0]!.band } : {}),
        tags: [],
      }
    })
    if (changed.length > d.maxRegions) {
      changed = changed.sort((a, b) => b.pixelsChanged - a.pixelsChanged).slice(0, d.maxRegions)
    }
    return { ...input, regions: [...changed, ...input.gapRegions], diffMask }
  },
}
