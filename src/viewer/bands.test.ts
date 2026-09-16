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
  const gaps = lanes.map((l) => l.layout.segments.filter((s) => s.kind !== 'matched').map((s) => `${s.kind[0]}${s.gap}`))
  assert.deepEqual(gaps, [['i0'], ['d1', 'i2']])
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
