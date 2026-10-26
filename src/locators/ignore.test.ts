import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ElementMap, ElementMapEntry } from '../core/types.ts'
import { normalizeLocator, resolveIgnore } from './ignore.ts'

const entry = (i: number, locator: string, x: number): ElementMapEntry => ({ i, locator, strategy: 'testid', tag: 'div', name: locator, box: { x, y: 10, w: 50, h: 20 }, parent: null, fixed: false })
const map = (...elements: ElementMapEntry[]): ElementMap => ({ schema: 'elastishot.element-map/1', capturedAt: '', viewport: { width: 100, height: 100 }, dpr: 1, fullPage: false, image: { width: 100, height: 100 }, truncated: false, elements })

test('attribute locators match with or without quotes', () => {
  assert.equal(normalizeLocator('[data-testid=clock]'), '[data-testid="clock"]')
  assert.equal(normalizeLocator(" [data-testid='clock'] "), '[data-testid="clock"]')
  assert.equal(normalizeLocator('#feed > [data-test=row]'), '#feed > [data-test="row"]')
  assert.equal(normalizeLocator('role=button[name="Save"]'), 'role=button[name="Save"]')
})

test('ignore resolves through each map into boxes on that side, nth instances included', () => {
  const baseline = map(entry(0, '[data-testid="clock"]', 0), entry(1, '[data-testid="row"] >> nth=0', 10), entry(2, '[data-testid="row"] >> nth=1', 20))
  const candidate = map(entry(0, '[data-testid="clock"]', 40))
  const r = resolveIgnore(['[data-testid=clock]', '[data-testid="row"]', '.ad-banner'], { baseline, candidate })
  assert.deepEqual(r.baseline.map((b) => b.x), [0, 10, 20])
  assert.deepEqual(r.candidate.map((b) => b.x), [40])
  assert.deepEqual(r.unresolved, ['.ad-banner'])
  assert.deepEqual(
    r.ignored.map((g) => `${g.side} ${g.locator}`),
    ['baseline [data-testid="clock"]', 'candidate [data-testid="clock"]', 'baseline [data-testid="row"] >> nth=0', 'baseline [data-testid="row"] >> nth=1'],
  )
})

test('without maps every locator is unresolved', () => {
  const r = resolveIgnore(['#clock'], { baseline: null, candidate: null })
  assert.deepEqual(r.unresolved, ['#clock'])
  assert.equal(r.ignored.length, 0)
})
