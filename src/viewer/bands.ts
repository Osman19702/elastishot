/**
 * The aligned coordinate space the viewer draws in when the structural
 * alignment found inserted or deleted rows.
 *
 * The baseline and the warped candidate are cut into the bands the engine
 * reported and laid out one after another: a matched band keeps its baseline
 * rows, an inserted band adds rows that only the candidate has (a gap on the
 * baseline side) and a deleted band keeps rows only the baseline has (a gap
 * on the candidate side). Both sides end up the same height and every row
 * faces the row it was compared with, so the slider, blink and overlay modes
 * stay meaningful below an inserted section instead of comparing a card with
 * whatever used to sit 1300 px higher.
 *
 * Band rows are in baseline space for the baseline and in warped space for
 * the candidate; a warped range may start above row 0 or end past the image
 * when the global warp cropped the candidate, so drawing clips with
 * visibleRows() rather than the layout clamping the ranges.
 */
import type { Band, Box, Range } from '../core/types.ts'

export type AlignedSide = 'baseline' | 'candidate'

export interface AlignedSegment {
  kind: Band['kind']
  baseline: Range
  candidate: Range
  aligned: Range
}

export interface AlignedLayout {
  height: number
  segments: AlignedSegment[]
  /** True when at least one band is inserted or deleted, i.e. the space differs from the baseline's. */
  hasGaps: boolean
}

const len = (r: Range): number => Math.max(0, r.end - r.start)

/**
 * Lay the y-axis bands out end to end. Rows before the first band and after
 * the last one are matched, so a band map that does not cover the whole
 * image still maps every row.
 */
export function alignedLayout(bands: readonly Band[], baselineHeight: number, candidateHeight: number): AlignedLayout {
  const rows = bands.filter((b) => b.axis === 'y').slice()
  rows.sort((a, b) => a.baseline.start - b.baseline.start || a.candidate.start - b.candidate.start)
  const segments: AlignedSegment[] = []
  let a = 0
  let b = 0
  let c = 0
  const push = (kind: Band['kind'], baseline: Range, candidate: Range) => {
    const n = kind === 'inserted' ? len(candidate) : len(baseline)
    if (n <= 0) return
    segments.push({ kind, baseline, candidate, aligned: { start: a, end: a + n } })
    a += n
    b = Math.max(b, baseline.end)
    c = Math.max(c, candidate.end)
  }
  for (const band of rows) {
    // Rows neither side reported are compared in place.
    const lead = Math.max(band.baseline.start - b, band.candidate.start - c)
    if (lead > 0) push('matched', { start: b, end: b + lead }, { start: c, end: c + lead })
    push(band.kind, band.baseline, band.candidate)
  }
  const tail = Math.max(baselineHeight - b, candidateHeight - c)
  if (tail > 0) push('matched', { start: b, end: b + tail }, { start: c, end: c + tail })
  return { height: a, segments, hasGaps: segments.some((s) => s.kind !== 'matched') }
}

/** One lane of the page with its own row space; `columns` is null when the whole width is one lane. */
export interface LaneLayout {
  columns: Range | null
  layout: AlignedLayout
}

const sameRange = (a: Range | undefined, b: Range | undefined): boolean => a?.start === b?.start && a?.end === b?.end

/**
 * Bands with `columns` come from a stretch of the page aligned lane by lane.
 * Each lane gets its own layout from the full-width bands plus its own;
 * the layouts have one height, because every lane maps the same baseline
 * rows to the same candidate rows.
 */
export function laneLayouts(bands: readonly Band[], baselineHeight: number, candidateHeight: number): LaneLayout[] {
  const lanes: Range[] = []
  for (const b of bands) if (b.columns && !lanes.some((l) => sameRange(l, b.columns))) lanes.push({ ...b.columns })
  if (!lanes.length) return [{ columns: null, layout: alignedLayout(bands, baselineHeight, candidateHeight) }]
  lanes.sort((a, b) => a.start - b.start)
  return lanes.map((columns) => ({ columns, layout: alignedLayout(bands.filter((b) => !b.columns || sameRange(b.columns, columns)), baselineHeight, candidateHeight) }))
}

/** The lane a box belongs to: the one holding its centre column. */
export function laneFor(lanes: readonly LaneLayout[], box: Box): LaneLayout {
  const cx = box.x + box.w / 2
  return lanes.find((l) => l.columns && cx >= l.columns.start && cx < l.columns.end) ?? lanes[0]!
}

/** The part of a segment's rows on one side that exists in an image of the given height, with where it lands. */
export function visibleRows(segment: AlignedSegment, side: AlignedSide, imageHeight: number): { from: number; count: number; alignedStart: number } | null {
  const r = segment[side]
  const from = Math.max(r.start, 0)
  const to = Math.min(r.end, imageHeight, r.start + (segment.aligned.end - segment.aligned.start))
  if (to <= from) return null
  return { from, count: to - from, alignedStart: segment.aligned.start + (from - r.start) }
}

/** The aligned row for a baseline or warped-candidate row; a row inside a gap on that side lands where the gap starts. */
export function mapY(layout: AlignedLayout, y: number, side: AlignedSide): number {
  let last: AlignedSegment | null = null
  for (const s of layout.segments) {
    const r = s[side]
    if (y >= r.start && y < r.end) return s.aligned.start + (y - r.start)
    if (r.start <= y) last = s
  }
  if (!last) return 0
  const r = last[side]
  return Math.min(last.aligned.end, last.aligned.start + (y - r.start))
}

/** A box on one side in aligned rows; the top and bottom edges map separately so a box spanning bands keeps both. */
export function mapBox(layout: AlignedLayout, box: Box, side: AlignedSide): Box {
  const top = mapY(layout, box.y, side)
  const bottom = Math.max(top + 1, mapY(layout, box.y + box.h, side))
  return { x: box.x, y: top, w: box.w, h: bottom - top }
}
