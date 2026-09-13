import { ElastishotError } from './errors.ts'
import type {
  AlignMode,
  ArtifactOptions,
  Box,
  CompareOptions,
  DiffOptions,
  FeatureOptions,
  MoveDetectionOptions,
  RegionKind,
  StructuralOptions,
  ThresholdOptions,
} from './types.ts'

export const REGION_KINDS: readonly RegionKind[] = ['added', 'removed', 'changed', 'moved']
export const ALIGN_MODES: readonly AlignMode[] = ['auto', 'similarity', 'affine', 'homography', 'none']

export interface ResolvedCompareOptions {
  workingWidth: number
  alignMode: AlignMode
  allowRotation: boolean
  features: Required<FeatureOptions>
  structural: Required<StructuralOptions>
  diff: Required<DiffOptions>
  moveDetection: Required<MoveDetectionOptions>
  ignoreRegions: Box[]
  ignoreRegionsCandidate: Box[]
  thresholds: Required<ThresholdOptions>
  artifacts: Required<ArtifactOptions>
  signal?: AbortSignal
}

export const DEFAULT_COMPARE_OPTIONS: Readonly<ResolvedCompareOptions> = Object.freeze({
  workingWidth: 1280,
  alignMode: 'auto' as AlignMode,
  allowRotation: false,
  features: { detector: 'orb' as const, nFeatures: 2000, ratio: 0.75, ransacThreshold: 3, minInliers: 12 },
  structural: {
    enabled: true,
    axis: 'rows' as const,
    stripPx: 8,
    gapOpen: 1,
    gapExtend: 0.05,
    matchThreshold: 0.7,
    splitLargeBands: true,
  },
  diff: {
    method: 'yiq' as const,
    threshold: 0.1,
    antialiasTolerance: 'auto' as const,
    mergeGapPx: 12,
    minRegionAreaPx: 24,
    maxRegions: 500,
    computeSsim: false,
  },
  moveDetection: { enabled: true, minNcc: 0.95, maxCandidates: 40 },
  ignoreRegions: [],
  ignoreRegionsCandidate: [],
  thresholds: { similarity: 0.98, failOn: [...REGION_KINDS], minRegionScore: 0.05 },
  artifacts: { diffMask: true, overlay: false, warpedCandidate: false, candidateOverlay: false },
})

function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

/**
 * Merge option layers over the defaults (later layers win, section by
 * section) and validate the result. Throws ElastishotError E_OPTIONS.
 */
export function resolveCompareOptions(...layers: Array<CompareOptions | undefined>): ResolvedCompareOptions {
  const d = DEFAULT_COMPARE_OPTIONS
  const out: ResolvedCompareOptions = {
    workingWidth: d.workingWidth,
    alignMode: d.alignMode,
    allowRotation: d.allowRotation,
    features: { ...d.features },
    structural: { ...d.structural },
    diff: { ...d.diff },
    moveDetection: { ...d.moveDetection },
    ignoreRegions: [],
    ignoreRegionsCandidate: [],
    thresholds: { ...d.thresholds, failOn: [...d.thresholds.failOn] },
    artifacts: { ...d.artifacts },
  }
  for (const layer of layers) {
    if (!layer) continue
    if (layer.workingWidth !== undefined) out.workingWidth = layer.workingWidth
    if (layer.alignMode !== undefined) out.alignMode = layer.alignMode
    if (layer.allowRotation !== undefined) out.allowRotation = layer.allowRotation
    if (layer.features) Object.assign(out.features, defined(layer.features))
    if (layer.structural) Object.assign(out.structural, defined(layer.structural))
    if (layer.diff) Object.assign(out.diff, defined(layer.diff))
    if (layer.moveDetection) Object.assign(out.moveDetection, defined(layer.moveDetection))
    if (layer.artifacts) Object.assign(out.artifacts, defined(layer.artifacts))
    if (layer.thresholds) {
      const t = defined(layer.thresholds)
      if (t.failOn) t.failOn = [...t.failOn]
      Object.assign(out.thresholds, t)
    }
    if (layer.ignoreRegions) out.ignoreRegions = layer.ignoreRegions.map((b) => ({ ...b }))
    if (layer.ignoreRegionsCandidate) out.ignoreRegionsCandidate = layer.ignoreRegionsCandidate.map((b) => ({ ...b }))
    if (layer.signal) out.signal = layer.signal
  }
  validate(out)
  return out
}

function fail(path: string, message: string): never {
  throw new ElastishotError('E_OPTIONS', `${path} ${message}`)
}

function unit(path: string, v: number): void {
  if (typeof v !== 'number' || !(v >= 0 && v <= 1)) fail(path, 'must be a number between 0 and 1')
}

function nonNegative(path: string, v: number): void {
  if (typeof v !== 'number' || !(v >= 0) || !Number.isFinite(v)) fail(path, 'must be a non-negative number')
}

function positiveInt(path: string, v: number): void {
  if (!Number.isInteger(v) || v <= 0) fail(path, 'must be a positive integer')
}

function oneOf<T>(path: string, v: T, allowed: readonly T[]): void {
  if (!allowed.includes(v)) fail(path, `must be one of ${allowed.join(', ')}`)
}

function boxes(path: string, list: Box[]): void {
  if (!Array.isArray(list)) fail(path, 'must be an array of boxes')
  list.forEach((b, i) => {
    const ok = b && [b.x, b.y, b.w, b.h].every((n) => typeof n === 'number' && Number.isFinite(n)) && b.w > 0 && b.h > 0
    if (!ok) fail(`${path}[${i}]`, 'must be { x, y, w, h } with positive w and h')
  })
}

function validate(o: ResolvedCompareOptions): void {
  if (!Number.isInteger(o.workingWidth) || o.workingWidth < 0) fail('workingWidth', 'must be a non-negative integer')
  oneOf('alignMode', o.alignMode, ALIGN_MODES)
  if (typeof o.allowRotation !== 'boolean') fail('allowRotation', 'must be a boolean')
  oneOf('features.detector', o.features.detector, ['orb', 'akaze'] as const)
  positiveInt('features.nFeatures', o.features.nFeatures)
  unit('features.ratio', o.features.ratio)
  nonNegative('features.ransacThreshold', o.features.ransacThreshold)
  positiveInt('features.minInliers', o.features.minInliers)
  oneOf('structural.axis', o.structural.axis, ['rows', 'both'] as const)
  positiveInt('structural.stripPx', o.structural.stripPx)
  nonNegative('structural.gapOpen', o.structural.gapOpen)
  nonNegative('structural.gapExtend', o.structural.gapExtend)
  unit('structural.matchThreshold', o.structural.matchThreshold)
  oneOf('diff.method', o.diff.method, ['yiq', 'gray', 'ssim'] as const)
  unit('diff.threshold', o.diff.threshold)
  if (o.diff.antialiasTolerance !== 'auto') nonNegative('diff.antialiasTolerance', o.diff.antialiasTolerance)
  nonNegative('diff.mergeGapPx', o.diff.mergeGapPx)
  nonNegative('diff.minRegionAreaPx', o.diff.minRegionAreaPx)
  positiveInt('diff.maxRegions', o.diff.maxRegions)
  unit('moveDetection.minNcc', o.moveDetection.minNcc)
  positiveInt('moveDetection.maxCandidates', o.moveDetection.maxCandidates)
  boxes('ignoreRegions', o.ignoreRegions)
  boxes('ignoreRegionsCandidate', o.ignoreRegionsCandidate)
  unit('thresholds.similarity', o.thresholds.similarity)
  unit('thresholds.minRegionScore', o.thresholds.minRegionScore)
  if (!Array.isArray(o.thresholds.failOn)) fail('thresholds.failOn', 'must be an array of region kinds')
  o.thresholds.failOn.forEach((k, i) => oneOf(`thresholds.failOn[${i}]`, k, REGION_KINDS))
}
