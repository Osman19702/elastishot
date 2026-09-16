/**
 * Lanes: side-by-side columns of a page that move independently.
 *
 * A row can carry only one vertical offset. When a card's left column grows
 * by a line and its right column does not, no row below the growth matches
 * exactly, and the row alignment falls back to a run of short bands, inserts
 * and deletes that make unchanged text look changed. Such a stretch shows up
 * as a conflict zone: consecutive bands with more than one gap and no exact
 * matched band with enough exact rows between them. Inside a zone the page is cut at
 * its gutters (columns blank on both sides for every row of the zone) into
 * lanes, and each lane is aligned on its own.
 */
import type { Band, Range } from '../../core/types.ts'

/** A matched band with at least this many exact rows separates conflict zones... */
export const MIN_STABLE_ROWS = 48
/** ...as long as nearly all of its rows are exact: half-equal rows are what a lane conflict looks like. */
export const STABLE_SIMILARITY = 0.9
/** A zone with a single gap still counts when this many of its matched rows are not exact. */
export const MIN_CONFLICT_ROWS = 16
/** Share of a zone's rows a gutter column may carry an edge in (a border line crossing it). */
export const GUTTER_EDGE_SHARE = 0.05
/** A gutter must be at least this wide (working pixels) to split lanes. */
export const MIN_GUTTER = 12
/** Content narrower than this between gutters belongs to its neighbour, not to a lane of its own. */
export const MIN_LANE = 48

export interface Zone {
  /** Band indices [from, to). */
  from: number
  to: number
}

// A long matched band that merged a few changed rows (a version digit) is still stable: what counts is how many rows are exact.
const isStable = (b: Band): boolean => b.kind === 'matched' && b.similarity >= STABLE_SIMILARITY && (b.baseline.end - b.baseline.start) * b.similarity >= MIN_STABLE_ROWS

/**
 * Runs of bands between stable bands that hold a gap next to rows that did
 * not pair exactly: two gaps, or one gap and a substituted stretch. A lone
 * insertion between exact bands is a plain insertion; a substitution with no
 * gap is content that changed in place.
 */
export function conflictZones(bands: readonly Band[]): Zone[] {
  const zones: Zone[] = []
  let start = -1
  let gaps = 0
  let substituted = 0
  const flush = (end: number) => {
    if (start !== -1 && (gaps >= 2 || (gaps >= 1 && substituted >= MIN_CONFLICT_ROWS))) zones.push({ from: start, to: end })
    start = -1
    gaps = 0
    substituted = 0
  }
  bands.forEach((b, i) => {
    if (b.columns || isStable(b)) {
      flush(i)
      return
    }
    if (start === -1) start = i
    if (b.kind !== 'matched') gaps++
    else substituted += Math.round((b.baseline.end - b.baseline.start) * (1 - b.similarity))
  })
  flush(bands.length)
  return zones
}

/**
 * Cut the width into lanes at the gutters of a zone. `blank[x]` is 1 when
 * column x is blank on both sides for every row of the zone. Lanes tile the
 * whole width (a gutter is split down its middle), so every column belongs
 * to exactly one lane. Fewer than two lanes means no split.
 */
export function laneTiles(blank: Uint8Array, width: number): Range[] {
  // content spans
  const spans: Range[] = []
  let x = 0
  while (x < width) {
    if (blank[x]) {
      x++
      continue
    }
    let end = x
    while (end < width && !blank[end]) end++
    spans.push({ start: x, end })
    x = end
  }
  if (spans.length < 2) return []
  // spans separated by a gutter narrower than MIN_GUTTER are one span; so
  // are spans too narrow to be a lane (a bullet column, a border line)
  const merged: Range[] = [spans[0]!]
  for (let i = 1; i < spans.length; i++) {
    const prev = merged[merged.length - 1]!
    const s = spans[i]!
    if (s.start - prev.end < MIN_GUTTER || prev.end - prev.start < MIN_LANE) prev.end = s.end
    else merged.push({ ...s })
  }
  const last = merged[merged.length - 1]!
  if (merged.length >= 2 && last.end - last.start < MIN_LANE) {
    merged[merged.length - 2]!.end = last.end
    merged.pop()
  }
  if (merged.length < 2) return []
  const tiles: Range[] = []
  for (let i = 0; i < merged.length; i++) {
    const start = i === 0 ? 0 : Math.floor((merged[i - 1]!.end + merged[i]!.start) / 2)
    const end = i === merged.length - 1 ? width : Math.floor((merged[i]!.end + merged[i + 1]!.start) / 2)
    tiles.push({ start, end })
  }
  return tiles
}
