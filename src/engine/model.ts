/**
 * Intermediate data passed between pipeline stages. Everything here is in
 * WORKING coordinates (the downscaled analysis size); the verdict stage maps
 * regions back to original pixels through the CoordinateMapper.
 */
import type { Mat3 } from '../core/geometry.ts'
import type { AlignMethod, Band, Box, Point, RasterImage, RegionKind, TransformKind } from '../core/types.ts'
import type { Mat } from './cv/cv-types.ts'
import type { CoordinateMapper } from './pure/transform.ts'

export interface Prepped {
  rgba: Mat
  gray: Mat
  grayBlur: Mat
  width: number
  height: number
  /** working / original */
  scale: number
  original: RasterImage
}

export interface PreprocessInput {
  baseline: RasterImage
  candidate: RasterImage
}

export interface PreprocessOutput {
  baseline: Prepped
  candidate: Prepped
}

/**
 * The candidate warped into baseline working space, drawn on a canvas that
 * is padded at the top by `padTop` rows so candidate content that lands
 * above the baseline's first row is kept. Canvas row = warped row + padTop;
 * warped rows are baseline-space coordinates and may be negative.
 */
export interface Warped {
  rgba: Mat
  gray: Mat
  grayBlur: Mat
  /** 8UC1, 255 where a candidate pixel exists. */
  coverage: Mat
  width: number
  /** Canvas height in rows (including the padding). */
  height: number
  padTop: number
  /** Baseline-space rows the transformed candidate spans (may exceed the baseline). */
  extent: { top: number; bottom: number }
  /** Share of the baseline area that has candidate pixels behind it. */
  coverageFraction: number
}

export interface GlobalAlignOutput extends PreprocessOutput {
  method: AlignMethod
  transformKind: TransformKind
  /** Candidate working -> baseline working. */
  transformW: Mat3
  scale: number
  scaleX: number
  scaleY: number
  rotationDeg: number
  translation: Point
  keypoints: { baseline: number; candidate: number }
  matches: number
  inliers: number
  inlierRatio: number
  spread: number
  reprojectionRms: number
  confidence: number
  fallbackChain: AlignMethod[]
  warped: Warped
  mapper: CoordinateMapper
}

/** A region before it is mapped to original coordinates. */
export interface WorkingRegion {
  kind: RegionKind
  /** Baseline working pixels; null for added. */
  boxBaseline: Box | null
  /** Warped (baseline working space) pixels; null for removed. */
  boxWarped: Box | null
  anchorBaseline?: Point
  anchorWarped?: Point
  pixelsChanged: number
  areaFraction: number
  meanDelta: number
  score: number
  confidence: number
  band?: number
  tags: string[]
}

export interface StructuralAlignOutput extends GlobalAlignOutput {
  /** Working-pixel bands in baseline space. */
  bands: Band[]
  stripPx: number
  matchedFraction: number
  edges: { baseline: Mat; warped: Mat }
  /** Added and removed regions produced from inserted and deleted bands. */
  gapRegions: WorkingRegion[]
}

export interface DiffOutput extends StructuralAlignOutput {
  /** Changed regions from matched bands plus the gap regions. */
  regions: WorkingRegion[]
  /** 8UC1 baseline working size, 255 where pixels changed. */
  diffMask: Mat
}

export interface ClassifyOutput extends DiffOutput {
  /** Regions after move detection and plugin filters. */
  classified: WorkingRegion[]
}
