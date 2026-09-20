/**
 * Lanes: side-by-side columns of a page that move independently.
 *
 * A row can carry only one vertical offset. When a card's left column grows
 * by a line and its right column does not, no row below the growth matches
 * exactly, and the row alignment falls back to a run of short bands, inserts
 * and deletes that make unchanged text look changed. Such a stretch shows up
 * as a conflict zone: consecutive bands with more than one gap and no long
 * run of exact rows between them. Such a run ends a zone wherever it sits,
 * also inside a band whose other rows changed in place: a zone has to be as
 * short as the conflict, because inside a zone the page is cut at its gutters
 * (columns blank on both sides for every row of the zone) into lanes, and
 * each lane is aligned on its own. A zone that climbs past the card to the
 * heading and the image above it finds no gutter between the card's columns.
 */
import type { Band, Range } from '../../core/types.ts'

/** A matched band with at least this many exact rows separates conflict zones... */
export const MIN_STABLE_ROWS = 48
/** ...as long as nearly all of its rows are exact: half-equal rows are what a lane conflict looks like. A band below this still separates zones at each run of MIN_STABLE_ROWS exact rows in a row, see {@link splitSubstitutedEdges}. */
export const STABLE_SIMILARITY = 0.9
/** A zone with a single gap still counts when this many of its matched rows are not exact. */
export const MIN_CONFLICT_ROWS = 16
/** Share of a zone's rows a gutter column may carry an edge in (a border line crossing it). */
export const GUTTER_EDGE_SHARE = 0.05
/** A gutter must be at least this wide (working pixels) to split lanes. */
export const MIN_GUTTER = 12
/** Content narrower than this between gutters belongs to a neighbour, not to a lane of its own. */
export const MIN_LANE = 48
/** ...to the previous neighbour only when that gutter is this many times the narrower one: which side such a span hangs from is clear at a margin and guesswork below it, see {@link laneTiles}. */
export const NEARER_RATIO = 3

/** A gap of this many rows between bands whose offsets differ by this much is layout wobble, not structure. */
export const WOBBLE_ROWS = 1

const sameLane = (a: Band, b: Band): boolean => (a.columns?.start ?? -1) === (b.columns?.start ?? -1) && (a.columns?.end ?? -1) === (b.columns?.end ?? -1)

const gapRows = (b: Band): number => (b.kind === 'inserted' ? b.candidate.end - b.candidate.start : b.baseline.end - b.baseline.start)

// A long matched band that merged a few changed rows (a version digit) is still stable: what counts is how many rows are exact.
const isStable = (b: Band): boolean => b.kind === 'matched' && b.similarity >= STABLE_SIMILARITY && (b.baseline.end - b.baseline.start) * b.similarity >= MIN_STABLE_ROWS

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
 * says whether a baseline row pairs exactly at an offset.
 *
 * What is left of the band can still hold rows that changed in place far
 * from the gap: the image on top of a card, re-rendered at the same size,
 * above two columns that grew. Its exact share then says nothing about the
 * rows next to the conflict. Judged as one band it is not stable, and the
 * zone would climb through it to the top of the page, across the heading
 * and the image that cross the card's gutter, where only a gutter of the
 * whole page is blank (the one before a fixed nav rail) and the lane left
 * of it repeats the tangle. So a remainder that is not stable as a whole is
 * cut at its runs of MIN_STABLE_ROWS exact rows, each a band of similarity
 * 1, and the zone ends at the nearest of them. At every such run, not only
 * the nearest: a band between two conflicts has one on either side, and
 * the pieces in between hold no gap, so no zone takes them.
 *
 * A stable remainder is never cut and no zone reaches further than it would
 * have without the cut, but "shorter" is not the whole story: each part of a
 * conflict the cut divides has to qualify on its own (see
 * {@link conflictZones}). Parts left with one gap and fewer than
 * MIN_CONFLICT_ROWS substituted rows each get no zone at all, and a part
 * that does qualify can be too short to hold the rows its lanes have to
 * explain. The runs the cut made are therefore collected in `cutRuns`, so
 * that {@link widenedZones} can offer the whole conflict back to the lane
 * alignment, which keeps it when its lanes pair more pixels than the parts
 * do. {@link mergeContiguous} joins the pieces no zone used. Lane bands and
 * exact bands are left alone.
 */
export function splitSubstitutedEdges(bands: readonly Band[], exact: (baselineRow: number, offset: number) => boolean, cutRuns?: Set<Band>): Band[] {
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
    const settled = piece(head, tail)
    let from = head
    if (!isStable(settled)) {
      let y = head
      while (y < tail) {
        let end = y
        while (end < tail && exact(end, b.offset)) end++
        if (end - y >= MIN_STABLE_ROWS) {
          if (y > from) out.push(piece(from, y))
          const run = piece(y, end)
          out.push(run)
          cutRuns?.add(run)
          from = end
        }
        // row `end` did not pair exactly (a row with no candidate pixels behind it never does), or the remainder is over
        y = end + 1
      }
    }
    if (from === head) out.push(settled)
    else if (from < tail) out.push(piece(from, tail))
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

/** A band that ends a conflict zone: a lane band, or a band stable enough to stand between two conflicts. */
const endsZone = (b: Band): boolean => !!b.columns || isStable(b)

export interface WideZone extends Zone {
  /** A gap in this range ended in no zone at all: the parts leave a whole gap unexplained, whatever their lanes do. */
  orphan: boolean
}

/**
 * The conflicts {@link splitSubstitutedEdges} divided, each grown back to the
 * zone it would have been without the cut: from the last band that ends a
 * zone and is not itself a run the cut made, to the next one.
 *
 * A run of exact rows is only evidence that the rows it covers pair; it is no
 * evidence about the columns beside them. It can fall between a card's two
 * gaps (one column is blank there while the other still moves), and then the
 * parts it leaves are not the conflict: one part keeps a gap and too few
 * substituted rows to be a zone at all, or it qualifies but its lanes have to
 * explain rows whose insertion point lies in the other part. Both failures
 * are offered back here as the single zone they came from - the second from
 * its zone, the first from its orphaned gap - for the caller to keep only
 * when the wider answer pairs more pixels. Ranges that cross no cut run are
 * left out: there is nothing there to widen.
 */
export function widenedZones(bands: readonly Band[], zones: readonly Zone[], cutRuns: ReadonlySet<Band>): WideZone[] {
  if (!cutRuns.size) return []
  const taken = new Uint8Array(bands.length)
  for (const z of zones) for (let i = z.from; i < z.to; i++) taken[i] = 1
  const orphans = new Set<number>()
  bands.forEach((b, i) => {
    if (!taken[i] && b.kind !== 'matched' && !isWobble(bands, i)) orphans.add(i)
  })
  const out: WideZone[] = []
  const seen = new Set<number>()
  for (const seed of [...zones.map((z) => z.from), ...orphans].sort((a, b) => a - b)) {
    let from = seed
    while (from > 0 && !(endsZone(bands[from - 1]!) && !cutRuns.has(bands[from - 1]!))) from--
    let to = seed + 1
    while (to < bands.length && !(endsZone(bands[to]!) && !cutRuns.has(bands[to]!))) to++
    if (seen.has(from)) continue
    seen.add(from)
    let crosses = false
    let orphan = false
    for (let i = from; i < to; i++) {
      if (cutRuns.has(bands[i]!)) crosses = true
      if (orphans.has(i)) orphan = true
    }
    if (crosses) out.push({ from, to, orphan })
  }
  return out
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
  // spans separated by a gutter narrower than MIN_GUTTER are one span
  const merged: Range[] = [{ ...spans[0]! }]
  for (let i = 1; i < spans.length; i++) {
    const prev = merged[merged.length - 1]!
    const s = spans[i]!
    if (s.start - prev.end < MIN_GUTTER) prev.end = s.end
    else merged.push({ ...s })
  }
  // A span too narrow to be a lane (a bullet column, a border line) joins the
  // next span, as a marker precedes the text it belongs to and may stand
  // further from it than a gutter is wide. It joins the previous one instead
  // when the gutter behind it is clearly the narrower of the two: in a short
  // zone the end of a paragraph's one long line is such a span, and joined to
  // the card's border far to its right the two pass for a lane that cuts the
  // paragraph in two. Clearly, not merely: a marker column half again nearer
  // the left column's text than its own still belongs to its own.
  const narrow = (s: Range): boolean => s.end - s.start < MIN_LANE
  for (let i = merged.findIndex(narrow); i !== -1 && merged.length > 1; i = merged.findIndex(narrow)) {
    const s = merged[i]!
    const before = merged[i - 1]
    const after = merged[i + 1]
    if (before && (!after || after.start - s.end >= NEARER_RATIO * (s.start - before.end))) before.end = s.end
    else after!.start = s.start
    merged.splice(i, 1)
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
