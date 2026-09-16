import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Band, Range } from '../../core/types.ts'
import { conflictZones, foldWobble, laneTiles } from './lanes.ts'

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
