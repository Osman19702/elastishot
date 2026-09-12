/**
 * Global alignment: recover one transform that maps the candidate onto the
 * baseline. ORB features + ratio test + RANSAC affine, snapped to a
 * similarity when the fit is uniform; edge-profile correlation when features
 * fail; plain resize as the last resort. Always produces a transform.
 */
import {
  applyToPoint,
  decompose,
  fromAffine,
  identity,
  multiply,
  scaling,
  toAffine,
  transformKindOf,
  translation,
  type Mat3,
} from '../../core/geometry.ts'
import type { AlignMethod, TransformKind } from '../../core/types.ts'
import type { FeatureDetector, KeyPointVector, Mat } from '../cv/cv-types.ts'
import { edgeMagnitude } from '../cv/ops.ts'
import type { GlobalAlignOutput, PreprocessOutput, Warped } from '../model.ts'
import { bestShift, colProfile, rowProfile } from '../pure/projection.ts'
import { alignmentConfidence } from '../pure/scoring.ts'
import { CoordinateMapper } from '../pure/transform.ts'
import type { Stage, StageContext } from '../stage.ts'
import { MIN_WORKING_SIDE } from './preprocess.ts'

interface Pair {
  cx: number
  cy: number
  bx: number
  by: number
}

interface Estimate {
  transform: Mat3
  kind: TransformKind
  method: AlignMethod
  keypoints: { baseline: number; candidate: number }
  matches: number
  inliers: number
  inlierRatio: number
  spread: number
  rms: number
  confidence: number
}

const SCALE_MIN = 0.15
const SCALE_MAX = 6.7
/** Canvas top padding is a multiple of this many rows. */
const PAD_GRANULARITY = 64
/** Warn when the candidate covers less than this share of the baseline. */
const COVERAGE_WARN = 0.98
const ROTATION_REJECT_DEG = 5
const ROTATION_SUSPECT_DEG = 1

interface Features {
  kps: KeyPointVector
  desc: Mat
}

function detect(ctx: StageContext, gray: Mat): Features {
  const { cv, mats, options } = ctx
  const f = options.features
  let detector: FeatureDetector | null = null
  if (f.detector === 'akaze' && cv.AKAZE) {
    try {
      detector = mats.track(new cv.AKAZE())
    } catch {
      detector = null
    }
  }
  detector ??= mats.track(new cv.ORB(f.nFeatures, 1.2, 8, 15, 0, 2, cv.ORB_HARRIS_SCORE, 31, 12))
  const kps = mats.track(new cv.KeyPointVector())
  const desc = mats.mat()
  const none = mats.mat()
  detector.detectAndCompute(gray, none, kps, desc)
  mats.release(none)
  mats.release(detector)
  return { kps, desc }
}

function matchPairs(ctx: StageContext, baseline: Features, candidate: Features): Pair[] {
  const { cv, mats, options } = ctx
  if (baseline.desc.empty() || candidate.desc.empty() || baseline.desc.rows < 2 || candidate.desc.rows < 2) return []
  const matcher = mats.track(new cv.BFMatcher(cv.NORM_HAMMING, false))
  const knn = mats.track(new cv.DMatchVectorVector())
  matcher.knnMatch(candidate.desc, baseline.desc, knn, 2)
  const pairs: Pair[] = []
  const ratio = options.features.ratio
  for (let i = 0; i < knn.size(); i++) {
    const two = knn.get(i)
    if (two.size() >= 2) {
      const m0 = two.get(0)
      const m1 = two.get(1)
      if (m0.distance < ratio * m1.distance) {
        const pc = candidate.kps.get(m0.queryIdx).pt
        const pb = baseline.kps.get(m0.trainIdx).pt
        pairs.push({ cx: pc.x, cy: pc.y, bx: pb.x, by: pb.y })
      }
    }
    two.delete()
  }
  mats.release(knn)
  mats.release(matcher)
  return pairs
}

function pointMats(ctx: StageContext, pairs: Pair[]): { src: Mat; dst: Mat } {
  const n = pairs.length
  const src = new Float32Array(n * 2)
  const dst = new Float32Array(n * 2)
  pairs.forEach((p, i) => {
    src[i * 2] = p.cx
    src[i * 2 + 1] = p.cy
    dst[i * 2] = p.bx
    dst[i * 2 + 1] = p.by
  })
  return { src: ctx.mats.fromArray(n, 1, ctx.cv.CV_32FC2, src), dst: ctx.mats.fromArray(n, 1, ctx.cv.CV_32FC2, dst) }
}

function ransac(ctx: StageContext, pairs: Pair[], homography: boolean): { m: Mat3; mask: Uint8Array } | null {
  const { cv, mats, options } = ctx
  const { src, dst } = pointMats(ctx, pairs)
  const mask = mats.mat()
  const thr = options.features.ransacThreshold
  const M = mats.track(
    homography
      ? cv.findHomography(src, dst, cv.RANSAC, thr, mask, 5000, 0.995)
      : cv.estimateAffine2D(src, dst, mask, cv.RANSAC, thr, 5000, 0.995, 10),
  )
  let result: { m: Mat3; mask: Uint8Array } | null = null
  if (!M.empty()) {
    const values = Array.from(M.data64F)
    const m = homography ? values : fromAffine(values)
    result = { m, mask: new Uint8Array(mask.data) }
  }
  for (const x of [src, dst, mask, M]) mats.release(x)
  return result
}

/** Least-squares similarity (scale, optional rotation, translation) mapping candidate points to baseline points. */
export function fitSimilarity(pairs: Pair[], allowRotation: boolean): Mat3 {
  const n = pairs.length
  if (n === 0) return identity()
  let mcx = 0
  let mcy = 0
  let mbx = 0
  let mby = 0
  for (const p of pairs) {
    mcx += p.cx
    mcy += p.cy
    mbx += p.bx
    mby += p.by
  }
  mcx /= n
  mcy /= n
  mbx /= n
  mby /= n
  let a = 0
  let b = 0
  let den = 0
  for (const p of pairs) {
    const x = p.cx - mcx
    const y = p.cy - mcy
    const u = p.bx - mbx
    const v = p.by - mby
    a += x * u + y * v
    b += x * v - y * u
    den += x * x + y * y
  }
  if (den < 1e-9) return translation(mbx - mcx, mby - mcy)
  a /= den
  b /= den
  if (!allowRotation) {
    a = Math.hypot(a, b)
    b = 0
  }
  const tx = mbx - (a * mcx - b * mcy)
  const ty = mby - (b * mcx + a * mcy)
  return [a, -b, tx, b, a, ty, 0, 0, 1]
}

function reprojectionRms(pairs: Pair[], m: Mat3): number {
  if (pairs.length === 0) return 0
  let sum = 0
  for (const p of pairs) {
    const q = applyToPoint(m, { x: p.cx, y: p.cy })
    sum += (q.x - p.bx) ** 2 + (q.y - p.by) ** 2
  }
  return Math.sqrt(sum / pairs.length)
}

/** 0..1: how evenly the inliers cover the baseline (1 = like a uniform spread). */
function spreadOf(pairs: Pair[], width: number, height: number): number {
  if (pairs.length < 2) return 0
  const std = (values: number[], norm: number) => {
    const mean = values.reduce((s, v) => s + v, 0) / values.length
    const varSum = values.reduce((s, v) => s + (v - mean) ** 2, 0)
    return Math.sqrt(varSum / values.length) / norm
  }
  const sx = std(pairs.map((p) => p.bx), width)
  const sy = std(pairs.map((p) => p.by), height)
  return Math.min(1, Math.min(sx, sy) / 0.289)
}

function featureEstimate(ctx: StageContext, input: PreprocessOutput, chain: AlignMethod[]): Estimate | null {
  const { options } = ctx
  const f = options.features
  const B = input.baseline
  const C = input.candidate
  const wantHomography = options.alignMode === 'homography'
  chain.push(wantHomography ? 'features-homography' : options.alignMode === 'affine' ? 'features-affine' : 'features-similarity')

  const fb = detect(ctx, B.gray)
  const fc = detect(ctx, C.gray)
  const keypoints = { baseline: fb.kps.size(), candidate: fc.kps.size() }
  const enough = 2 * f.minInliers
  let pairs: Pair[] = []
  if (keypoints.baseline < enough || keypoints.candidate < enough) {
    ctx.warn('ALIGN_FEW_FEATURES', `too few features for alignment (baseline ${keypoints.baseline}, candidate ${keypoints.candidate})`, keypoints)
  } else {
    pairs = matchPairs(ctx, fb, fc)
  }
  for (const x of [fb.kps, fb.desc, fc.kps, fc.desc]) ctx.mats.release(x)
  if (keypoints.baseline < enough || keypoints.candidate < enough) return null
  if (pairs.length < f.minInliers) {
    ctx.warn('ALIGN_FEW_INLIERS', `only ${pairs.length} feature matches survived the ratio test`, { matches: pairs.length })
    return null
  }

  const fit = ransac(ctx, pairs, wantHomography)
  if (!fit) {
    ctx.warn('ALIGN_FEW_INLIERS', 'RANSAC found no consistent transform', { matches: pairs.length })
    return null
  }
  const inlierPairs = pairs.filter((_, i) => fit.mask[i]! !== 0)
  const inliers = inlierPairs.length
  const inlierRatio = inliers / pairs.length
  if (inliers < f.minInliers || inlierRatio < 0.2) {
    ctx.warn('ALIGN_FEW_INLIERS', `only ${inliers} of ${pairs.length} matches agree on a transform`, { inliers, matches: pairs.length })
    return null
  }

  let m = fit.m
  let d = decompose(m)
  if (d.scale < SCALE_MIN || d.scale > SCALE_MAX || !Number.isFinite(d.scale)) {
    ctx.warn('ALIGN_SCALE_OUT_OF_RANGE', `estimated scale ${d.scale.toFixed(3)} is outside ${SCALE_MIN}..${SCALE_MAX}`, { scale: d.scale })
    return null
  }
  const rotation = Math.abs(d.rotationDeg)
  if (rotation >= ROTATION_REJECT_DEG) {
    ctx.warn('ALIGN_ROTATION_SUSPECT', `estimated rotation ${d.rotationDeg.toFixed(2)} degrees rejected; screenshots do not rotate`, { rotationDeg: d.rotationDeg })
    return null
  }
  if (rotation >= ROTATION_SUSPECT_DEG) {
    ctx.warn('ALIGN_ROTATION_SUSPECT', `estimated rotation ${d.rotationDeg.toFixed(2)} degrees${options.allowRotation ? ' kept' : ' removed'}`, { rotationDeg: d.rotationDeg })
  }

  let kind: TransformKind
  let method: AlignMethod
  if (wantHomography) {
    kind = d.perspective > 1e-3 ? 'homography' : transformKindOf(m)
    method = 'features-homography'
  } else {
    const aniso = d.scaleY === 0 ? Infinity : Math.abs(d.scaleX / d.scaleY)
    const uniform = aniso > 0.97 && aniso < 1.03 && Math.abs(d.shear) < 0.03
    if (options.alignMode === 'similarity' || (options.alignMode === 'auto' && uniform)) {
      m = fitSimilarity(inlierPairs, options.allowRotation)
      kind = transformKindOf(m, 1e-4)
      method = 'features-similarity'
    } else {
      if (aniso < 0.4 || aniso > 2.5 || Math.abs(d.shear) > 0.1) {
        ctx.warn('ALIGN_ANISOTROPIC', `candidate is stretched unevenly (x ${d.scaleX.toFixed(3)}, y ${d.scaleY.toFixed(3)}, shear ${d.shear.toFixed(3)})`, {
          scaleX: d.scaleX,
          scaleY: d.scaleY,
          shear: d.shear,
        })
      }
      kind = 'affine'
      method = 'features-affine'
    }
  }
  d = decompose(m)
  const rms = reprojectionRms(inlierPairs, m)
  const spread = spreadOf(inlierPairs, B.width, B.height)
  if (spread < 0.4) {
    ctx.warn('ALIGN_LOW_SPREAD', 'the matched features cover only a small part of the page; the alignment may not hold everywhere', { spread })
  }
  chain[chain.length - 1] = method
  return {
    transform: m,
    kind,
    method,
    keypoints,
    matches: pairs.length,
    inliers,
    inlierRatio,
    spread,
    rms,
    confidence: alignmentConfidence(inliers, inlierRatio, spread, rms),
  }
}

function projectionEstimate(ctx: StageContext, input: PreprocessOutput, chain: AlignMethod[]): Estimate | null {
  const { cv, mats } = ctx
  const B = input.baseline
  const C = input.candidate
  chain.push('projection')
  const edgeB = edgeMagnitude(ctx, B.gray)
  const rowsB = rowProfile(edgeB.data, B.width, B.height)
  const colsB = colProfile(edgeB.data, B.width, B.height)
  mats.release(edgeB)

  const hypotheses: number[] = []
  for (const s of [B.width / C.width, B.height / C.height, 1, Math.sqrt((B.width * B.height) / (C.width * C.height))]) {
    if (s < SCALE_MIN || s > SCALE_MAX) continue
    if (!hypotheses.some((h) => Math.abs(h - s) / s < 0.02)) hypotheses.push(s)
  }

  let best: { s: number; tx: number; ty: number; ncc: number } | null = null
  for (const s of hypotheses) {
    const w = Math.round(C.width * s)
    const h = Math.round(C.height * s)
    if (w < 8 || h < 8) continue
    const resized = mats.mat()
    cv.resize(C.gray, resized, new cv.Size(w, h), 0, 0, s < 1 ? cv.INTER_AREA : cv.INTER_LINEAR)
    const edgeC = edgeMagnitude(ctx, resized)
    const rowsC = rowProfile(edgeC.data, w, h)
    const colsC = colProfile(edgeC.data, w, h)
    mats.release(edgeC)
    mats.release(resized)
    const ry = bestShift(rowsB, rowsC, Math.max(h, B.height))
    const rx = bestShift(colsB, colsC, Math.max(w, B.width))
    const score = Math.min(ry.ncc, rx.ncc)
    if (!best || score > best.ncc) best = { s, tx: rx.shift, ty: ry.shift, ncc: score }
  }
  if (!best || best.ncc < 0.5) {
    ctx.warn('ALIGN_FALLBACK_PROJECTION', 'feature matching failed and edge profiles did not correlate either', { ncc: best?.ncc ?? 0 })
    return null
  }
  ctx.warn('ALIGN_FALLBACK_PROJECTION', `feature matching failed; aligned by edge profiles (correlation ${best.ncc.toFixed(2)})`, {
    ncc: best.ncc,
    scale: best.s,
  })
  const transform = multiply(translation(best.tx, best.ty), scaling(best.s))
  return {
    transform,
    kind: transformKindOf(transform, 1e-6),
    method: 'projection',
    keypoints: { baseline: 0, candidate: 0 },
    matches: 0,
    inliers: 0,
    inlierRatio: 0,
    spread: 0,
    rms: 0,
    confidence: Math.min(1, 0.3 + 0.4 * best.ncc),
  }
}

function resizeEstimate(ctx: StageContext, input: PreprocessOutput, chain: AlignMethod[]): Estimate {
  const B = input.baseline
  const C = input.candidate
  const none = ctx.options.alignMode === 'none'
  const base = { keypoints: { baseline: 0, candidate: 0 }, matches: 0, inliers: 0, inlierRatio: 0, spread: 0, rms: 0 }
  if (B.width === C.width && B.height === C.height) {
    chain.push('identity')
    return { ...base, transform: identity(), kind: 'identity', method: 'identity', confidence: none ? 1 : 0.2 }
  }
  chain.push('resize')
  if (!none) ctx.warn('ALIGN_FALLBACK_RESIZE', 'no alignment could be estimated; the candidate was simply resized onto the baseline')
  const transform = scaling(B.width / C.width, B.height / C.height)
  return { ...base, transform, kind: transformKindOf(transform, 1e-6), method: 'resize', confidence: none ? 0.5 : 0.2 }
}

function warp(ctx: StageContext, input: PreprocessOutput, m: Mat3, kind: TransformKind): Warped {
  const { cv, mats } = ctx
  const B = input.baseline
  const C = input.candidate
  const corners = [
    applyToPoint(m, { x: 0, y: 0 }),
    applyToPoint(m, { x: C.width, y: 0 }),
    applyToPoint(m, { x: 0, y: C.height }),
    applyToPoint(m, { x: C.width, y: C.height }),
  ]
  const bottom = Math.max(...corners.map((p) => p.y))
  const top = Math.min(...corners.map((p) => p.y))
  // Pad in coarse steps so the structural stage's strip grid stays in phase with the baseline's.
  const rawPad = top < -0.5 ? Math.ceil(-top) : 0
  const padCap = Math.ceil((4 * B.height) / PAD_GRANULARITY) * PAD_GRANULARITY
  const padTop = Math.min(padCap, Math.ceil(rawPad / PAD_GRANULARITY) * PAD_GRANULARITY)
  const height = padTop + Math.min(4 * B.height, Math.max(B.height, Math.ceil(bottom)))
  const width = B.width
  const size = new cv.Size(width, height)
  const rgba = mats.mat()
  const coverage = mats.mat()
  const ones = mats.mat(C.height, C.width, cv.CV_8UC1, new cv.Scalar(255))
  const white = new cv.Scalar(255, 255, 255, 255)
  const black = new cv.Scalar(0)
  const canvasM = multiply(translation(0, padTop), m)
  if (kind === 'homography') {
    const H = mats.fromArray(3, 3, cv.CV_64F, canvasM)
    cv.warpPerspective(C.rgba, rgba, H, size, cv.INTER_LINEAR, cv.BORDER_CONSTANT, white)
    cv.warpPerspective(ones, coverage, H, size, cv.INTER_LINEAR, cv.BORDER_CONSTANT, black)
    mats.release(H)
  } else {
    const A = mats.fromArray(2, 3, cv.CV_64F, toAffine(canvasM))
    cv.warpAffine(C.rgba, rgba, A, size, cv.INTER_LINEAR, cv.BORDER_CONSTANT, white)
    cv.warpAffine(ones, coverage, A, size, cv.INTER_LINEAR, cv.BORDER_CONSTANT, black)
    mats.release(A)
  }
  mats.release(ones)
  cv.threshold(coverage, coverage, 254, 255, cv.THRESH_BINARY)
  const kernel = mats.track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5), new cv.Point(-1, -1)))
  cv.morphologyEx(coverage, coverage, cv.MORPH_ERODE, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue())
  mats.release(kernel)
  const gray = mats.mat()
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY, 0)
  const grayBlur = mats.mat()
  cv.GaussianBlur(gray, grayBlur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT)

  const cov = coverage.data
  let covered = 0
  const from = padTop * width
  const to = Math.min(height, padTop + B.height) * width
  for (let i = from; i < to; i++) if (cov[i] === 255) covered++
  const coverageFraction = covered / (B.width * B.height)
  if (coverageFraction < COVERAGE_WARN) {
    ctx.warn('PARTIAL_COVERAGE', `the candidate covers only ${(coverageFraction * 100).toFixed(1)}% of the baseline after alignment; the rest is not compared`, { coverageFraction })
  }
  return { rgba, gray, grayBlur, coverage, width, height, padTop, extent: { top, bottom }, coverageFraction }
}

export const globalAlignStage: Stage<PreprocessOutput, GlobalAlignOutput> = {
  name: 'globalAlign',
  run(input, ctx) {
    const B = input.baseline
    const C = input.candidate
    const mode = ctx.options.alignMode
    const chain: AlignMethod[] = []
    const tooSmall = Math.min(B.width, B.height, C.width, C.height) < MIN_WORKING_SIDE
    let est: Estimate | null = null
    if (mode !== 'none' && !tooSmall) est = ctx.time('features', () => featureEstimate(ctx, input, chain))
    if (!est && mode !== 'none' && !tooSmall) est = ctx.time('projection', () => projectionEstimate(ctx, input, chain))
    if (!est) est = resizeEstimate(ctx, input, chain)
    const warped = ctx.time('warp', () => warp(ctx, input, est.transform, est.kind))
    const d = decompose(est.transform)
    return {
      ...input,
      method: est.method,
      transformKind: est.kind,
      transformW: est.transform,
      scale: d.scale,
      scaleX: d.scaleX,
      scaleY: d.scaleY,
      rotationDeg: d.rotationDeg,
      translation: { x: d.tx, y: d.ty },
      keypoints: est.keypoints,
      matches: est.matches,
      inliers: est.inliers,
      inlierRatio: est.inlierRatio,
      spread: est.spread,
      reprojectionRms: est.rms,
      confidence: est.confidence,
      fallbackChain: chain,
      warped,
      mapper: new CoordinateMapper(B.scale, C.scale, est.transform),
    }
  },
}
