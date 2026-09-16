import assert from 'node:assert/strict'
import { test } from 'node:test'

import { columnModes, pickGapFill, SAMPLE_ROWS } from './gap-fill.ts'

const W = 200
const row = (paint: (x: number) => [number, number, number]): Uint8ClampedArray => {
  const d = new Uint8ClampedArray(W * 4)
  for (let x = 0; x < W; x++) {
    const [r, g, b] = paint(x)
    d[x * 4] = r
    d[x * 4 + 1] = g
    d[x * 4 + 2] = b
    d[x * 4 + 3] = 255
  }
  return d
}
const px = (d: ArrayLike<number>, x: number): [number, number, number] => [d[x * 4]!, d[x * 4 + 1]!, d[x * 4 + 2]!]
const dark: [number, number, number] = [24, 28, 40]
const card: [number, number, number] = [30, 36, 52]
const ink: [number, number, number] = [220, 224, 230]
// a card on the page with a one-pixel border down its left edge
const cardRow = row((x) => (x === 20 ? [90, 90, 120] : x >= 21 && x < 180 ? card : dark))
// a line of text on the card: glyph stems in every sixth column
const textRow = row((x) => (x === 20 ? [90, 90, 120] : x >= 21 && x < 180 ? (x % 6 < 2 ? ink : card) : dark))

test('each column takes its most common colour: backgrounds and borders stay, text goes', () => {
  // 22 rows of a text line, 26 rows of card around it
  const rows = [...Array(26).fill(cardRow), ...Array(22).fill(textRow)]
  const modes = columnModes(rows)
  assert.deepEqual(px(modes, 5), dark)
  assert.deepEqual(px(modes, 20), [90, 90, 120])
  assert.deepEqual(px(modes, 24), card) // a glyph stem column
  assert.deepEqual(px(modes, 27), card)
  assert.equal(modes[24 * 4 + 3], 255)
})

test('antialiased pixels group with their background and the exact background value is kept', () => {
  const soft = row((x) => (x % 2 ? [26, 30, 42] : dark))
  const modes = columnModes(Array.from({ length: 7 }, () => row(() => dark)).concat([soft]))
  assert.deepEqual(px(modes, 1), dark)
  // a stronger edge pixel is its own bucket and loses to the background
  const edge = row((x) => (x % 2 ? [120, 120, 140] : dark))
  assert.deepEqual(px(columnModes([edge, row(() => dark), row(() => dark)]), 1), dark)
})

test('the gap samples the rows on both sides of it, as many as exist', () => {
  const seen: number[] = []
  const reader = (y: number) => {
    seen.push(y)
    return y >= 0 && y < 100 ? (y >= 47 && y <= 52 ? textRow : cardRow) : null
  }
  const fill = pickGapFill(reader, 100, 49, 50)
  assert.equal(fill.kind, 'colours')
  assert.deepEqual(px((fill as { data: Uint8ClampedArray }).data, 24), card)
  assert.equal(Math.min(...seen), 49 - SAMPLE_ROWS + 1)
  assert.equal(Math.max(...seen), 50 + SAMPLE_ROWS - 1)
  // a gap at the top of the image has only rows below it
  seen.length = 0
  pickGapFill(reader, 100, -1, 0)
  assert.equal(Math.min(...seen), 0)
  assert.equal(seen.length, SAMPLE_ROWS)
  // a gap near the bottom stops at the image's last row
  seen.length = 0
  pickGapFill(reader, 100, 89, 90)
  assert.equal(Math.max(...seen), 99)
})

test('unreadable pixels fall back to the adjacent row itself, and no rows at all to nothing', () => {
  assert.deepEqual(pickGapFill(() => null, 100, 49, 50), { kind: 'row', y: 49 })
  assert.deepEqual(pickGapFill(() => null, 100, -1, 50), { kind: 'row', y: 50 })
  assert.deepEqual(pickGapFill(() => null, 100, -1, -1), { kind: 'none' })
})
