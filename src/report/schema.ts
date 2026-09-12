import type { AlignmentResult, CompareSummary, DiffRegion, RegionKind, Size, SnapshotMeta } from '../core/types.ts'
import type { LocatorReport } from '../locators/index.ts'

export const REPORT_SCHEMA = 'elastishot.report/1'

export type PairStatus = 'passed' | 'failed' | 'new' | 'error'

export interface SideInfo {
  /** Where the side came from: path, URL or label. */
  source: string
  /** Image reference for the HTML: a path relative to the report, or a data URI. */
  image?: string
  /** Whether an element map was available. */
  map: boolean
  meta?: SnapshotMeta
  size?: Size
}

export interface PairArtifacts {
  diff?: string
  overlay?: string
  warped?: string
  candidateOverlay?: string
  /** Small inline previews for the summary page. */
  thumbs?: { baseline?: string; candidate?: string; diff?: string }
  /** The detailed page for this pair, relative to the summary page. */
  report?: string
}

export interface PairReport {
  id: string
  name: string
  target?: string
  viewport?: { name?: string; width: number; height: number; deviceScaleFactor?: number }
  status: PairStatus
  failReasons: string[]
  error?: string
  baseline: SideInfo
  candidate: SideInfo
  summary?: CompareSummary
  alignment?: AlignmentResult
  regions: DiffRegion[]
  locators?: LocatorReport
  artifacts: PairArtifacts
  durationMs?: number
}

export interface ReportConfig {
  threshold: number
  failOn: RegionKind[] | 'none'
}

export interface ReportTotals {
  pairs: number
  passed: number
  failed: number
  new: number
  errors: number
}

export interface ReportJson {
  schema: typeof REPORT_SCHEMA
  createdAt: string
  elastishotVersion: string
  runId: string
  config: ReportConfig
  totals: ReportTotals
  pairs: PairReport[]
}

export interface ReportMeta {
  runId: string
  elastishotVersion: string
  config: ReportConfig
  createdAt?: string
}

export function buildReport(pairs: PairReport[], meta: ReportMeta): ReportJson {
  const totals: ReportTotals = { pairs: pairs.length, passed: 0, failed: 0, new: 0, errors: 0 }
  for (const p of pairs) {
    if (p.status === 'passed') totals.passed++
    else if (p.status === 'failed') totals.failed++
    else if (p.status === 'new') totals.new++
    else totals.errors++
  }
  return {
    schema: REPORT_SCHEMA,
    createdAt: meta.createdAt ?? new Date().toISOString(),
    elastishotVersion: meta.elastishotVersion,
    runId: meta.runId,
    config: meta.config,
    totals,
    pairs,
  }
}

/** Exit code the CLI uses for a report: 0 pass, 1 differences or missing baselines. */
export function reportExitCode(report: ReportJson): 0 | 1 | 2 {
  if (report.totals.errors > 0) return 2
  return report.totals.failed > 0 || report.totals.new > 0 ? 1 : 0
}

export function isReportJson(v: unknown): v is ReportJson {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return r.schema === REPORT_SCHEMA && Array.isArray(r.pairs) && typeof r.totals === 'object' && r.totals !== null
}
