import { REGION_KINDS } from './options.ts'
import type { CompareSummary, DiffRegion, RegionKind } from './types.ts'

export interface EvaluateOptions {
  /** Minimum similarity to pass (default 0.98). */
  threshold?: number
  /** Region kinds that fail the comparison; 'none' ignores regions (default: all kinds). */
  failOn?: readonly RegionKind[] | 'none'
  /** Regions below this score are ignored (default 0.05). */
  minRegionScore?: number
}

export interface Evaluation {
  pass: boolean
  reasons: string[]
}

const fmt = (n: number): string => String(Math.round(n * 1000) / 1000)

/** Re-evaluate pass/fail for a comparison under different thresholds. */
export function evaluate(
  result: { summary: Pick<CompareSummary, 'similarity'>; regions: readonly DiffRegion[] },
  options: EvaluateOptions = {},
): Evaluation {
  const threshold = options.threshold ?? 0.98
  const failOn = options.failOn === 'none' ? [] : (options.failOn ?? REGION_KINDS)
  const minScore = options.minRegionScore ?? 0.05
  const reasons: string[] = []
  if (result.summary.similarity < threshold) {
    reasons.push(`similarity ${fmt(result.summary.similarity)} is below the threshold ${fmt(threshold)}`)
  }
  for (const kind of REGION_KINDS) {
    if (!failOn.includes(kind)) continue
    const n = result.regions.filter((r) => r.kind === kind && r.score >= minScore).length
    if (n > 0) reasons.push(`${n} ${kind} region${n === 1 ? '' : 's'} at or above score ${fmt(minScore)}`)
  }
  return { pass: reasons.length === 0, reasons }
}
