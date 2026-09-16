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

/** A gap of this many rows between bands whose offsets differ by this much is layout wobble, not structure. */
export const WOBBLE_ROWS = 1

const sameLane = (a: Band, b: Band): boolean => (a.columns?.start ?? -1) === (b.columns?.start ?? -1) && (a.columns?.end ?? -1) === (b.columns?.end ?? -1)

const gapRows = (b: Band): number => (b.kind === 'inserted' ? b.candidate.end - b.candidate.start : b.baseline.end - b.baseline.start)

/**
 * Text laid out at fractional positions lands a row lower here and a row
 * higher there, and an exact row alignment records that faithfully: a
 * one-row delete, a matched band, a one-row insert. Folding such a gap
 * with its neighbours into one band at the first offset keeps the map
 * readable; the differ already treats a one-pixel shift as no change,
 * and one row is as far as rounding moves a line. At the edge of a lane
 * the gap has a matched neighbour on one side only: a deleted row is then
 * taken into that neighbour and an inserted row dropped. Bands fold only
 * within their own lane, so a full map can be folded in one pass. The
 * fold is a simplification of the finished map: it must not run before
 * the map is scored against another, because the folded rows sit a row
 * off their pixels and score as changed.
 */
export function foldWobble(bands: readonly Band[]): Band[] {
  const out: Band[] = []
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i]!
    if (b.kind !== 'matched' && gapRows(b) <= WOBBLE_ROWS) {
      const prev = out[out.length - 1]
      const next = bands[i + 1]
      const before = prev?.kind === 'matched' && sameLane(prev, b) ? prev : undefined
      const after = next?.kind === 'matched' && sameLane(b, next) ? next : undefined
      if (before && after) {
        if (Math.abs(after.offset - before.offset) <= WOBBLE_ROWS) {
          const n1 = before.baseline.end - before.baseline.start
          const n2 = after.baseline.end - after.baseline.start
          before.baseline = { start: before.baseline.start, end: after.baseline.end }
          before.candidate = { start: before.candidate.start, end: after.baseline.end + before.offset }
          before.similarity = (before.similarity * n1 + after.similarity * n2) / Math.max(1, n1 + n2)
          i++
          continue
        }
      } else if (before && !(next && sameLane(b, next))) {
        if (b.kind === 'deleted') {
          before.baseline = { start: before.baseline.start, end: b.baseline.end }
          before.candidate = { start: before.candidate.start, end: b.baseline.end + before.offset }
        }
        continue
      } else if (after && !(prev && sameLane(prev, b))) {
        if (b.kind === 'deleted') {
          out.push({ ...after, baseline: { start: b.baseline.start, end: after.baseline.end }, candidate: { start: b.baseline.start + after.offset, end: after.candidate.end } })
          i++
        }
        continue
      }
    }
    out.push({ ...b })
  }
  return out
}

/** A run of this many exactly paired rows settles where a substituted stretch ends. */
export const SETTLED_ROWS = 24

/**
 * The full-width row alignment keeps rows it could not pair exactly inside
 * the matched band at the same offset. Next to a gap that is where a lane
 * moved on its own: the left column's lines sit against the right column's
 * unchanged rows, so no row hashes equal. Such a stretch at the edge of a
 * band beside a gap is split off (as a band of its own, with its exact
 * share as similarity) so that the zone can take it; `exact(row, offset)`
 * says whether a baseline row pairs exactly at an offset. Lane bands and
 * bands not beside a gap are left alone.
 */
export function splitSubstitutedEdges(bands: readonly Band[], exact: (baselineRow: number, offset: number) => boolean): Band[] {
  const out: Band[] = []
  bands.forEach((b, i) => {
    if (b.kind !== 'matched' || b.columns || b.similarity >= 1) {
      out.push({ ...b })
      return
    }
    const prev = bands[i - 1]
    const next = bands[i + 1]
    let head = b.baseline.start
    let tail = b.baseline.end
    if (prev && prev.kind !== 'matched') {
      let run = 0
      let lastBad = -1
      for (let y = b.baseline.start; y < b.baseline.end && run < SETTLED_ROWS; y++) {
        if (exact(y, b.offset)) run++
        else {
          run = 0
          lastBad = y
        }
      }
      if (lastBad >= 0) head = lastBad + 1
    }
    if (next && next.kind !== 'matched') {
      let run = 0
      let lastBad = -1
      for (let y = b.baseline.end - 1; y >= head && run < SETTLED_ROWS; y--) {
        if (exact(y, b.offset)) run++
        else {
          run = 0
          lastBad = y
        }
      }
      if (lastBad >= 0) tail = lastBad
    }
    const piece = (start: number, end: number): Band => {
      let same = 0
      for (let y = start; y < end; y++) if (exact(y, b.offset)) same++
      return { ...b, baseline: { start, end }, candidate: { start: start + b.offset, end: end + b.offset }, similarity: same / Math.max(1, end - start) }
    }
    if (head >= tail) {
      out.push(piece(b.baseline.start, b.baseline.end))
      return
    }
    if (head > b.baseline.start) out.push(piece(b.baseline.start, head))
    out.push(piece(head, tail))
    if (tail < b.baseline.end) out.push(piece(tail, b.baseline.end))
  })
  return out
}

/** Undo a split that no zone used: contiguous full-width matched bands at one offset are one band again. */
export function mergeContiguous(bands: readonly Band[]): Band[] {
  const out: Band[] = []
  for (const b of bands) {
    const prev = out[out.length - 1]
    if (prev && prev.kind === 'matched' && b.kind === 'matched' && !prev.columns && !b.columns && prev.offset === b.offset && prev.baseline.end === b.baseline.start) {
      const n1 = prev.baseline.end - prev.baseline.start
      const n2 = b.baseline.end - b.baseline.start
      prev.baseline = { start: prev.baseline.start, end: b.baseline.end }
      prev.candidate = { start: prev.candidate.start, end: b.candidate.end }
      prev.similarity = (prev.similarity * n1 + b.similarity * n2) / Math.max(1, n1 + n2)
      continue
    }
    out.push({ ...b })
  }
  return out
}

export interface Zone {
  /** Band indices [from, to). */
  from: number
  to: number
}

// A long matched band that merged a few changed rows (a version digit) is still stable: what counts is how many rows are exact.
const isStable = (b: Band): boolean => b.kind === 'matched' && b.similarity >= STABLE_SIMILARITY && (b.baseline.end - b.baseline.start) * b.similarity >= MIN_STABLE_ROWS

/** The gap at `i` is a one-row wobble between two matched bands of one lane (see {@link foldWobble}). */
const isWobble = (bands: readonly Band[], i: number): boolean => {
  const b = bands[i]!
  const prev = bands[i - 1]
  const next = bands[i + 1]
  if (b.kind === 'matched' || prev?.kind !== 'matched' || next?.kind !== 'matched' || !sameLane(prev, b) || !sameLane(b, next)) return false
  const rows = b.kind === 'inserted' ? b.candidate.end - b.candidate.start : b.baseline.end - b.baseline.start
  return rows <= WOBBLE_ROWS && Math.abs(next.offset - prev.offset) <= WOBBLE_ROWS
}

/**
 * Runs of bands between stable bands that hold a gap next to rows that did
 * not pair exactly: two gaps, or one gap and a substituted stretch. A lone
 * insertion between exact bands is a plain insertion; a substitution with no
 * gap is content that changed in place; a one-row wobble is no gap at all,
 * or every paragraph of fractional line height would be cut into lanes.
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
    if (b.kind !== 'matched') {
      if (!isWobble(bands, i)) gaps++
    } else substituted += Math.round((b.baseline.end - b.baseline.start) * (1 - b.similarity))
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
