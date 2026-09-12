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
