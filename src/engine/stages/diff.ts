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
import { colorDelta, pixelDiff, YIQ_MAX_DELTA } from '../pure/yiq.ts'
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
/**
 * Density is measured over a box at least this many pixels on each side: a
 * border that moved by one pixel is a 1 px line of changed pixels, and
 * without a floor it would score as a fully changed block.
 */
const DENSITY_MIN_SIDE = 4
const SHIFTS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]
/** A component is a shift artefact when this share of its pixels matches under one 1 px shift. */
const SHIFT_EXPLAINED = 0.9
/** Mean blurred-grey difference below this over a component is edge jitter, not content. */
const BLUR_SAME = 6

/**
 * Sub-pixel text positioning and font smoothing change the edge pixels of
 * every glyph without changing what is on the page. After a small blur such
 * a component matches again; a changed glyph or a changed colour does not.
 */
function jitterOnly(blurA: ArrayLike<number>, blurB: ArrayLike<number>, lab: ArrayLike<number>, l: number, box: Box, width: number, rows: number): boolean {
  const x0 = Math.max(0, box.x)
  const y0 = Math.max(0, box.y)
  const x1 = Math.min(width, box.x + box.w)
  const y1 = Math.min(rows, box.y + box.h)
  let n = 0
  let sum = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * width + x
      if (lab[p] !== l) continue
      n++
      sum += Math.abs(blurA[p]! - blurB[p]!)
    }
  }
  return n > 0 && sum / n < BLUR_SAME
}

/**
 * True when the component `l` looks the same in both images once one of them
 * is moved by a single pixel: a column that sits 1 px further right, a line
 * rounded to the next pixel row. A changed glyph never matches under one
 * shift, so it stays. `a` and `b` are RGBA views of the band, `lab` the
 * component labels of the same band.
 */
function explainedByShift(a: ArrayLike<number>, b: ArrayLike<number>, lab: ArrayLike<number>, l: number, box: Box, width: number, rows: number, max: number): boolean {
  const x0 = Math.max(0, box.x)
  const y0 = Math.max(0, box.y)
  const x1 = Math.min(width, box.x + box.w)
  const y1 = Math.min(rows, box.y + box.h)
  for (const [dx, dy] of SHIFTS) {
    let n = 0
    let ok = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = y * width + x
        if (lab[p] !== l) continue
        n++
        const xa = x + dx
        const ya = y + dy
        const xb = x - dx
        const yb = y - dy
        if (xa < 0 || ya < 0 || xb < 0 || yb < 0 || xa >= width || xb >= width || ya >= rows || yb >= rows) continue
        if (colorDelta(a, p * 4, b, (ya * width + xa) * 4) <= max && colorDelta(b, p * 4, a, (yb * width + xb) * 4) <= max) ok++
      }
    }
    if (n && ok / n >= SHIFT_EXPLAINED) return true
  }
  return false
}

/**
 * The antialiasing tolerance exists for resampled candidates: a zoom or a
 * fallback alignment blurs every edge by a fraction of a pixel. On a
 * same-scale page the warp is an integer shift and every pixel is exact, so
 * the tolerance would only hide real changes, such as one digit in a label.
 */
export function resolveTolerance(
  setting: number | 'auto',
  input: {
    method: string
    scale: number
    rotationDeg: number
    translation: { x: number; y: number }
    baseline: { scale: number }
    candidate: { scale: number }
    bands: ReadonlyArray<{ kind: string; offset: number }>
  },
): number {
  if (setting !== 'auto') return setting
  // A zoomed candidate is downscaled to the working width by a different
  // factor than the baseline, so the working transform can look like an
  // identity while every candidate pixel was resampled.
  const sameWorkingScale = Math.abs(input.baseline.scale - input.candidate.scale) < 1e-9
  const integerShift =
    (input.method.startsWith('features') || input.method === 'identity') &&
    Math.abs(input.scale - 1) < 1e-6 &&
    Math.abs(input.rotationDeg) < 1e-6 &&
    Number.isInteger(input.translation.x) &&
    Number.isInteger(input.translation.y)
  // Below the working width a whole-pixel shift of the page is a fraction of
  // a working pixel, so only an unshifted pair is exact there.
  const unshifted = input.translation.x === 0 && input.translation.y === 0 && input.bands.every((b) => b.kind !== 'matched' || b.offset === 0)
  const exact = sameWorkingScale && integerShift && (Math.abs(input.baseline.scale - 1) < 1e-9 || unshifted)
  return exact ? 0 : 1
}

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
    const tolerance = resolveTolerance(d.antialiasTolerance, input)
    const k = Math.round(tolerance) + 1
    const openKernel = tolerance > 0 ? mats.track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k), anchor)) : null
    const closeKernel = mats.track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3), anchor))

    const radius = Math.round(tolerance)
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
      // Fresh views: no WASM allocation happens between here and the loop's end.
      const av = B.rgba.data.subarray(b0 * rowBytes, (b0 + rows) * rowBytes)
      const bv = W.rgba.data.subarray(canvasRow * rowBytes, (canvasRow + rows) * rowBytes)
      const labView = labels.data32S
      const blurA = B.grayBlur.data.subarray(b0 * width, (b0 + rows) * width)
      const blurB = W.grayBlur.data.subarray(canvasRow * width, (canvasRow + rows) * width)
      const maxDelta = YIQ_MAX_DELTA * d.threshold * d.threshold
      const found: Component[] = []
      let maxArea = 0
      for (let l = 1; l < n; l++) {
        const area = st[l * 5 + cv.CC_STAT_AREA]!
        maxArea = Math.max(maxArea, area)
        if (area < minArea) continue
        const local = { x: st[l * 5 + cv.CC_STAT_LEFT]!, y: st[l * 5 + cv.CC_STAT_TOP]!, w: st[l * 5 + cv.CC_STAT_WIDTH]!, h: st[l * 5 + cv.CC_STAT_HEIGHT]! }
        if (explainedByShift(av, bv, labView, l, local, width, rows, maxDelta)) continue
        if (radius === 0 && jitterOnly(blurA, blurB, labView, l, local, width, rows)) continue
        const box = { ...local, y: local.y + b0 }
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
      const areaFraction = pixels / Math.max(1, Math.max(group.box.w, DENSITY_MIN_SIDE) * Math.max(group.box.h, DENSITY_MIN_SIDE))
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
