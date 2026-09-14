/**
 * Elastishot public entry (isomorphic): types, geometry, image helpers,
 * option resolution, pass/fail evaluation and the engine seam.
 *
 * Node-only pieces live behind subpath exports: elastishot/capture,
 * elastishot/node. The viewer element is elastishot/viewer.
 */
export type * from './core/types.ts'
export { ElastishotError, isElastishotError, type ErrorCode } from './core/errors.ts'
export * as geometry from './core/geometry.ts'
export {
  blit,
  cloneImage,
  createImage,
  cropImage,
  fillRect,
  flattenAlpha,
  fromRGBA,
  getPixel,
  imagesEqual,
  isOpaque,
  resizeImage,
  toGrayscale,
  type RGBA,
} from './core/image.ts'
export {
  ALIGN_MODES,
  DEFAULT_COMPARE_OPTIONS,
  REGION_KINDS,
  resolveCompareOptions,
  type ResolvedCompareOptions,
} from './core/options.ts'
export { evaluate, type EvaluateOptions, type Evaluation } from './core/thresholds.ts'
export {
  compare,
  loadEngine,
  resetDefaultEngine,
  type CompareCallOptions,
  type Engine,
  type EngineLoadOptions,
} from './core/engine-seam.ts'
export {
  comparePair,
  type CapturedHook,
  type ComparedHook,
  type ComparePairOptions,
  type PairOutcome,
  type PairSide,
  type Plugin,
  type Reporter,
  type ReporterContext,
  type ReporterOutput,
  type ReportedHook,
} from './pipeline.ts'
