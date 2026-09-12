import assert from 'node:assert/strict'
import { test } from 'node:test'

import { alignmentConfidence, gapScore, median, regionScore, similarityScore } from './scoring.ts'

test('scores stay within 0..1 and respond to their inputs', () => {
  assert.equal(regionScore(0, 0, 0, 1000), 0)
  assert.equal(regionScore(1, 1, 1e9, 1000), 1)
  assert.ok(regionScore(0.5, 0.2, 10, 100000) < regionScore(0.9, 0.2, 10, 100000))
  assert.ok(gapScore(100, 1_000_000, false) >= 0.4)
  assert.ok(gapScore(100_000, 1_000_000, false) === 1)
  assert.ok(gapScore(100_000, 1_000_000, true) <= 0.1)
})

test('alignment confidence and similarity', () => {
  assert.ok(Math.abs(alignmentConfidence(100, 1, 1, 0) - 1) < 1e-9)
  assert.ok(alignmentConfidence(5, 0.1, 0.1, 5) < 0.2)
  assert.ok(Math.abs(similarityScore(0, 1) - 1) < 1e-9)
  assert.ok(similarityScore(0, 0) <= 0.9 + 1e-9)
  assert.equal(similarityScore(1, 1), 0)
})

test('median', () => {
  assert.equal(median([]), 0)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
})
