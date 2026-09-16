import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Band } from '../../core/types.ts'
import { conflictZones, laneTiles } from './lanes.ts'

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
