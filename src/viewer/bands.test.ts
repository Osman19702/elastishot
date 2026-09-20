import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Band } from '../core/types.ts'
import { alignedLayout, laneFor, laneLayouts, mapBox, mapY, visibleRows } from './bands.ts'

const band = (kind: Band['kind'], b: [number, number], c: [number, number]): Band => ({
  kind,
  axis: 'y',
  baseline: { start: b[0], end: b[1] },
  candidate: { start: c[0], end: c[1] },
  similarity: kind === 'matched' ? 0.9 : 0,
  offset: c[0] - b[0],
})

// The portfolio case: a 1296-row card inserted at row 1458 of a 1556-row page.
const inserted = [band('matched', [0, 1458], [0, 1458]), band('inserted', [1458, 1458], [1458, 2754]), band('matched', [1458, 1556], [2754, 2852])]

test('an inserted band opens a gap on the baseline side and the layout is as tall as the candidate', () => {
  const l = alignedLayout(inserted, 1556, 2850)
  assert.equal(l.hasGaps, true)
  assert.equal(l.height, 1458 + 1296 + 98)
  assert.deepEqual(l.segments.map((s) => [s.kind, s.aligned.start, s.aligned.end]), [
    ['matched', 0, 1458],
    ['inserted', 1458, 2754],
    ['matched', 2754, 2852],
  ])
  // the band map overshot the candidate by two rows; the layout keeps the range and the drawing clips it
  assert.equal(l.segments[2]!.candidate.end, 2852)
  assert.deepEqual(visibleRows(l.segments[2]!, 'candidate', 2850), { from: 2754, count: 96, alignedStart: 2754 })
})

test('a warp that cropped the candidate leaves rows above the image; they are skipped, not stretched', () => {
  // the global warp moved the candidate up 160 rows, so the first matched band starts at warped row -160
  const l = alignedLayout([band('matched', [0, 240], [-160, 80]), band('inserted', [240, 240], [80, 240]), band('matched', [240, 680], [240, 680])], 680, 680)
  assert.equal(l.height, 840)
  assert.deepEqual(visibleRows(l.segments[0]!, 'candidate', 680), { from: 0, count: 80, alignedStart: 160 })
  assert.deepEqual(visibleRows(l.segments[0]!, 'baseline', 680), { from: 0, count: 240, alignedStart: 0 })
  assert.equal(visibleRows(l.segments[1]!, 'baseline', 680), null)
  // the inserted block in warped rows 80..240 lands where the insertion sits in the baseline
  assert.deepEqual(mapBox(l, { x: 18, y: 80, w: 764, h: 160 }, 'candidate'), { x: 18, y: 240, w: 764, h: 160 })
})

test('rows above the insertion keep their place, rows below move down by the inserted height', () => {
  const l = alignedLayout(inserted, 1556, 2850)
  assert.equal(mapY(l, 100, 'baseline'), 100)
  assert.equal(mapY(l, 100, 'candidate'), 100)
  assert.equal(mapY(l, 1500, 'baseline'), 1500 + 1296)
  assert.equal(mapY(l, 2800, 'candidate'), 2800)
  // baseline row 1458 is the first row below the insertion, so it follows the gap
  assert.equal(mapY(l, 1458, 'baseline'), 2754)
})

test('an added region keeps its full candidate box in aligned space', () => {
  const l = alignedLayout(inserted, 1556, 2850)
  assert.deepEqual(mapBox(l, { x: 268, y: 1458, w: 904, h: 1296 }, 'candidate'), { x: 268, y: 1458, w: 904, h: 1296 })
  // a baseline box below the insertion moves with its rows
  assert.deepEqual(mapBox(l, { x: 10, y: 1500, w: 50, h: 40 }, 'baseline'), { x: 10, y: 2796, w: 50, h: 40 })
})

test('a deleted band opens a gap on the candidate side', () => {
  const l = alignedLayout([band('matched', [0, 200], [0, 200]), band('deleted', [200, 350], [200, 200]), band('matched', [350, 500], [200, 350])], 500, 350)
  assert.equal(l.height, 500)
  assert.equal(mapY(l, 250, 'baseline'), 250)
  assert.equal(mapY(l, 300, 'candidate'), 450)
  assert.deepEqual(mapBox(l, { x: 0, y: 200, w: 10, h: 150 }, 'baseline'), { x: 0, y: 200, w: 10, h: 150 })
})

test('rows outside the band map are matched in place and a map with no gaps changes nothing', () => {
  const l = alignedLayout([band('matched', [64, 448], [64, 448])], 500, 500)
  assert.equal(l.hasGaps, false)
  assert.equal(l.height, 500)
  assert.equal(mapY(l, 20, 'baseline'), 20)
  assert.equal(mapY(l, 480, 'candidate'), 480)
  const empty = alignedLayout([], 300, 300)
  assert.equal(empty.height, 300)
  assert.equal(mapY(empty, 299, 'baseline'), 299)
})

test('gaps are numbered in band-map order across lanes, so each finds its row of the gaps image', () => {
  const left = { start: 0, end: 500 }
  const right = { start: 500, end: 1000 }
  const bands: Band[] = [
    band('matched', [0, 100], [0, 100]),
    { ...band('inserted', [100, 100], [100, 130]), columns: left },
    { ...band('matched', [100, 200], [130, 230]), columns: left },
    { ...band('matched', [100, 190], [100, 190]), columns: right },
    { ...band('deleted', [190, 200], [190, 190]), columns: right },
    { ...band('inserted', [200, 200], [190, 230]), columns: right },
    band('matched', [200, 300], [230, 330]),
  ]
  const lanes = laneLayouts(bands, 300, 330)
  const gaps = lanes.map((l) => l.layout.segments.filter((s) => s.kind === 'inserted' || s.kind === 'deleted').map((s) => `${s.kind[0]}${s.gap}`))
  assert.deepEqual(gaps, [['i0'], ['d1', 'i2']])
  // the right lane takes 10 rows more (it loses 10 and gains 40 where the left one gains 30): the left lane's padding is no gap of
  // the band map and has no row of its own in the gaps image, it continues the one that ends the stretch
  assert.deepEqual(lanes.map((l) => l.layout.segments.filter((s) => s.kind === 'padding').map((s) => [s.aligned.end - s.aligned.start, s.gap])), [[[10, 2]], []])
  // a plain layout numbers its gaps too; matched rows carry no number
  const plain = alignedLayout([band('matched', [0, 50], [0, 50]), band('inserted', [50, 50], [50, 70]), band('matched', [50, 100], [70, 120])], 100, 120)
  assert.deepEqual(plain.segments.map((s) => s.gap), [undefined, 0, undefined])
})

test('lane bands give each lane its own row space of one height, and boxes map through their lane', () => {
  const lane = (kind: Band['kind'], b: [number, number], c: [number, number], columns: [number, number]): Band => ({ ...band(kind, b, c), columns: { start: columns[0], end: columns[1] } })
  const bands: Band[] = [
    band('matched', [0, 100], [0, 100]),
    // left lane: 22 rows inserted at 120; right lane: the same 22 rows inserted at 300 (blank padding at the card's end)
    lane('matched', [100, 120], [100, 120], [0, 400]),
    lane('inserted', [120, 120], [120, 142], [0, 400]),
    lane('matched', [120, 400], [142, 422], [0, 400]),
    lane('matched', [100, 300], [100, 300], [400, 800]),
    lane('inserted', [300, 300], [300, 322], [400, 800]),
    lane('matched', [300, 400], [322, 422], [400, 800]),
    band('matched', [400, 600], [422, 622]),
  ]
  const lanes = laneLayouts(bands, 600, 622)
  assert.deepEqual(lanes.map((l) => [l.columns?.start, l.columns?.end, l.layout.height]), [[0, 400, 622], [400, 800, 622]])
  // a box in the left lane below the insertion moves down, the same rows in the right lane do not
  assert.deepEqual(mapBox(laneFor(lanes, { x: 50, y: 200, w: 100, h: 10 }).layout, { x: 50, y: 200, w: 100, h: 10 }, 'baseline'), { x: 50, y: 222, w: 100, h: 10 })
  assert.deepEqual(mapBox(laneFor(lanes, { x: 450, y: 200, w: 100, h: 10 }).layout, { x: 450, y: 200, w: 100, h: 10 }, 'baseline'), { x: 450, y: 200, w: 100, h: 10 })
  assert.equal(laneLayouts([band('matched', [0, 10], [0, 10])], 10, 10)[0]!.columns, null)
})

const laneBand = (kind: Band['kind'], b: [number, number], c: [number, number], columns: [number, number]): Band => ({ ...band(kind, b, c), columns: { start: columns[0], end: columns[1] } })
type Lanes = ReturnType<typeof laneLayouts>
const paddingOf = (l: Lanes[number]) => l.layout.segments.filter((s) => s.kind === 'padding').map((s) => [s.aligned.start, s.aligned.end, s.gap])
/** Where a full-width band starts in each lane's rows. */
const startOf = (lanes: Lanes, b: Band) => lanes.map((l) => l.layout.segments.find((s) => s.kind === b.kind && s.baseline === b.baseline)?.aligned.start)

// The band map the engine gives for COLUMNS_PAIRS.grown (test/fixtures/synth.ts), the pair the viewer tests
// in test/viewer/aligned.test.ts draw: the card grew by 66 rows; the left column gained 132 and lost the 66
// rows of blank padding it had under it, the right one gained 66.
const belowCard = band('matched', [738, 1006], [804, 1072])
const columnsCard: Band[] = [
  band('matched', [0, 442], [0, 442]),
  laneBand('matched', [442, 574], [442, 574], [0, 473]),
  laneBand('inserted', [574, 574], [574, 662], [0, 473]),
  laneBand('matched', [574, 640], [662, 728], [0, 473]),
  laneBand('inserted', [640, 640], [728, 772], [0, 473]),
  laneBand('matched', [640, 672], [772, 804], [0, 473]),
  // the two levelling gaps the engine marks blank: rows of card padding, no content, no region
  { ...laneBand('deleted', [672, 738], [804, 804], [0, 473]), blank: true },
  laneBand('matched', [442, 486], [442, 486], [473, 1040]),
  laneBand('inserted', [486, 486], [486, 508], [473, 1040]),
  laneBand('matched', [486, 738], [508, 760], [473, 1040]),
  { ...laneBand('inserted', [738, 738], [760, 804], [473, 1040]), blank: true },
  belowCard,
]

test('a blank gap of one lane is marked, so it is filled but never tinted; a gap across the full width is not', () => {
  const lanes = laneLayouts(columnsCard, 1006, 1072)
  // the card's two levelling gaps: 66 rows closed up under the left column, 44 opened up under the right one
  assert.deepEqual(lanes.map((l) => l.layout.segments.filter((s) => s.blank).map((s) => [s.kind, s.aligned.end - s.aligned.start])), [[['deleted', 66]], [['inserted', 44]]])
  // they stay gaps: one side's rows, their own aligned rows, and their own row of the gaps image to fill them
  const closed = lanes[0]!.layout.segments.find((s) => s.blank)!
  assert.deepEqual([closed.baseline, closed.candidate, closed.gap], [{ start: 672, end: 738 }, { start: 804, end: 804 }, 2])
  assert.deepEqual([closed.aligned.start, closed.aligned.end], [804, 870])
  // and they are the only untinted rows besides the padding, which is what levels the lanes with them
  assert.deepEqual(lanes.map((l) => l.layout.segments.filter((s) => (s.kind === 'inserted' || s.kind === 'deleted') && !s.blank).length), [2, 1])
  // padding is untinted by its kind and carries no flag of its own
  assert.deepEqual(lanes.map((l) => l.layout.segments.filter((s) => s.kind === 'padding').map((s) => [s.aligned.end - s.aligned.start, s.blank])), [[], [[66, undefined]]])
  // a blank block across the whole width is a spacing change: it is reported as a whitespace-only region and keeps its tint
  const full = alignedLayout([band('matched', [0, 432], [0, 432]), { ...band('inserted', [432, 432], [432, 552]), blank: true }, band('matched', [432, 864], [552, 984])], 864, 984)
  assert.deepEqual(full.segments.map((s) => s.blank), [undefined, undefined, undefined])
})

test('a box that ends where a gap starts keeps its height: the gap and the padding after it are in neither box', () => {
  const lanes = laneLayouts(columnsCard, 1006, 1072)
  const [left, right] = [lanes[0]!.layout, lanes[1]!.layout]
  // the right column's last line, 10 rows ending on baseline row 738 — the row its own gap sits at, with the
  // lane's padding right behind it. That line is edited in place in the pair, so this is one of its regions,
  // not a made-up box. Mapping the row after the box put its foot below both: {y:750,h:120}
  assert.deepEqual(mapBox(right, { x: 500, y: 728, w: 315, h: 10 }, 'baseline'), { x: 500, y: 750, w: 315, h: 10 })
  // the same in the lane that is not padded: a box ending on row 640, where that lane's second gap sits
  assert.deepEqual(mapBox(left, { x: 104, y: 630, w: 200, h: 10 }, 'baseline'), { x: 104, y: 718, w: 200, h: 10 })
  // a box that genuinely spans a gap still keeps both edges: the left column's 44 inserted rows and the line above them
  assert.deepEqual(mapBox(left, { x: 104, y: 630, w: 200, h: 20 }, 'baseline'), { x: 104, y: 718, w: 200, h: 64 })
  // a candidate box whose last row falls past the image stays on the stage
  assert.deepEqual(mapBox(right, { x: 500, y: 1062, w: 100, h: 20 }, 'candidate'), { x: 500, y: 1128, w: 100, h: 10 })
  // and a box of no height is still a row
  assert.deepEqual(mapBox(right, { x: 500, y: 728, w: 315, h: 0 }, 'baseline'), { x: 500, y: 750, w: 315, h: 1 })
})

test('a lane that gains and loses rows is taller than the one beside it: the shorter lane is padded where the full width resumes', () => {
  const lanes = laneLayouts(columnsCard, 1006, 1072)
  // baseline rows plus inserted rows: 1006 + 132 on the left, 1006 + 66 on the right, which used to stay 66 short
  assert.deepEqual(lanes.map((l) => l.layout.height), [1138, 1138])
  assert.deepEqual(startOf(lanes, belowCard), [870, 870])
  // the padding follows the right lane's own rows and continues the fill of a gap next to it: gap 2 (the left
  // lane's deleted rows) is as near as the lane's own gap 4, which wins the tie
  assert.deepEqual(lanes.map(paddingOf), [[], [[804, 870, 4]]])
  const left = lanes[0]!.layout
  const right = lanes[1]!.layout
  // a row below the card has one aligned row, whichever lane it is mapped through, on both sides
  for (const y of [738, 800, 1005]) assert.equal(mapY(left, y, 'baseline'), mapY(right, y, 'baseline'), `baseline row ${y}`)
  for (const y of [804, 900, 1071]) assert.equal(mapY(left, y, 'candidate'), mapY(right, y, 'candidate'), `candidate row ${y}`)
  assert.equal(mapY(left, 800, 'baseline'), 932)
  assert.equal(mapY(right, 866, 'candidate'), 932)
  // so a box under the card is drawn at one height, wherever its centre falls
  assert.deepEqual(mapBox(laneFor(lanes, { x: 104, y: 790, w: 200, h: 10 }).layout, { x: 104, y: 790, w: 200, h: 10 }, 'baseline'), { x: 104, y: 922, w: 200, h: 10 })
  assert.deepEqual(mapBox(laneFor(lanes, { x: 600, y: 790, w: 200, h: 10 }).layout, { x: 600, y: 790, w: 200, h: 10 }, 'baseline'), { x: 600, y: 922, w: 200, h: 10 })
  // inside the card each lane keeps its own rows: baseline row 700 is 132 rows lower on the left, 22 on the right
  assert.equal(mapY(left, 700, 'baseline'), 832)
  assert.equal(mapY(right, 700, 'baseline'), 722)
  // padding holds no rows: it is a gap of neither side's band map and nothing is drawn from an image into it
  const padding = right.segments.find((s) => s.kind === 'padding')!
  assert.deepEqual([padding.baseline, padding.candidate], [{ start: 738, end: 738 }, { start: 804, end: 804 }])
  assert.equal(visibleRows(padding, 'baseline', 1006), null)
  assert.equal(visibleRows(padding, 'candidate', 1072), null)
})

test('the padding goes where the last gap of the stretch ends: the rows below it line up across the lanes', () => {
  // As on the portfolio page: the left lane gains 50 rows and loses the 40 rows of padding under its column,
  // the right lane gains 10 rows early on, and the card's last 60 rows (440..500) follow in both.
  const below = band('matched', [500, 600], [510, 610])
  const bands: Band[] = [
    band('matched', [0, 100], [0, 100]),
    laneBand('matched', [100, 300], [100, 300], [0, 700]),
    laneBand('inserted', [300, 300], [300, 350], [0, 700]),
    laneBand('matched', [300, 400], [350, 450], [0, 700]),
    laneBand('deleted', [400, 440], [450, 450], [0, 700]),
    laneBand('matched', [440, 500], [450, 510], [0, 700]),
    laneBand('matched', [100, 200], [100, 200], [700, 1400]),
    laneBand('inserted', [200, 200], [200, 210], [700, 1400]),
    laneBand('matched', [200, 500], [210, 510], [700, 1400]),
    below,
  ]
  const lanes = laneLayouts(bands, 600, 610)
  assert.deepEqual(lanes.map((l) => l.layout.height), [650, 650])
  assert.deepEqual(startOf(lanes, below), [550, 550])
  // the right lane's matched rows are cut at row 440, where the left lane's deleted rows end, and padded there:
  // under the stretch's last rows the card's bottom edge would be drawn 40 rows higher on the right than on the left
  assert.deepEqual(lanes.map(paddingOf), [[], [[450, 490, 1]]])
  const right = lanes[1]!.layout
  assert.deepEqual(right.segments.map((s) => `${s.kind[0]}${s.baseline.start}-${s.baseline.end}/${s.candidate.start}-${s.candidate.end}@${s.aligned.start}`), [
    'm0-100/0-100@0',
    'm100-200/100-200@100',
    'i200-200/200-210@200',
    'm200-440/210-450@210',
    'p440-440/450-450@450',
    'm440-500/450-510@490',
    'm500-600/510-610@550',
  ])
  for (const y of [440, 470, 499, 500]) assert.equal(mapY(lanes[0]!.layout, y, 'baseline'), mapY(right, y, 'baseline'), `baseline row ${y}`)
  for (const y of [450, 480, 509, 510]) assert.equal(mapY(lanes[0]!.layout, y, 'candidate'), mapY(right, y, 'candidate'), `candidate row ${y}`)
  // above it each lane keeps its own rows
  assert.equal(mapY(lanes[0]!.layout, 350, 'baseline'), 400)
  assert.equal(mapY(right, 350, 'baseline'), 360)
})

test('lanes that come out level get no padding', () => {
  const bands: Band[] = [
    band('matched', [0, 100], [0, 100]),
    laneBand('inserted', [100, 100], [100, 130], [0, 500]),
    laneBand('matched', [100, 200], [130, 230], [0, 500]),
    laneBand('matched', [100, 200], [100, 200], [500, 1000]),
    laneBand('inserted', [200, 200], [200, 230], [500, 1000]),
    band('matched', [200, 300], [230, 330]),
  ]
  const lanes = laneLayouts(bands, 300, 330)
  assert.deepEqual(lanes.map((l) => l.layout.height), [330, 330])
  assert.deepEqual(lanes.map(paddingOf), [[], []])
})

test('a stretch of lanes in the middle of the page followed by another, cut a pixel apart: both end level', () => {
  const between = band('matched', [300, 500], [310, 510])
  const end = band('matched', [600, 700], [605, 705])
  const bands: Band[] = [
    band('matched', [0, 100], [0, 100]),
    // the page grows by 10 rows here: the left lane gains 30 and loses 20, the right one gains 10
    laneBand('matched', [100, 150], [100, 150], [0, 400]),
    laneBand('inserted', [150, 150], [150, 180], [0, 400]),
    laneBand('matched', [150, 250], [180, 280], [0, 400]),
    laneBand('deleted', [250, 270], [280, 280], [0, 400]),
    laneBand('matched', [270, 300], [280, 310], [0, 400]),
    laneBand('matched', [100, 300], [100, 300], [400, 800]),
    laneBand('inserted', [300, 300], [300, 310], [400, 800]),
    between,
    // and shrinks by 5 here, where the gutter was measured one column further right:
    // the left lane loses 5 rows, the right one gains 10 and loses 15
    laneBand('matched', [500, 595], [510, 605], [0, 401]),
    laneBand('deleted', [595, 600], [605, 605], [0, 401]),
    laneBand('inserted', [500, 500], [510, 520], [401, 800]),
    laneBand('matched', [500, 585], [520, 605], [401, 800]),
    laneBand('deleted', [585, 600], [605, 605], [401, 800]),
    end,
  ]
  const lanes = laneLayouts(bands, 700, 705)
  // one lane per column span, not one per reported lane: column 400 is in the right lane above and in the left one below
  assert.deepEqual(lanes.map((l) => [l.columns?.start, l.columns?.end]), [[0, 400], [400, 401], [401, 800]])
  assert.deepEqual(lanes.map((l) => l.layout.height), [740, 740, 740])
  assert.deepEqual(startOf(lanes, between), [330, 330, 330])
  assert.deepEqual(startOf(lanes, end), [640, 640, 640])
  // gaps in band order: i150 d250 i300 | d595 i500 d585. Each padding continues the gap that ends its stretch, the lane's own on a tie
  assert.deepEqual(lanes.map(paddingOf), [[[630, 640, 3]], [[310, 330, 2], [630, 640, 3]], [[310, 330, 2]]])
  // the sliver follows the lane it is part of in each stretch
  const rows = (l: Lanes[number]) => l.layout.segments.filter((s) => s.kind !== 'padding').map((s) => `${s.kind[0]}${s.baseline.start}-${s.baseline.end}`).join(' ')
  assert.equal(rows(lanes[1]!), 'm0-100 m100-300 i300-300 m300-500 m500-595 d595-600 m600-700')
  // every box lands in exactly one lane
  assert.equal(laneFor(lanes, { x: 400, y: 0, w: 1, h: 1 }), lanes[1])
  assert.equal(laneFor(lanes, { x: 380, y: 0, w: 30, h: 1 }), lanes[0])
})

test('a lane that only loses rows is padded to the one that also gains some', () => {
  const end = band('matched', [400, 500], [370, 470])
  const bands: Band[] = [
    band('matched', [0, 100], [0, 100]),
    laneBand('matched', [100, 300], [100, 300], [0, 600]),
    laneBand('deleted', [300, 330], [300, 300], [0, 600]),
    laneBand('matched', [330, 400], [300, 370], [0, 600]),
    laneBand('matched', [100, 150], [100, 150], [600, 1200]),
    laneBand('inserted', [150, 150], [150, 160], [600, 1200]),
    laneBand('matched', [150, 360], [160, 370], [600, 1200]),
    laneBand('deleted', [360, 400], [370, 370], [600, 1200]),
    end,
  ]
  const lanes = laneLayouts(bands, 500, 470)
  // the aligned rows of a lane are its baseline rows plus what it gained: 500 on the left, 510 on the right
  assert.deepEqual(lanes.map((l) => l.layout.height), [510, 510])
  assert.deepEqual(startOf(lanes, end), [410, 410])
  // the right lane's deleted rows (gap 2) end the stretch, so theirs is the nearest fill
  assert.deepEqual(lanes.map(paddingOf), [[[400, 410, 2]], []])
})

test('lanes that run to the end of the page are levelled there, and a box that ends on the last row ends above the padding', () => {
  const bands: Band[] = [
    band('matched', [0, 100], [0, 100]),
    laneBand('matched', [100, 200], [100, 200], [0, 300]),
    laneBand('inserted', [200, 200], [200, 240], [0, 300]),
    laneBand('matched', [200, 260], [240, 300], [0, 300]),
    laneBand('deleted', [260, 300], [300, 300], [0, 300]),
    laneBand('matched', [100, 300], [100, 300], [300, 600]),
  ]
  const lanes = laneLayouts(bands, 300, 300)
  assert.deepEqual(lanes.map((l) => l.layout.height), [340, 340])
  assert.deepEqual(lanes.map(paddingOf), [[], [[300, 340, 1]]])
  assert.deepEqual(mapBox(lanes[1]!.layout, { x: 300, y: 280, w: 100, h: 20 }, 'baseline'), { x: 300, y: 280, w: 100, h: 20 })
  // Rows a map leaves out are compared in place, 10 of them in the left lane here. A map that is odd enough to
  // make lanes differ without a gap is levelled all the same, and its padding has no fill to continue.
  const odd = laneLayouts([laneBand('matched', [0, 100], [0, 100], [0, 300]), laneBand('matched', [100, 200], [110, 210], [0, 300]), laneBand('matched', [0, 200], [0, 210], [300, 600]), band('matched', [200, 300], [210, 310])], 300, 310)
  assert.deepEqual(odd.map((l) => l.layout.height), [310, 310])
  assert.deepEqual(odd.map(paddingOf), [[], [[200, 210, undefined]]])
  assert.deepEqual(odd.map((l) => l.layout.hasGaps), [false, false])
})

test('a map without lanes is laid out as before, byte for byte', () => {
  const bands = [band('matched', [8, 200], [8, 200]), band('inserted', [200, 200], [200, 260]), band('matched', [200, 300], [260, 360]), band('deleted', [300, 340], [360, 360]), band('matched', [340, 480], [361, 501])]
  // what the layout gave before lanes were levelled, the map's one-row hole included
  const before =
    '[{"columns":null,"layout":{"height":561,"segments":[{"kind":"matched","baseline":{"start":0,"end":8},"candidate":{"start":0,"end":8},"aligned":{"start":0,"end":8}},{"kind":"matched","baseline":{"start":8,"end":200},"candidate":{"start":8,"end":200},"aligned":{"start":8,"end":200}},{"kind":"inserted","baseline":{"start":200,"end":200},"candidate":{"start":200,"end":260},"aligned":{"start":200,"end":260},"gap":0},{"kind":"matched","baseline":{"start":200,"end":300},"candidate":{"start":260,"end":360},"aligned":{"start":260,"end":360}},{"kind":"deleted","baseline":{"start":300,"end":340},"candidate":{"start":360,"end":360},"aligned":{"start":360,"end":400},"gap":1},{"kind":"matched","baseline":{"start":340,"end":341},"candidate":{"start":360,"end":361},"aligned":{"start":400,"end":401}},{"kind":"matched","baseline":{"start":340,"end":480},"candidate":{"start":361,"end":501},"aligned":{"start":401,"end":541}},{"kind":"matched","baseline":{"start":480,"end":500},"candidate":{"start":501,"end":521},"aligned":{"start":541,"end":561}}],"hasGaps":true}}]'
  assert.equal(JSON.stringify(laneLayouts(bands, 500, 520)), before)
  assert.equal(JSON.stringify(alignedLayout(bands, 500, 520)), JSON.stringify(JSON.parse(before)[0].layout))
})
