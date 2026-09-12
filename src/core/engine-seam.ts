import type { CompareOptions, CompareResult, RasterImage } from './types.ts'

/** What the core needs from a comparison engine. The default one is opencv.js based. */
export interface Engine {
  compare(baseline: RasterImage, candidate: RasterImage, options?: CompareOptions): Promise<CompareResult>
  /** Force the WASM runtime to load now instead of on the first compare. */
  warmup(): Promise<void>
  dispose(): void
}

export interface EngineLoadOptions {
  /** A loaded opencv.js namespace, or a function that loads one (for example from a URL in the browser). */
  cv?: unknown | (() => Promise<unknown>)
  /** Options applied under every compare() call's own options. */
  defaults?: CompareOptions
}

let defaultEngine: Promise<Engine> | null = null

async function instantiate(options: EngineLoadOptions): Promise<Engine> {
  const mod = await import('../engine/index.ts')
  return mod.createEngine(options)
}

/**
 * Load the opencv.js engine. Without options this returns one shared,
 * memoised engine; with options a fresh engine is created each call.
 */
export function loadEngine(options?: EngineLoadOptions): Promise<Engine> {
  if (options) return instantiate(options)
  defaultEngine ??= instantiate({})
  return defaultEngine
}

/** Drop the memoised default engine (tests, or after dispose()). */
export function resetDefaultEngine(): void {
  defaultEngine = null
}

export interface CompareCallOptions extends CompareOptions {
  engine?: Engine | Promise<Engine>
}

/** Compare two images with the default engine or the one supplied. */
export async function compare(
  baseline: RasterImage,
  candidate: RasterImage,
  options: CompareCallOptions = {},
): Promise<CompareResult> {
  const { engine, ...rest } = options
  const e = await (engine ?? loadEngine())
  return e.compare(baseline, candidate, rest)
}
