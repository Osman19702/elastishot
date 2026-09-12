import assert from 'node:assert/strict'
import { test } from 'node:test'

import { evaluate } from './thresholds.ts'
import type { DiffRegion, RegionKind } from './types.ts'

const region = (kind: RegionKind, score: number): DiffRegion => ({
  id: 'r',
  kind,
  boxBaseline: null,
  boxCandidate: null,
  score,
  pixelsChanged: 0,
  areaFraction: 0,
  meanDelta: 0,
  confidence: 1,
  tags: [],
})

test('passes when similarity is high and there are no regions', () => {
  assert.deepEqual(evaluate({ summary: { similarity: 0.995 }, regions: [] }), { pass: true, reasons: [] })
})

test('reports each failing reason', () => {
  const e = evaluate({ summary: { similarity: 0.9 }, regions: [region('removed', 0.5), region('changed', 0.01)] })
  assert.equal(e.pass, false)
  assert.equal(e.reasons.length, 2)
  assert.match(e.reasons[0]!, /0\.9 is below the threshold 0\.98/)
  assert.match(e.reasons[1]!, /1 removed region at or above score 0\.05/)
})

test('failOn narrows the kinds that fail and none ignores regions', () => {
  const regions = [region('moved', 0.9), region('added', 0.9)]
  assert.equal(evaluate({ summary: { similarity: 1 }, regions }, { failOn: ['changed'] }).pass, true)
  assert.equal(evaluate({ summary: { similarity: 1 }, regions }, { failOn: 'none' }).pass, true)
  const e = evaluate({ summary: { similarity: 1 }, regions }, { failOn: ['moved', 'added'] })
  assert.equal(e.reasons.length, 2)
})

test('threshold and minRegionScore can be lowered', () => {
  const e = evaluate({ summary: { similarity: 0.7 }, regions: [region('changed', 0.2)] }, { threshold: 0.5, minRegionScore: 0.3 })
  assert.equal(e.pass, true)
})
