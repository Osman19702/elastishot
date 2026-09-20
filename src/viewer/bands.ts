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
 * Where the page was aligned lane by lane, each lane has its own rows, and
 * the lanes of one stretch need not come out equally tall: a column that
 * gains 184 rows inside a card that grew by 81 also loses 103 rows of the
 * padding under it, and takes 103 more aligned rows than the column beside
 * it. The shorter lanes are padded, so the page below is one picture again,
 * see laneLayouts().
 *
 * Band rows are in baseline space for the baseline and in warped space for
 * the candidate; a warped range may start above row 0 or end past the image
 * when the global warp cropped the candidate, so drawing clips with
 * visibleRows() rather than the layout clamping the ranges.
 */
import type { Band, Box, Range } from '../core/types.ts'

export type AlignedSide = 'baseline' | 'candidate'

export interface AlignedSegment {
  /** 'padding' has rows on neither side: it levels a lane with a taller one beside it, nothing was added or removed there. */
  kind: Band['kind'] | 'padding'
  baseline: Range
  candidate: Range
  aligned: Range
  /**
   * For a gap: its index among the band map's inserted and deleted bands, the
   * row of the gaps image that fills it. For padding: the gap whose fill it
   * continues, absent when the lanes above it had no gap.
   */
  gap?: number
  /**
   * A gap of one lane whose rows hold nothing (Band.blank): the padding that
   * lane's own growth opened or closed so the lanes end level again. It is
   * filled like any gap and drawn untinted, like 'padding', because nothing
   * was added or removed there. A gap across the full width is never marked:
   * there nothing else can have moved those rows, so they are a spacing
   * change, keep their whitespace-only region and keep their tint.
   */
  blank?: true
}

export interface AlignedLayout {
  height: number
  segments: AlignedSegment[]
  /** True when at least one band is inserted or deleted, i.e. the space differs from the baseline's. */
  hasGaps: boolean
}

const len = (r: Range): number => Math.max(0, r.end - r.start)

/** Each inserted or deleted band's index among the gaps, in band-map order: the engine's gaps image has one row per gap in that order. */
export function gapIndex(bands: readonly Band[]): Map<Band, number> {
  const index = new Map<Band, number>()
  for (const b of bands) if (b.kind !== 'matched') index.set(b, index.size)
  return index
}

/** A row space being laid out: its segments, and how far the aligned rows (a) and each side's rows (b, c) have come. */
interface Track {
  segments: AlignedSegment[]
  a: number
  b: number
  c: number
}

const newTrack = (): Track => ({ segments: [], a: 0, b: 0, c: 0 })

const inOrder = (bands: readonly Band[]): Band[] => bands.filter((b) => b.axis === 'y').sort((a, b) => a.baseline.start - b.baseline.start || a.candidate.start - b.candidate.start)

/** The gap of one lane that holds nothing: see AlignedSegment.blank. */
const levels = (band: Band): boolean => Boolean(band.blank && band.columns && band.kind !== 'matched')

function push(t: Track, kind: Band['kind'], baseline: Range, candidate: Range, gap?: number, blank = false): void {
  const n = kind === 'inserted' ? len(candidate) : len(baseline)
  if (n <= 0) return
  t.segments.push({ kind, baseline, candidate, aligned: { start: t.a, end: t.a + n }, ...(gap === undefined ? {} : { gap }), ...(blank ? { blank: true as const } : {}) })
  t.a += n
  t.b = Math.max(t.b, baseline.end)
  t.c = Math.max(t.c, candidate.end)
}

/** Rows neither side reported, up to the given ones, are compared in place. */
function matchUpTo(t: Track, baselineRow: number, candidateRow: number): void {
  const n = Math.max(baselineRow - t.b, candidateRow - t.c)
  if (n > 0) push(t, 'matched', { start: t.b, end: t.b + n }, { start: t.c, end: t.c + n })
}

function pad(t: Track, rows: number, gap: number | undefined): void {
  if (rows <= 0) return
  t.segments.push({ kind: 'padding', baseline: { start: t.b, end: t.b }, candidate: { start: t.c, end: t.c }, aligned: { start: t.a, end: t.a + rows }, ...(gap === undefined ? {} : { gap }) })
  t.a += rows
}

const finish = (t: Track): AlignedLayout => ({ height: t.a, segments: t.segments, hasGaps: t.segments.some((s) => s.kind === 'inserted' || s.kind === 'deleted') })

/**
 * Lay the y-axis bands out end to end. Rows before the first band and after
 * the last one are matched, so a band map that does not cover the whole
 * image still maps every row.
 */
export function alignedLayout(bands: readonly Band[], baselineHeight: number, candidateHeight: number, gaps: ReadonlyMap<Band, number> = gapIndex(bands)): AlignedLayout {
  const t = newTrack()
  for (const band of inOrder(bands)) {
    matchUpTo(t, band.baseline.start, band.candidate.start)
    push(t, band.kind, band.baseline, band.candidate, gaps.get(band), levels(band))
  }
  matchUpTo(t, baselineHeight, candidateHeight)
  return finish(t)
}

/** One lane of the page with its own row space; `columns` is null when the whole width is one lane. */
export interface LaneLayout {
  columns: Range | null
  layout: AlignedLayout
}

const within = (inner: Range, outer: Range): boolean => inner.start >= outer.start && inner.end <= outer.end

/**
 * The columns that are one lane wherever the page has lanes. Two stretches
 * of a page each measure their own gutter and may cut it a pixel apart, or
 * somewhere else altogether; a layout per reported lane would then draw two
 * lanes over the same columns, each wrong in the other's stretch. Cutting at
 * every lane edge gives spans that belong to exactly one lane per stretch.
 */
function laneSpans(rows: readonly Band[]): Range[] {
  const lanes = rows.flatMap((b) => (b.columns ? [b.columns] : []))
  const cuts = [...new Set(lanes.flatMap((l) => [l.start, l.end]))].sort((a, b) => a - b)
  const spans: Range[] = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const span = { start: cuts[i]!, end: cuts[i + 1]! }
    if (lanes.some((l) => within(span, l))) spans.push(span)
  }
  return spans
}

/**
 * The gap whose row of the gaps image suits padding at the given rows. That
 * image holds the colours around each gap over the full width: sampled from
 * the baseline at an inserted band's first row, from the warped candidate at
 * a deleted band's. So the nearest gap is measured on the side it was
 * sampled from, and the span's own lane wins a tie.
 */
function nearestGap(gaps: readonly Band[], span: Range, baselineRow: number, candidateRow: number): Band | undefined {
  let best: Band | undefined
  let bestDistance = Infinity
  for (const g of gaps) {
    const distance = Math.abs(g.kind === 'inserted' ? baselineRow - g.baseline.start : candidateRow - g.candidate.start)
    const own = g.columns !== undefined && within(span, g.columns)
    if (distance < bestDistance || (distance === bestDistance && own)) {
      best = g
      bestDistance = distance
    }
  }
  return best
}

/** A matched band cut at a baseline row, the candidate rows going with their baseline rows. */
function splitAt(band: Band, baselineRow: number): [Band, Band] {
  const candidateRow = band.candidate.start + (baselineRow - band.baseline.start)
  return [
    { ...band, baseline: { start: band.baseline.start, end: baselineRow }, candidate: { start: band.candidate.start, end: candidateRow } },
    { ...band, baseline: { start: baselineRow, end: band.baseline.end }, candidate: { start: candidateRow, end: band.candidate.end } },
  ]
}

/**
 * Bands with `columns` come from a stretch of the page aligned lane by lane.
 * Each lane gets its own layout from the full-width bands plus its own.
 *
 * Every lane maps the stretch's baseline rows to the same candidate rows, so
 * inserted minus deleted rows is one number for all of them, but the aligned
 * rows a lane takes are baseline plus inserted rows: a lane that both gains
 * and loses rows is taller than one that only gains. Left alone, everything
 * below the stretch is drawn lower in that lane than beside it, a tear down
 * the whole page. So the shorter lanes get padding up to the tallest, and a
 * full-width row has one aligned row again, whichever lane a box or a pixel
 * is mapped through.
 *
 * The padding goes where the last gap of the stretch ends, not where the
 * stretch does. Below that row every lane is matched at the offset the
 * stretch ends with, so the lanes agree row for row: levelled there, the
 * card's last rows and its bottom edge run straight across the lane cut,
 * and the padding continues the card rather than sitting under it.
 *
 * What the padding faces is another lane's lost rows, and it falls wherever
 * that lane's last gap ends, which is not a row of its own lane: where the
 * padded column has content across that row, the levelling opens a neutral
 * hole between two lines that did not move. On the pages this ships against
 * the padded lane is blank there (the card's own slack under the shorter
 * column), so nothing is split; the alternative, leaving the lanes at
 * different heights, tears the whole page below the stretch instead.
 */
export function laneLayouts(bands: readonly Band[], baselineHeight: number, candidateHeight: number): LaneLayout[] {
  const gaps = gapIndex(bands)
  const rows = inOrder(bands)
  const spans = laneSpans(rows)
  if (!spans.length) return [{ columns: null, layout: alignedLayout(bands, baselineHeight, candidateHeight, gaps) }]
  const tracks = spans.map(newTrack)
  const add = (t: Track, band: Band): void => {
    matchUpTo(t, band.baseline.start, band.candidate.start)
    push(t, band.kind, band.baseline, band.candidate, gaps.get(band), levels(band))
  }
  // the lane bands since the full width was last level
  let stretch: Band[] = []
  const level = (): void => {
    const height = Math.max(...tracks.map((t) => t.a))
    const gapsHere = stretch.filter((b) => b.kind !== 'matched')
    tracks.forEach((t, i) => {
      if (t.a >= height) return
      const fill = nearestGap(gapsHere, spans[i]!, t.b, t.c)
      pad(t, height - t.a, fill && gaps.get(fill))
    })
  }
  /** Lay the stretch out, up to the rows the full width resumes at. */
  const resume = (baselineRow: number, candidateRow: number): void => {
    // an inserted band's baseline range is empty, so its end is the row it sits at
    const settled = Math.max(-Infinity, ...stretch.filter((b) => b.kind !== 'matched').map((b) => b.baseline.end))
    const below = tracks.map((t, i) => {
      const later: Band[] = []
      for (const band of stretch) {
        if (!within(spans[i]!, band.columns!)) continue
        if (band.kind !== 'matched' || band.baseline.end <= settled) add(t, band)
        else if (band.baseline.start >= settled) later.push(band)
        else {
          const [head, tail] = splitAt(band, settled)
          add(t, head)
          later.push(tail)
        }
      }
      return later
    })
    level()
    tracks.forEach((t, i) => {
      for (const band of below[i]!) add(t, band)
      // A lane's uncovered last rows are still its own: they come before any padding the map's holes make necessary.
      matchUpTo(t, baselineRow, candidateRow)
    })
    level()
    stretch = []
  }
  for (const band of rows) {
    if (band.columns) {
      stretch.push(band)
      continue
    }
    resume(band.baseline.start, band.candidate.start)
    for (const t of tracks) push(t, band.kind, band.baseline, band.candidate, gaps.get(band), levels(band))
  }
  resume(baselineHeight, candidateHeight)
  return spans.map((columns, i) => ({ columns, layout: finish(tracks[i]!) }))
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
    // Padding holds no row of either side: a row past the last band stays at that band's end.
    if (s.kind === 'padding') continue
    const r = s[side]
    if (y >= r.start && y < r.end) return s.aligned.start + (y - r.start)
    if (r.start <= y) last = s
  }
  if (!last) return 0
  const r = last[side]
  return Math.min(last.aligned.end, last.aligned.start + (y - r.start))
}

/**
 * A box on one side in aligned rows; the top and bottom edges map separately
 * so a box spanning bands keeps both.
 *
 * The bottom edge maps the box's LAST row and takes the row after it, not the
 * row past the box: that row is the first row of the next band, and where a
 * gap sits between the two — the common case, since the engine cuts the gap
 * right below the row that changed — the gap's rows and any padding after it
 * belong to neither side's box, so mapping it would stretch the box over
 * them. A row past the last band maps to that band's end, so the row after it
 * is clamped to the layout and cannot leave the stage.
 */
export function mapBox(layout: AlignedLayout, box: Box, side: AlignedSide): Box {
  const top = mapY(layout, box.y, side)
  const last = mapY(layout, box.y + Math.max(1, box.h) - 1, side) + 1
  const bottom = Math.max(top + 1, Math.min(layout.height, last))
  return { x: box.x, y: top, w: box.w, h: bottom - top }
}
