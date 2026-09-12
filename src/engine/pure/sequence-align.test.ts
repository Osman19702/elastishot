import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  alignSequences,
  mergeAdjacentMatched,
  OP_DELETE,
  OP_INSERT,
  OP_MATCH,
  opsToRuns,
  repairSubstitutions,
  type Run,
} from './sequence-align.ts'

const params = { gapOpen: 0.6, gapExtend: 0.08, matchThreshold: 0.55 }
const bySymbol = (a: string, b: string) => (i: number, j: number) => (a[i] === b[j] ? 1 : 0)

test('identical sequences align as one matched run', () => {
  const ops = alignSequences(5, 5, bySymbol('abcde', 'abcde'), params)
  assert.deepEqual(ops, [OP_MATCH, OP_MATCH, OP_MATCH, OP_MATCH, OP_MATCH])
  assert.deepEqual(opsToRuns(ops), [{ kind: 'matched', b0: 0, b1: 5, c0: 0, c1: 5 }])
})

test('a removed block becomes a deleted run and the rest stays matched', () => {
  const ops = alignSequences(8, 5, bySymbol('abcXYZde', 'abcde'), params)
  assert.deepEqual(opsToRuns(ops), [
    { kind: 'matched', b0: 0, b1: 3, c0: 0, c1: 3 },
    { kind: 'deleted', b0: 3, b1: 6, c0: 3, c1: 3 },
    { kind: 'matched', b0: 6, b1: 8, c0: 3, c1: 5 },
  ])
})

test('an inserted block becomes an inserted run', () => {
  const ops = alignSequences(5, 8, bySymbol('abcde', 'abcXYZde'), params)
  assert.deepEqual(opsToRuns(ops), [
    { kind: 'matched', b0: 0, b1: 3, c0: 0, c1: 3 },
    { kind: 'inserted', b0: 3, b1: 3, c0: 3, c1: 6 },
    { kind: 'matched', b0: 3, b1: 5, c0: 6, c1: 8 },
  ])
})

test('empty sides and full consumption', () => {
  assert.deepEqual(alignSequences(0, 3, () => 0, params), [OP_INSERT, OP_INSERT, OP_INSERT])
  assert.deepEqual(alignSequences(2, 0, () => 0, params), [OP_DELETE, OP_DELETE])
  const ops = alignSequences(7, 9, bySymbol('aXbcYdZ', 'abQcdRRSZ'), params)
  const runs = opsToRuns(ops)
  const last = runs[runs.length - 1]!
  assert.equal(last.b1, 7)
  assert.equal(last.c1, 9)
})

test('cheap end gaps make a shifted sequence a leading gap, not an interior one', () => {
  // baseline 'xabcd' vs candidate 'abcd': the x is cropped away. 'x' and 'a' are similar enough to tie an interior gap.
  const sim = (i: number, j: number) => {
    const a = 'xabcd'[i]!
    const b = 'abcd'[j]!
    if (a === b) return 1
    if (a === 'x' && b === 'a') return 0.7
    return 0
  }
  const interior = opsToRuns(alignSequences(5, 4, sim, params))
  const semiGlobal = opsToRuns(alignSequences(5, 4, sim, { ...params, endGapOpen: 0 }))
  assert.deepEqual(semiGlobal, [
    { kind: 'deleted', b0: 0, b1: 1, c0: 0, c1: 0 },
    { kind: 'matched', b0: 1, b1: 5, c0: 0, c1: 4 },
  ])
  assert.ok(interior.length >= 2)
})

test('repairSubstitutions pairs adjacent deleted and inserted runs', () => {
  const runs: Run[] = [
    { kind: 'matched', b0: 0, b1: 2, c0: 0, c1: 2 },
    { kind: 'deleted', b0: 2, b1: 5, c0: 2, c1: 2 },
    { kind: 'inserted', b0: 5, b1: 5, c0: 2, c1: 4 },
    { kind: 'matched', b0: 5, b1: 7, c0: 4, c1: 6 },
  ]
  // the paired strips continue the previous matched run with the same offset, so they merge into it
  assert.deepEqual(repairSubstitutions(runs), [
    { kind: 'matched', b0: 0, b1: 4, c0: 0, c1: 4 },
    { kind: 'deleted', b0: 4, b1: 5, c0: 4, c1: 4 },
    { kind: 'matched', b0: 5, b1: 7, c0: 4, c1: 6 },
  ])
})

test('mergeAdjacentMatched joins runs with the same offset only', () => {
  const runs: Run[] = [
    { kind: 'matched', b0: 0, b1: 2, c0: 0, c1: 2 },
    { kind: 'matched', b0: 2, b1: 4, c0: 2, c1: 4 },
    { kind: 'inserted', b0: 4, b1: 4, c0: 4, c1: 5 },
    { kind: 'matched', b0: 4, b1: 6, c0: 5, c1: 7 },
  ]
  assert.deepEqual(mergeAdjacentMatched(runs), [
    { kind: 'matched', b0: 0, b1: 4, c0: 0, c1: 4 },
    { kind: 'inserted', b0: 4, b1: 4, c0: 4, c1: 5 },
    { kind: 'matched', b0: 4, b1: 6, c0: 5, c1: 7 },
  ])
})
