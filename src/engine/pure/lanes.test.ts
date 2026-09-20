import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Band, Range } from '../../core/types.ts'
import { conflictZones, foldWobble, laneTiles, mergeContiguous, splitSubstitutedEdges, widenedZones } from './lanes.ts'

const band = (kind: Band['kind'], b0: number, b1: number, offset = 0, similarity = kind === 'matched' ? 1 : 0): Band => ({
  kind,
  axis: 'y',
  baseline: { start: b0, end: b1 },
  candidate: { start: b0 + offset, end: (kind === 'inserted' ? b0 + 22 : b1) + offset },
  similarity,
  offset,
})

test('a conflict zone is a run with two or more gaps between exact matched bands', () => {
  // the portfolio card: stable rows, then inserts, short substituted bands and deletes, then stable rows again
  const bands = [
    band('matched', 0, 2442),
    band('inserted', 2442, 2442),
    band('matched', 2442, 2459, 22, 0.4),
    band('deleted', 2459, 2460, 22),
    band('matched', 2460, 2504, 21, 0.3),
    band('deleted', 2504, 2525, 21),
    band('matched', 2525, 2564, 0, 0.5),
    band('inserted', 2564, 2564),
    band('matched', 2564, 2673, 22, 0.3),
    band('matched', 2749, 2872, 41),
  ]
  assert.deepEqual(conflictZones(bands), [{ from: 1, to: 9 }])
})

test('a long band that merged a few changed rows is still stable', () => {
  // 2442 rows of which 2400 are exact (a version digit changed inside) start the zone, not join it
  const bands = [band('matched', 0, 2442, 0, 0.98), band('inserted', 2442, 2442), band('matched', 2442, 2470, 22, 0.2), band('deleted', 2470, 2480, 22), band('matched', 2480, 2900, 41)]
  assert.deepEqual(conflictZones(bands), [{ from: 1, to: 4 }])
})

test('a lone insertion between exact bands is not a zone, and lane bands are never re-split', () => {
  assert.deepEqual(conflictZones([band('matched', 0, 100), band('inserted', 100, 100), band('matched', 100, 300, 22)]), [])
  const laneBand = { ...band('matched', 100, 200), columns: { start: 0, end: 400 } }
  assert.deepEqual(conflictZones([band('matched', 0, 100), band('inserted', 100, 100), laneBand, band('deleted', 200, 210), band('matched', 210, 400)]), [])
})

test('one gap next to a substituted stretch is a zone too', () => {
  // the left column gained a line: one insertion, and the rows beside it paired inexactly
  const bands = [band('matched', 0, 136), band('matched', 136, 246, 0, 0.2), band('inserted', 246, 246), band('matched', 246, 400, 22)]
  assert.deepEqual(conflictZones(bands), [{ from: 1, to: 3 }])
  // a changed line that did not grow is not a zone
  assert.deepEqual(conflictZones([band('matched', 0, 136), band('matched', 136, 150, 0, 0), band('matched', 150, 400)]), [])
})

test('short exact bands do not end a zone', () => {
  const bands = [band('matched', 0, 500), band('inserted', 500, 500), band('matched', 500, 520, 22), band('deleted', 520, 540, 22), band('matched', 540, 900, 0)]
  assert.deepEqual(conflictZones(bands), [{ from: 1, to: 4 }])
})

test('the inexact rows beside a gap are split off so the zone can take them', () => {
  // the portfolio card: two lines of the left column changed and two were added, the
  // right column stayed. Full-width rows pair exactly up to row 2455, then none do
  // until the gap; below the gap every row pairs at the new offset.
  const bands = [band('matched', 0, 2543, 0, 0.95), band('inserted', 2543, 2543), band('matched', 2543, 2913, 43)]
  const exact = (y: number, offset: number) => (offset === 0 ? y < 2455 || (y >= 2470 && y < 2478) : true)
  const split = splitSubstitutedEdges(bands, exact)
  assert.deepEqual(split.map((b) => `${b.kind[0]}${b.baseline.start}-${b.baseline.end}@${b.offset}`), ['m0-2455@0', 'm2455-2543@0', 'i2543-2543@0', 'm2543-2913@43'])
  assert.equal(split[0]!.similarity, 1)
  assert.ok(split[1]!.similarity < 0.2, String(split[1]!.similarity))
  // the zone now starts at the changed lines, not at the gap
  assert.deepEqual(conflictZones(split), [{ from: 1, to: 3 }])
  // a band after a gap loses its inexact head the same way
  const after = [band('inserted', 0, 0), band('matched', 0, 500, 22, 0.9), band('matched', 500, 900, 22)]
  const head = splitSubstitutedEdges(after, (y) => y >= 60)
  assert.deepEqual(head.map((b) => `${b.kind[0]}${b.baseline.start}-${b.baseline.end}@${b.offset}`), ['i0-0@0', 'm0-60@22', 'm60-500@22', 'm500-900@22'])
  // bands not beside a gap, exact bands and lane bands are left alone
  const alone = [band('matched', 0, 100, 0, 0.5), { ...band('matched', 100, 200, 0, 0.5), columns: { start: 0, end: 300 } }, band('inserted', 200, 200), band('matched', 200, 300)]
  assert.deepEqual(splitSubstitutedEdges(alone, () => false).map((b) => `${b.kind[0]}${b.baseline.start}-${b.baseline.end}`), ['m0-100', 'm100-200', 'i200-200', 'm200-300'])
})

const ranges = (bands: readonly Band[]): string[] => bands.map((b) => `${b.kind[0]}${b.baseline.start}-${b.baseline.end}@${b.offset}`)
/** An oracle for one offset: every row pairs exactly except those in the given [start, end) ranges. */
const exactExcept = (offset: number, ...bad: Array<[number, number]>) => (y: number, o: number): boolean => o !== offset || !bad.some(([s, e]) => y >= s && y < e)

test('a zone ends at the nearest long run of exact rows, however much changed in place above it', () => {
  // the portfolio card: the screenshot on top of the card was re-rendered at the same size
  // (rows 273-300, 484-608, 730-758), the version under it changed (894-903) and so did a
  // date next to the columns (1150-1160); from 1201 the left column grew by 78 rows. Of the
  // rows above the columns 84% are exact, so as one band they are not stable.
  const bands = [band('matched', 0, 1414, -78, 0.71), { ...band('inserted', 1414, 1414, -78), candidate: { start: 1336, end: 1414 } }, band('matched', 1414, 2132)]
  const exact = exactExcept(-78, [273, 300], [484, 608], [730, 758], [894, 903], [1150, 1160], [1201, 1414])
  const cuts = new Set<Band>()
  const split = splitSubstitutedEdges(bands, exact, cuts)
  assert.deepEqual(ranges(split), ['m0-273@-78', 'm273-300@-78', 'm300-484@-78', 'm484-608@-78', 'm608-730@-78', 'm730-758@-78', 'm758-894@-78', 'm894-903@-78', 'm903-1150@-78', 'm1150-1201@-78', 'm1201-1414@-78', 'i1414-1414@-78', 'm1414-2132@0'])
  // every long run is a band of similarity 1, what lies between them keeps its exact share
  assert.deepEqual(split.slice(0, 11).map((b) => Number(b.similarity.toFixed(2))), [1, 0, 1, 0, 1, 0, 1, 0, 1, 0.8, 0])
  // the 41 exact rows above the columns settle where the substituted stretch ends but are too
  // few to end a zone: it climbs to the 247 exact rows above the date, and no further. The
  // heading and the image, which cross the card's gutter, stay outside.
  assert.deepEqual(conflictZones(split), [{ from: 9, to: 12 }])
  assert.equal(split[9]!.baseline.start, 1150)
  // the runs are the cut's own work, so the whole conflict is offered back as
  // well: rows 0-1414, which is the zone 0.1.7 made of it. It stops at the band
  // below, which was stable before the cut. laneAlign keeps the short zone
  // unless the wider one pairs more pixels and cuts at the same gutters, and
  // here it neither does (the lanes of the wider zone miss the card's gutter).
  assert.deepEqual(widenedZones(split, conflictZones(split), cuts), [{ from: 0, to: 12, orphan: false }])
})

test('a run of 47 exact rows does not end a zone, a run of 48 does', () => {
  const bands = [band('matched', 0, 400, 0, 0.6), band('inserted', 400, 400), band('matched', 400, 900, 22)]
  const short = splitSubstitutedEdges(bands, exactExcept(0, [100, 160], [207, 215], [262, 270], [300, 400]))
  // runs of 47, 47 and 30 rows: the zone climbs through all of them to the first 100 rows
  assert.deepEqual(ranges(short), ['m0-100@0', 'm100-300@0', 'm300-400@0', 'i400-400@0', 'm400-900@22'])
  assert.deepEqual(conflictZones(short), [{ from: 1, to: 4 }])
  const long = splitSubstitutedEdges(bands, exactExcept(0, [100, 160], [208, 215], [262, 270], [300, 400]))
  assert.deepEqual(ranges(long), ['m0-100@0', 'm100-160@0', 'm160-208@0', 'm208-300@0', 'm300-400@0', 'i400-400@0', 'm400-900@22'])
  assert.deepEqual(conflictZones(long), [{ from: 3, to: 6 }])
})

test('a band that is stable as a whole is not cut', () => {
  // a version digit changed 500 rows above the gap: 940 of the 960 settled rows are exact
  const bands = [band('matched', 0, 1000, 0, 0.94), band('inserted', 1000, 1000), band('matched', 1000, 1500, 22)]
  const cuts = new Set<Band>()
  const split = splitSubstitutedEdges(bands, exactExcept(0, [500, 520], [960, 1000]), cuts)
  assert.deepEqual(ranges(split), ['m0-960@0', 'm960-1000@0', 'i1000-1000@0', 'm1000-1500@22'])
  assert.ok(Math.abs(split[0]!.similarity - 940 / 960) < 1e-9)
  assert.deepEqual(conflictZones(split), [{ from: 1, to: 3 }])
  // nothing was cut, so there is nothing to widen and laneAlign does its one pass
  assert.equal(cuts.size, 0)
  assert.deepEqual(widenedZones(split, conflictZones(split), cuts), [])
})

test('an in-place change above a plain insertion is no zone, and the cuts merge back into the bands that came in', () => {
  // an image changed in place (rows 200-500) and a section was inserted 500 rows below it
  const bands = [band('matched', 0, 1000, 0, 0.7), band('inserted', 1000, 1000), band('matched', 1000, 1500, 22)]
  const cuts = new Set<Band>()
  const split = splitSubstitutedEdges(bands, exactExcept(0, [200, 500]), cuts)
  assert.deepEqual(ranges(split), ['m0-200@0', 'm200-500@0', 'm500-1000@0', 'i1000-1000@0', 'm1000-1500@22'])
  // the changed rows hold no gap and the gap has exact rows on both sides
  assert.deepEqual(conflictZones(split), [])
  assert.deepEqual(mergeContiguous(split), bands)
  // Both runs are the cut's own work, so the gap they orphaned is offered back as
  // the conflict rows 0-1000 were before the cut. The rows cannot say whether this
  // is an image redrawn above a plain insertion (no lanes: the test below) or a
  // card whose short column ended (lanes, see the test after it) - they are the
  // same shape. Only the pixels decide, in laneAlign's vote.
  assert.deepEqual([...cuts].map((b) => `${b.baseline.start}-${b.baseline.end}`), ['0-200', '500-1000'])
  assert.deepEqual(widenedZones(split, [], cuts), [{ from: 0, to: 4, orphan: true }])
})

test('a card whose short column ended has the same shape: one gap orphaned between two runs of the cut', () => {
  // a card of plain text, no screenshot: the left column of 8 lines gains one at row
  // 142, the right column of 16 gains one at row 416. Between the two changes every
  // row pairs exactly at the old offset, because the left column is over - so the cut
  // makes that run a stable band, and the gap of the conflict lands in a flush with no
  // substituted rows while its substituted rows land in a flush with no gap.
  const bands = [band('matched', 0, 416, 0, 0.61), band('inserted', 416, 416), band('matched', 416, 728, 22)]
  const cuts = new Set<Band>()
  const split = splitSubstitutedEdges(bands, exactExcept(0, [142, 306]), cuts)
  assert.deepEqual(ranges(split), ['m0-142@0', 'm142-306@0', 'm306-416@0', 'i416-416@0', 'm416-728@22'])
  assert.deepEqual(conflictZones(split), [])
  assert.deepEqual(widenedZones(split, [], cuts), [{ from: 0, to: 4, orphan: true }])
})

test('a conflict the cut divides can lose its zone altogether, and comes back as the one zone it was', () => {
  // 0.1.7 made rows [100,600) one zone: an insertion, 15 rows that did not pair, 200
  // rows redrawn in place far from either gap, 15 more rows and a second insertion.
  // The cut turns the two long exact runs into stable bands, and each part is left
  // with one gap and 15 substituted rows, one short of MIN_CONFLICT_ROWS.
  const bands = [band('matched', 0, 100), band('inserted', 100, 100), band('matched', 100, 600, -20, 0.54), band('inserted', 600, 600, -20), band('matched', 600, 1200, -40)]
  const cuts = new Set<Band>()
  const split = splitSubstitutedEdges(bands, exactExcept(-20, [100, 115], [200, 400], [585, 600]), cuts)
  assert.deepEqual(ranges(split), ['m0-100@0', 'i100-100@0', 'm100-115@-20', 'm115-200@-20', 'm200-400@-20', 'm400-585@-20', 'm585-600@-20', 'i600-600@-20', 'm600-1200@-40'])
  assert.deepEqual(conflictZones(split), [])
  // neither gap touches a run of the cut, but both lie in the stretch the runs
  // divide, and that stretch is the zone 0.1.7 made of them
  assert.deepEqual(widenedZones(split, [], cuts), [{ from: 1, to: 8, orphan: true }])
})

test('a cut can leave one part a zone and the other part an orphaned gap, inside one widened stretch', () => {
  // Two panes, the left one empty but for a block of text low down
  // (COLUMNS_PAIRS.emptyPane): the right pane gains a row at 164 and gives one
  // back at 438, so the page keeps its height. Between the two the left pane's
  // block, which never moved, does not pair at the shifted offset; above it 110
  // rows do, because the left pane is blank there and the right pane only moved.
  // The cut makes a stable band of those 110 rows, and what it leaves is neither
  // of the two shapes above: the lower part keeps a gap AND its substituted
  // rows, so it is still a zone and finds the panes' gutter on its own, while
  // the insertion above the run is left in a flush with no substituted rows and
  // gets no zone at all. That mixture is what laneAlign has to arbitrate here -
  // `inner` is not empty and `orphan` is set, so the parts have not explained
  // the stretch however well their one zone did, and the gutter guard `keeps`
  // cannot speak. Only the orphaned gap, which no lane covers and which
  // therefore lies across the empty pane, separates the two answers.
  const bands = [band('matched', 0, 164), band('inserted', 164, 164), band('matched', 164, 438, 22, 0.78), band('deleted', 438, 460, 22), band('matched', 460, 728)]
  const cuts = new Set<Band>()
  const split = splitSubstitutedEdges(bands, exactExcept(22, [274, 284], [296, 306], [318, 328], [340, 350], [362, 372], [384, 394]), cuts)
  assert.deepEqual(ranges(split), ['m0-164@0', 'i164-164@0', 'm164-274@22', 'm274-438@22', 'd438-460@22', 'm460-728@0'])
  assert.deepEqual([...cuts].map((b) => `${b.baseline.start}-${b.baseline.end}`), ['164-274'])
  assert.deepEqual(conflictZones(split), [{ from: 3, to: 5 }])
  assert.deepEqual(widenedZones(split, conflictZones(split), cuts), [{ from: 1, to: 5, orphan: true }])
})

test('two conflicts with a long exact run between them are two zones', () => {
  // a card grew at row 300 and another shrank at row 1000; between them an image changed in place (480-600)
  const bands = [band('matched', 0, 300), band('inserted', 300, 300), band('matched', 300, 1000, 22, 0.69), band('deleted', 1000, 1010, 22), band('matched', 1010, 1400, 12)]
  const split = splitSubstitutedEdges(bands, exactExcept(22, [300, 340], [480, 600], [940, 1000]))
  // the runs start at the settled head and end at the settled tail: no empty piece on either side
  assert.deepEqual(ranges(split), ['m0-300@0', 'i300-300@0', 'm300-340@22', 'm340-480@22', 'm480-600@22', 'm600-940@22', 'm940-1000@22', 'd1000-1010@22', 'm1010-1400@12'])
  // each conflict keeps its own rows; the image between them changed in place and is no zone
  assert.deepEqual(conflictZones(split), [
    { from: 1, to: 3 },
    { from: 6, to: 8 },
  ])
})

test('the band below a conflict is cut the same way', () => {
  // the columns end at row 530; an image far below changed in place (700-1200), and the
  // candidate has no pixels behind the last ten rows, so those never pair exactly either
  const bands = [band('matched', 0, 500), band('inserted', 500, 500), band('matched', 500, 2000, 22, 0.64)]
  const split = splitSubstitutedEdges(bands, exactExcept(22, [500, 530], [700, 1200], [1990, 2000]))
  assert.deepEqual(ranges(split), ['m0-500@0', 'i500-500@0', 'm500-530@22', 'm530-700@22', 'm700-1200@22', 'm1200-1990@22', 'm1990-2000@22'])
  assert.deepEqual(conflictZones(split), [{ from: 1, to: 3 }])
})

test('a split no zone used is merged back into one band', () => {
  const pieces = [band('matched', 0, 2455, 0, 1), band('matched', 2455, 2543, 0, 0.1), band('inserted', 2543, 2543), band('matched', 2543, 2913, 43)]
  const merged = mergeContiguous(pieces)
  assert.deepEqual(merged.map((b) => `${b.kind[0]}${b.baseline.start}-${b.baseline.end}@${b.offset}`), ['m0-2543@0', 'i2543-2543@0', 'm2543-2913@43'])
  assert.ok(Math.abs(merged[0]!.similarity - (2455 + 88 * 0.1) / 2543) < 1e-9)
  // lane bands and bands at different offsets stay apart
  const apart = [band('matched', 0, 100), { ...band('matched', 100, 200), columns: { start: 0, end: 300 } }, band('matched', 200, 300, 1)]
  assert.equal(mergeContiguous(apart).length, 3)
})

test('lanes tile the width down the middle of each gutter', () => {
  const width = 1000
  const blank = new Uint8Array(width).fill(1)
  // content at 100..450 and 500..900: one 50 px gutter, blank margins
  for (let x = 100; x < 450; x++) blank[x] = 0
  for (let x = 500; x < 900; x++) blank[x] = 0
  assert.deepEqual(laneTiles(blank, width), [
    { start: 0, end: 475 },
    { start: 475, end: 1000 },
  ])
})

test('a bullet column or a border line is not a lane, and a word gap is not a gutter', () => {
  const width = 600
  const blank = new Uint8Array(width).fill(1)
  for (let x = 20; x < 22; x++) blank[x] = 0 // a card border
  for (let x = 40; x < 48; x++) blank[x] = 0 // bullets
  for (let x = 60; x < 250; x++) blank[x] = 0 // text, with a 6 px word gap inside
  for (let x = 150; x < 156; x++) blank[x] = 1
  for (let x = 300; x < 580; x++) blank[x] = 0 // the second column
  assert.deepEqual(laneTiles(blank, width), [
    { start: 0, end: 275 },
    { start: 275, end: 600 },
  ])
})

test('a span too narrow to be a lane joins the next one, and goes back only when its gap behind is clearly the smaller', () => {
  const tiles = (width: number, ...content: Array<[number, number]>): Range[] => {
    const blank = new Uint8Array(width).fill(1)
    for (const [start, end] of content) blank.fill(0, start, end)
    return laneTiles(blank, width)
  }
  // a collapsed FAQ in a bordered card: its one long line ends 24 px beyond the others, and
  // in a zone as short as the FAQ those rows are too many for a gutter to allow for. Joined
  // to the card's right border 700 px away it would be a lane, and cut the paragraph at 485.
  // 12 px behind it against 702 ahead: the gap behind is clearly the smaller one.
  assert.deepEqual(tiles(1280, [58, 60], [61, 63], [83, 479], [491, 498], [503, 515], [1217, 1219], [1220, 1222]), [])
  // an icon after the left column's text stays with the left column: 20 px against 160
  assert.deepEqual(tiles(1000, [100, 400], [420, 440], [600, 900]), [
    { start: 0, end: 520 },
    { start: 520, end: 1000 },
  ])
  // and one before the right column's text with the right column
  assert.deepEqual(tiles(1000, [100, 400], [560, 580], [600, 900]), [
    { start: 0, end: 480 },
    { start: 480, end: 1000 },
  ])
  // a marker column of a list, 18 px from the left column's text and 33 px from its own:
  // nearer the left column, but not clearly, so it stays with the lines it marks and the
  // cut falls in the gutter. Joined to the left lane it would cut marker from line, and
  // report the unchanged markers as removed when the right column grows.
  assert.deepEqual(tiles(1040, [74, 455], [473, 485], [518, 886]), [
    { start: 0, end: 464 },
    { start: 464, end: 1040 },
  ])
  // the same at 22 px against 30
  assert.deepEqual(tiles(1040, [104, 440], [462, 470], [502, 880]), [
    { start: 0, end: 451 },
    { start: 451, end: 1040 },
  ])
  // as far from one neighbour as from the other, 70 px each way: the next one takes it, as
  // the rule reads. Joined backwards instead, the cut would fall at 525 and take 90 px of
  // the right lane with it.
  assert.deepEqual(tiles(1000, [100, 400], [470, 490], [560, 860]), [
    { start: 0, end: 435 },
    { start: 435, end: 1000 },
  ])
})

test('one content span means no lanes', () => {
  const blank = new Uint8Array(500).fill(1)
  for (let x = 50; x < 450; x++) blank[x] = 0
  assert.deepEqual(laneTiles(blank, 500), [])
})

test('one-row gaps between bands whose offsets differ by one are folded into one band', () => {
  // text lines laid out at fractional positions: 22, then 21, then 22 rows lower
  const bands = [
    band('matched', 0, 100),
    band('inserted', 100, 100),
    band('matched', 100, 140, 22),
    band('deleted', 140, 141, 22),
    band('matched', 141, 180, 21),
    { ...band('inserted', 180, 180, 21), candidate: { start: 201, end: 202 } },
    band('matched', 180, 240, 22),
    band('inserted', 240, 240, 22),
    band('matched', 240, 400, 60),
  ]
  const folded = foldWobble(bands)
  assert.deepEqual(folded.map((b) => `${b.kind[0]}${b.baseline.start}-${b.baseline.end}@${b.offset}`), ['m0-100@0', 'i100-100@0', 'm100-240@22', 'i240-240@22', 'm240-400@60'])
  // the folded band keeps one offset over its whole range
  assert.deepEqual(folded[2]!.candidate, { start: 122, end: 262 })
})

test('one-row wobble between matched bands is not a conflict', () => {
  const row = (kind: 'inserted' | 'deleted', at: number, offset: number): Band => ({ ...band(kind, at, kind === 'deleted' ? at + 1 : at, offset), candidate: { start: at + offset, end: at + offset + (kind === 'inserted' ? 1 : 0) } })
  // a paragraph of fractional line height: rows land one lower, one higher
  const wobble = [band('matched', 0, 100), band('matched', 100, 120), row('inserted', 120, 0), band('matched', 120, 140, 1), row('deleted', 140, 1), band('matched', 141, 160), band('matched', 160, 300)]
  assert.deepEqual(conflictZones(wobble), [])
  // the same wobble next to a real gap and substituted rows is still a conflict
  const conflict = [band('matched', 0, 100), band('inserted', 100, 100), band('matched', 100, 140, 22, 0.5), row('inserted', 140, 22), band('matched', 140, 160, 23), band('matched', 160, 300, 23)]
  assert.deepEqual(conflictZones(conflict), [{ from: 1, to: 5 }])
})

test('a real insertion between bands is never folded', () => {
  const bands = [band('matched', 0, 100), band('inserted', 100, 100), band('matched', 100, 200, 22)]
  assert.equal(foldWobble(bands).length, 3)
  const big = [band('matched', 0, 100), band('deleted', 100, 130), band('matched', 130, 200, 1)]
  assert.equal(foldWobble(big).length, 3)
  // two rows is a shift the differ would see, so it stays structure
  const two = [band('matched', 0, 100), band('deleted', 100, 102), band('matched', 102, 200, -2)]
  assert.equal(foldWobble(two).length, 3)
})

test('a one-row gap at the edge of a lane is absorbed by its lane', () => {
  const left = { start: 0, end: 600 }
  const right = { start: 600, end: 1280 }
  const deletedRow = (at: number, columns: Range): Band => ({ ...band('deleted', at, at + 1), columns })
  const insertedRow = (at: number, offset: number, columns: Range): Band => ({ ...band('inserted', at, at, offset), candidate: { start: at + offset, end: at + offset + 1 }, columns })
  // a deleted row at the start of a lane joins the band below it, at that band's offset
  const leading = [band('matched', 0, 100), deletedRow(100, left), { ...band('matched', 101, 200, 5), columns: left }, { ...band('matched', 100, 200), columns: right }]
  const folded = foldWobble(leading)
  assert.deepEqual(folded.map((b) => `${b.kind[0]}${b.baseline.start}-${b.baseline.end}@${b.offset}`), ['m0-100@0', 'm100-200@5', 'm100-200@0'])
  assert.deepEqual(folded[1]!.candidate, { start: 105, end: 205 })
  // a deleted row at the end of a lane joins the band above it
  const trailing = [{ ...band('matched', 0, 100), columns: left }, deletedRow(100, left), { ...band('matched', 0, 101), columns: right }, band('matched', 101, 200)]
  const t = foldWobble(trailing)
  assert.deepEqual(t.map((b) => `${b.kind[0]}${b.baseline.start}-${b.baseline.end}@${b.offset}`), ['m0-101@0', 'm0-101@0', 'm101-200@0'])
  assert.deepEqual(t[0]!.candidate, { start: 0, end: 101 })
  // an inserted row at either edge is dropped
  const inserted = [band('matched', 0, 100), insertedRow(100, 0, left), { ...band('matched', 100, 200, 1), columns: left }, insertedRow(200, 1, left), { ...band('matched', 100, 200), columns: right }, band('matched', 200, 300, 2)]
  assert.deepEqual(foldWobble(inserted).map((b) => `${b.kind[0]}${b.baseline.start}-${b.baseline.end}@${b.offset}`), ['m0-100@0', 'm100-200@1', 'm100-200@0', 'm200-300@2'])
  // a one-row gap beside a bigger gap of its lane is structure and stays
  const substitution = [band('matched', 0, 100), deletedRow(100, left), { ...band('inserted', 101, 101, 0), columns: left }, { ...band('matched', 101, 200, 21), columns: left }, { ...band('matched', 100, 200), columns: right }]
  assert.equal(foldWobble(substitution).length, 5)
})

test('bands of different lanes never fold into each other', () => {
  const left = { start: 0, end: 600 }
  const right = { start: 600, end: 1280 }
  const bands = [
    { ...band('matched', 0, 100), columns: left },
    { ...band('deleted', 100, 101), columns: right },
    { ...band('matched', 101, 200, -1), columns: right },
  ]
  // the deleted row has no matched neighbour in its own lane above it, so it joins the band below
  assert.deepEqual(foldWobble(bands).map((b) => `${b.kind[0]}${b.baseline.start}-${b.baseline.end}@${b.offset}[${b.columns!.start}-${b.columns!.end}]`), ['m0-100@0[0-600]', 'm100-200@-1[600-1280]'])
  const same = bands.map((b) => ({ ...b, columns: left }))
  assert.deepEqual(foldWobble(same).map((b) => `${b.kind[0]}${b.baseline.start}-${b.baseline.end}@${b.offset}[${b.columns!.start}-${b.columns!.end}]`), ['m0-200@0[0-600]'])
})
