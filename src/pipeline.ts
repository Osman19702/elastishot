/**
 * The comparison of one pair from images to a verdict with named locators,
 * plus the plugin and reporter contracts a larger tool can build on. This is
 * isomorphic; file and browser handling live in elastishot/node.
 */
import { loadEngine, type Engine } from './core/engine-seam.ts'
import { checkSnapshot } from './core/snapshot-check.ts'
import { evaluate } from './core/thresholds.ts'
import type { CompareOptions, CompareResult, ElementMap, RasterImage, RegionKind, Snapshot, SnapshotMeta } from './core/types.ts'
import { mapLocators, resolveIgnore, type IgnoredElement, type LocatorOptions, type LocatorReport } from './locators/index.ts'
import type { PairReport, ReportJson } from './report/schema.ts'

export interface PairSide {
  image: RasterImage
  elementMap?: ElementMap | null
  /** Where the side came from, for reports. */
  source?: string
  meta?: SnapshotMeta
}

export interface PairOutcome {
  result: CompareResult
  locators: LocatorReport
  pass: boolean
  failReasons: string[]
  /** Elements left out through `ignore`, per side. */
  ignored: IgnoredElement[]
}

export interface ComparePairOptions {
  engine?: Engine | Promise<Engine>
  compare?: CompareOptions
  locators?: LocatorOptions
  /** Minimum similarity to pass; overrides compare.thresholds.similarity. */
  threshold?: number
  failOn?: RegionKind[] | 'none'
  minRegionScore?: number
  /** Locators whose boxes in each side's element map are left out of the comparison. */
  ignore?: string[]
}

/** Compare two sides, name the regions and decide pass/fail. */
export async function comparePair(baseline: PairSide, candidate: PairSide, options: ComparePairOptions = {}): Promise<PairOutcome> {
  const engine = await (options.engine ?? loadEngine())
  const thresholds = { ...options.compare?.thresholds }
  if (options.threshold !== undefined) thresholds.similarity = options.threshold
  if (options.failOn !== undefined) thresholds.failOn = options.failOn === 'none' ? [] : options.failOn
  if (options.minRegionScore !== undefined) thresholds.minRegionScore = options.minRegionScore
  let compare: CompareOptions = { ...options.compare, thresholds }
  const ignore = options.ignore?.length ? resolveIgnore(options.ignore, { baseline: baseline.elementMap ?? null, candidate: candidate.elementMap ?? null }) : null
  if (ignore) {
    compare = {
      ...compare,
      ignoreRegions: [...(compare.ignoreRegions ?? []), ...ignore.baseline],
      ignoreRegionsCandidate: [...(compare.ignoreRegionsCandidate ?? []), ...ignore.candidate],
    }
  }
  const result = await engine.compare(baseline.image, candidate.image, compare)
  // A captured error page compares like any other page; say so before anyone trusts the score.
  result.summary.warnings.push(...checkSnapshot('baseline', baseline), ...checkSnapshot('candidate', candidate))
  if (ignore?.unresolved.length) {
    const noMaps = !baseline.elementMap && !candidate.elementMap
    result.summary.warnings.push({
      code: 'IGNORE_UNRESOLVED',
      message: noMaps
        ? `ignore: neither side has an element map, so ${ignore.unresolved.join(', ')} could not be found`
        : `ignore: nothing in either element map matches ${ignore.unresolved.join(', ')}; use a test id, an id or a role locator the map records, or capture.mask for other CSS selectors`,
      data: { unresolved: ignore.unresolved },
    })
  }
  const locators = mapLocators(
    result.regions,
    { baseline: baseline.elementMap ?? null, candidate: candidate.elementMap ?? null },
    { ...options.locators, transform: result.alignment.transform },
  )
  const verdict = evaluate(result, {
    ...(thresholds.similarity !== undefined ? { threshold: thresholds.similarity } : {}),
    ...(thresholds.failOn !== undefined ? { failOn: thresholds.failOn } : {}),
    ...(thresholds.minRegionScore !== undefined ? { minRegionScore: thresholds.minRegionScore } : {}),
  })
  return { result, locators, pass: verdict.pass, failReasons: verdict.reasons, ignored: ignore?.ignored ?? [] }
}

// ------------------------------------------------------------ extensibility

export interface ReporterOutput {
  /** Reporter name. */
  name: string
  /** Where the output went: a file path, a URL, or a label. */
  path?: string
  url?: string
  [key: string]: unknown
}

export interface ReporterContext {
  /** The run folder, when reports are written to disk. */
  runDir?: string
}

export interface Reporter {
  name: string
  report(report: ReportJson, ctx: ReporterContext): Promise<ReporterOutput[] | void> | ReporterOutput[] | void
}

export interface CapturedHook {
  target: { url: string; name?: string }
  snapshot: Snapshot
}

export interface ComparedHook {
  /** Mutable: a plugin may change status, failReasons or add notes before reporting. */
  pair: PairReport
  result: CompareResult | null
  locators: LocatorReport | null
}

export interface ReportedHook {
  report: ReportJson
  outputs: ReporterOutput[]
}

export interface Plugin {
  name: string
  onCaptured?(ctx: CapturedHook): void | Promise<void>
  onCompared?(ctx: ComparedHook): void | Promise<void>
  onReported?(ctx: ReportedHook): void | Promise<void>
}
