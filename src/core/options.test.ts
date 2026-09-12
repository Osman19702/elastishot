import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isElastishotError } from './errors.ts'
import { DEFAULT_COMPARE_OPTIONS, resolveCompareOptions } from './options.ts'

test('defaults are complete', () => {
  const o = resolveCompareOptions()
  assert.equal(o.workingWidth, 1024)
  assert.equal(o.alignMode, 'auto')
  assert.deepEqual(o.thresholds.failOn, ['added', 'removed', 'changed', 'moved'])
  assert.equal(o.diff.method, 'yiq')
  assert.equal(o.signal, undefined)
})

test('layers merge per section and later layers win', () => {
  const o = resolveCompareOptions({ diff: { threshold: 0.2 } }, { diff: { mergeGapPx: 3 }, workingWidth: 0 }, undefined)
  assert.equal(o.diff.threshold, 0.2)
  assert.equal(o.diff.mergeGapPx, 3)
  assert.equal(o.diff.method, 'yiq')
  assert.equal(o.workingWidth, 0)
})

test('undefined values inside a section do not override defaults', () => {
  const o = resolveCompareOptions({ features: { nFeatures: undefined, ratio: 0.6 } })
  assert.equal(o.features.nFeatures, 2000)
  assert.equal(o.features.ratio, 0.6)
})

test('resolved options do not alias the defaults', () => {
  const o = resolveCompareOptions({ ignoreRegions: [{ x: 1, y: 1, w: 2, h: 2 }] })
  o.thresholds.failOn.push('added')
  o.features.nFeatures = 1
  assert.equal(resolveCompareOptions().thresholds.failOn.length, 4)
  assert.equal(DEFAULT_COMPARE_OPTIONS.features.nFeatures, 2000)
  assert.equal(o.ignoreRegions.length, 1)
})

test('invalid values are rejected with the option path', () => {
  const bad = (fn: () => unknown, re: RegExp) =>
    assert.throws(fn, (e: unknown) => isElastishotError(e, 'E_OPTIONS') && re.test((e as Error).message))
  bad(() => resolveCompareOptions({ thresholds: { similarity: 1.5 } }), /thresholds\.similarity/)
  bad(() => resolveCompareOptions({ alignMode: 'sideways' as never }), /alignMode/)
  bad(() => resolveCompareOptions({ thresholds: { failOn: ['blurred' as never] } }), /failOn\[0\]/)
  bad(() => resolveCompareOptions({ workingWidth: 12.5 }), /workingWidth/)
  bad(() => resolveCompareOptions({ ignoreRegions: [{ x: 0, y: 0, w: 0, h: 5 }] }), /ignoreRegions\[0\]/)
  bad(() => resolveCompareOptions({ diff: { maxRegions: 0 } }), /diff\.maxRegions/)
})
