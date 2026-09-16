import assert from 'node:assert/strict'
import { test } from 'node:test'

import { alignRows, hashRow, NO_ROW } from './row-align.ts'

// Rows are small integers standing in for hashes; letters make the cases readable.
const rows = (s: string): number[] => [...s].map((ch) => (ch === '_' ? 0 : ch.charCodeAt(0)))
const blankOf = (s: string): number[] => [...s].map((ch) => (ch === '_' ? 1 : 0))
const describe = (runs: ReturnType<typeof alignRows>) => runs.map((r) => `${r.kind[0]}${r.b0}-${r.b1}/${r.c0}-${r.c1}`).join(' ')

test('identical sequences are one matched run', () => {
  assert.equal(describe(alignRows({ a: rows('abcdef'), b: rows('abcdef') })), 'm0-6/0-6')
})

test('an inserted block lands exactly where it was inserted, rows below keep their offset', () => {
  // an FAQ answer of three rows opened between c and d
  assert.equal(describe(alignRows({ a: rows('abcdef'), b: rows('abcXYZdef') })), 'm0-3/0-3 i3-3/3-6 m3-6/6-9')
})

test('a deleted block is a deletion, not a substitution', () => {
  assert.equal(describe(alignRows({ a: rows('abcXYZdef'), b: rows('abcdef') })), 'm0-3/0-3 d3-6/3-3 m6-9/3-6')
})

test('rows appended after look-alike rows are an insertion at the end, not a shift of the block', () => {
  // a changelog: rows p q r s, then three new rows u v w appended; the footer f stays put
  const a = rows('__pqrs__f')
  const b = rows('__pqrsuvw__f')
  assert.equal(describe(alignRows({ a, b, blankA: blankOf('__pqrs__f'), blankB: blankOf('__pqrsuvw__f') })), 'm0-6/0-6 i6-6/6-9 m6-9/9-12')
})

test('changed rows between unchanged ones become a substitution the differ can compare', () => {
  // one digit of a version label changed: the two rows of the label differ, everything else is the same
  assert.equal(describe(alignRows({ a: rows('abcdef'), b: rows('abXYef') })), 'm0-6/0-6')
})

test('a changed block that also grew is a substitution plus an insertion', () => {
  assert.equal(describe(alignRows({ a: rows('abcdef'), b: rows('abXYZWef') })), 'm0-4/0-4 i4-4/4-6 m4-6/6-8')
})

test('unique rows anchor the alignment across a run of repeated rows', () => {
  // zebra table rows z repeat; the unique rows k and m fix where the two new rows go
  assert.equal(describe(alignRows({ a: rows('kzzzm'), b: rows('kzzzzzm') })), 'm0-4/0-4 i4-4/4-6 m4-5/6-7')
})

test('rows with no candidate pixels never match', () => {
  const b = rows('abcdef')
  b[2] = NO_ROW
  assert.equal(describe(alignRows({ a: rows('abcdef'), b })), 'm0-6/0-6')
})

test('hashRow tells rows apart and is stable', () => {
  const data = new Uint8Array([1, 2, 3, 4, 1, 2, 3, 5])
  assert.equal(hashRow(data, 0, 4), hashRow(data, 0, 4))
  assert.notEqual(hashRow(data, 0, 4), hashRow(data, 4, 8))
  assert.ok(Number.isSafeInteger(hashRow(data, 0, 8)))
})

test('a long page with one insertion and one changed row aligns in a few runs', () => {
  const n = 3000
  const a = Array.from({ length: n }, (_, i) => 1000 + i)
  const b = [...a.slice(0, 1200), ...Array.from({ length: 34 }, (_, i) => 5000 + i), ...a.slice(1200)]
  b[2000] = 9999 // one changed row below the insertion
  const runs = alignRows({ a, b })
  assert.equal(describe(runs), 'm0-1200/0-1200 i1200-1200/1200-1234 m1200-3000/1234-3034')
})
