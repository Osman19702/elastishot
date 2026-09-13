/**
 * Elastishot core types: the contract shared by the engine, the capture
 * adapter, the locator mapper, the reports and the viewer.
 *
 * Coordinate conventions
 * - Anything named "baseline" is in baseline image pixels.
 * - `boxCandidate` is in candidate image pixels (the candidate's own size).
 * - `alignment.transform` maps candidate pixels to baseline pixels.
 * - Band ranges are baseline pixel rows (or columns). The candidate range of
 *   a band refers to the candidate after it has been warped into baseline
 *   space, so `offset` is a shift measured in baseline pixels.
 */

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Half-open pixel range [start, end). */
export interface Range {
  start: number
  end: number
}

export type ImageFormat = 'png' | 'jpeg' | 'bitmap' | 'unknown'

export interface ImageDescriptor {
  /** Caller-supplied label, for example "baseline" or a URL. */
  id?: string
  format?: ImageFormat
  path?: string
  url?: string
  devicePixelRatio?: number
}

/** RGBA, 8 bits per channel, row-major, not premultiplied. */
export interface RasterImage {
  width: number
  height: number
  data: Uint8ClampedArray
  source?: ImageDescriptor
}

// ---------------------------------------------------------------- alignment

export type TransformKind = 'identity' | 'translation' | 'similarity' | 'affine' | 'homography'

/** 3x3 row-major homogeneous matrix [a, b, tx, c, d, ty, p, q, w]. */
export interface Transform2D {
  kind: TransformKind
  m: number[]
}

export type AlignMethod =
  | 'features-similarity'
  | 'features-affine'
  | 'features-homography'
  | 'projection'
  | 'resize'
  | 'identity'

export type BandKind = 'matched' | 'inserted' | 'deleted'

export interface Band {
  kind: BandKind
  axis: 'y' | 'x'
  /** Baseline rows; empty (start === end) for an inserted band. */
  baseline: Range
  /** Warped-candidate rows in baseline space; empty for a deleted band. */
  candidate: Range
  /** Mean strip similarity 0..1 for matched bands, 0 for gaps. */
  similarity: number
  /** candidate.start - baseline.start for matched bands. */
  offset: number
}

export interface AlignmentResult {
  method: AlignMethod
  /** Candidate pixels to baseline pixels. */
  transform: Transform2D
  /** Mean candidate-to-baseline scale (sqrt of the determinant for affine). */
  scale: number
  scaleX: number
  scaleY: number
  rotationDeg: number
  translation: Point
  keypoints: { baseline: number; candidate: number }
  matches: number
  inliers: number
  inlierRatio: number
  /** 0..1 spatial spread of the inliers over the baseline. */
  spread: number
  reprojectionRms: number
  confidence: number
  bandMap: Band[]
  columnBandMap?: Band[]
  /** Methods attempted, in order, ending with the one used. */
  fallbackChain: AlignMethod[]
}

// ------------------------------------------------------------------ regions

export type RegionKind = 'added' | 'removed' | 'changed' | 'moved'

export interface DiffRegion {
  id: string
  kind: RegionKind
  /** Baseline pixels; null for an added region (see anchorBaseline). */
  boxBaseline: Box | null
  /** Candidate pixels; null for a removed region (see anchorCandidate). */
  boxCandidate: Box | null
  /** Where an added region would sit in the baseline. */
  anchorBaseline?: Point
  /** Where a removed region would sit in the candidate. */
  anchorCandidate?: Point
  /** Severity 0..1. */
  score: number
  pixelsChanged: number
  areaFraction: number
  /** Mean normalised colour delta 0..1 over the changed pixels. */
  meanDelta: number
  ssim?: number
  confidence: number
  /** Index into alignment.bandMap that produced this region. */
  band?: number
  tags: string[]
}

// ------------------------------------------------------------------ results

export type WarningCode =
  | 'ALIGN_FEW_FEATURES'
  | 'ALIGN_FEW_INLIERS'
  | 'ALIGN_LOW_SPREAD'
  | 'ALIGN_ROTATION_SUSPECT'
  | 'ALIGN_SCALE_OUT_OF_RANGE'
  | 'ALIGN_ANISOTROPIC'
  | 'ALIGN_FALLBACK_PROJECTION'
  | 'ALIGN_FALLBACK_RESIZE'
  | 'STRUCT_WEAK_MATCH'
  | 'STRUCT_DISABLED_TOO_SMALL'
  | 'STRUCT_STRIP_ENLARGED'
  | 'DIFF_TOO_MANY_REGIONS'
  | 'DIFF_LOW_TEXTURE_NOISE'
  | 'MOVE_SEARCH_CAPPED'
  | 'IMAGE_DOWNSCALED'
  | 'JPEG_SOURCE'
  | 'ALPHA_FLATTENED'
  | 'PARTIAL_COVERAGE'
  | 'CAPTURE_ERROR_PAGE'

export interface Warning {
  code: WarningCode
  message: string
  data?: Record<string, unknown>
}

export interface CompareSummary {
  passed: boolean
  /** 0..1 */
  similarity: number
  counts: Record<RegionKind, number>
  changedPixelFraction: number
  alignMethod: AlignMethod
  scale: number
  baselineSize: Size
  candidateSize: Size
  workingScale: { baseline: number; candidate: number }
  /** Row counts in baseline pixels (inserted rows are candidate rows). */
  structural: { matchedRows: number; insertedRows: number; deletedRows: number }
  warnings: Warning[]
  timingsMs: Record<string, number>
}

export interface CompareArtifacts {
  /** Baseline-sized mask, white where pixels changed. */
  diffMask?: RasterImage
  /** Baseline with region boxes drawn. */
  overlay?: RasterImage
  /** Candidate warped into baseline space. */
  warpedCandidate?: RasterImage
  /** Candidate with region boxes drawn. */
  candidateOverlay?: RasterImage
}

export interface CompareResult {
  summary: CompareSummary
  alignment: AlignmentResult
  regions: DiffRegion[]
  artifacts: CompareArtifacts
}

// ------------------------------------------------------------------ options

export type AlignMode = 'auto' | 'similarity' | 'affine' | 'homography' | 'none'

export interface FeatureOptions {
  detector?: 'orb' | 'akaze'
  nFeatures?: number
  /** Lowe ratio test threshold. */
  ratio?: number
  /** RANSAC reprojection threshold in working pixels. */
  ransacThreshold?: number
  minInliers?: number
}

export interface StructuralOptions {
  enabled?: boolean
  axis?: 'rows' | 'both'
  stripPx?: number
  gapOpen?: number
  gapExtend?: number
  matchThreshold?: number
  splitLargeBands?: boolean
}

export interface DiffOptions {
  method?: 'yiq' | 'gray' | 'ssim'
  /** 0..1, pixelmatch-style colour distance threshold. */
  threshold?: number
  /**
   * Specks thinner than this many pixels are treated as antialiasing. 'auto'
   * (the default) uses 1 px only when the candidate had to be resampled
   * (zoom, rotation or a fallback alignment) and 0 otherwise, so a changed
   * digit in small text is never absorbed on same-scale pages.
   */
  antialiasTolerance?: number | 'auto'
  mergeGapPx?: number
  minRegionAreaPx?: number
  maxRegions?: number
  computeSsim?: boolean
}

export interface MoveDetectionOptions {
  enabled?: boolean
  minNcc?: number
  maxCandidates?: number
}

export interface ThresholdOptions {
  /** Minimum similarity to pass. */
  similarity?: number
  failOn?: RegionKind[]
  /** Regions below this score do not fail the comparison. */
  minRegionScore?: number
}

export interface ArtifactOptions {
  diffMask?: boolean
  overlay?: boolean
  warpedCandidate?: boolean
  candidateOverlay?: boolean
}

export interface CompareOptions {
  /** Downscale both images to this width before analysis; 0 keeps full size. */
  workingWidth?: number
  alignMode?: AlignMode
  allowRotation?: boolean
  features?: FeatureOptions
  structural?: StructuralOptions
  diff?: DiffOptions
  moveDetection?: MoveDetectionOptions
  /** Baseline pixels to ignore. */
  ignoreRegions?: Box[]
  /** Candidate pixels to ignore. */
  ignoreRegionsCandidate?: Box[]
  thresholds?: ThresholdOptions
  artifacts?: ArtifactOptions
  signal?: AbortSignal
}

// ------------------------------------------------------- captures and maps

export type LocatorStrategy = 'testid' | 'id' | 'role' | 'css'

export interface ElementMapEntry {
  /** Index in the elements array. */
  i: number
  /** Playwright-compatible selector. */
  locator: string
  strategy: LocatorStrategy
  tag: string
  /** Human-readable label: accessible name, own text, or tag#id. */
  name: string
  text?: string
  /** Image pixels (CSS pixels times device pixel ratio, plus scroll offset). */
  box: Box
  /** Index of the nearest included ancestor, or null. */
  parent: number | null
  /** Fixed or sticky positioned element. */
  fixed: boolean
}

export interface ElementMap {
  schema: 'elastishot.element-map/1'
  url?: string
  capturedAt: string
  viewport: Size
  dpr: number
  fullPage: boolean
  image: Size
  truncated: boolean
  elements: ElementMapEntry[]
}

export interface SnapshotMeta {
  schema: 'elastishot.snapshot/1'
  url?: string
  capturedAt: string
  viewport?: Size & { deviceScaleFactor?: number }
  dpr: number
  fullPage: boolean
  gitSha?: string
  elastishotVersion: string
  /** HTTP status of the main document when the page was captured. */
  httpStatus?: number
  /** Document title at capture time. */
  title?: string
  target?: string
  viewportName?: string
  approvedAt?: string
  approvedFrom?: string
}

export interface Snapshot {
  image: RasterImage
  /** PNG bytes when the snapshot came from a file or a capture. */
  png?: Uint8Array
  elementMap?: ElementMap | null
  meta: SnapshotMeta
}
