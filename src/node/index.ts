/**
 * elastishot/node: file, URL and folder I/O for Node. Everything here may use
 * Node built-ins; nothing here is imported by the isomorphic core.
 */
export {
  decodeImage,
  encodeJpeg,
  encodePng,
  fetchBytes,
  fetchImage,
  readBytes,
  readImageFile,
  sniffFormat,
  writeImageFile,
  type FetchedBytes,
} from './io.ts'
export {
  isRasterImage,
  isSnapshot,
  isUrl,
  resolveInput,
  type InputKind,
  type ResolveInputOptions,
  type ResolvedSide,
  type SideInput,
} from './inputs.ts'
export {
  BASELINE_FILES,
  CANDIDATE_FILES,
  SNAPSHOT_SCHEMA,
  createSnapshotMeta,
  isSnapshotDir,
  readMapFile,
  readSidecarMap,
  readSnapshotDir,
  sidecarPath,
  writeSnapshotDir,
  type SnapshotFileNames,
} from './baselines.ts'
export { ELASTISHOT_VERSION } from './version.ts'
export {
  createElastishot,
  type ApproveCallOptions,
  type ApproveResult,
  type CompareCallOptions,
  type Elastishot,
  type ElastishotOptions,
  type RunCallOptions,
  type RunResult,
  type SnapshotCallOptions,
} from './elastishot.ts'
export { htmlReporter, jsonReporter, junitReporter, markdownReporter } from './reporters.ts'
export { startStaticServer, type StaticServer, type StaticServerOptions } from './static-server.ts'
export {
  CONFIG_FILES,
  DEFAULT_VIEWPORTS,
  findConfigFile,
  loadConfig,
  resolveConfig,
  resolveTargets,
  validateConfig,
  type ElastishotConfig,
  type ReportConfigOptions,
  type ResolvedConfig,
  type ResolvedTarget,
  type TargetConfig,
  type ViewportConfig,
} from './config.ts'
