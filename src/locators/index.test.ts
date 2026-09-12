import assert from 'node:assert/strict'
import { test } from 'node:test'

import { makeTransform, translation } from '../core/geometry.ts'
import type { Box, DiffRegion, ElementMap, ElementMapEntry, RegionKind } from '../core/types.ts'
import { mapLocators } from './index.ts'

function el(i: number, locator: string, box: Box, extra: Partial<ElementMapEntry> = {}): ElementMapEntry {
  const strategy = locator.startsWith('[data-testid') ? 'testid' : locator.startsWith('#') ? 'id' : locator.startsWith('role=') ? 'role' : 'css'
  return { i, locator, strategy, tag: 'div', name: locator, box, parent: null, fixed: false, ...extra }
}

function map(elements: ElementMapEntry[], extra: Partial<ElementMap> = {}): ElementMap {
  return {
    schema: 'elastishot.element-map/1',
    capturedAt: '2026-09-11T00:00:00.000Z',
    viewport: { width: 1280, height: 800 },
    dpr: 1,
    fullPage: true,
    image: { width: 1280, height: 2000 },
    truncated: false,
    elements,
    ...extra,
  }
}

function region(id: string, kind: RegionKind, boxBaseline: Box | null, boxCandidate: Box | null, score = 0.5): DiffRegion {
  return { id, kind, boxBaseline, boxCandidate, score, pixelsChanged: 100, areaFraction: 0.5, meanDelta: 0.5, confidence: 0.9, tags: [] }
}

const baseline = map([
  el(0, '#main', { x: 0, y: 0, w: 1280, h: 2000 }),
  el(1, '[data-testid="cta"]', { x: 96, y: 412, w: 160, h: 44 }, { name: 'Get started', tag: 'button' }),
  el(2, '#faq', { x: 0, y: 900, w: 1280, h: 320 }, { name: 'FAQ', tag: 'section' }),
  el(3, '#faq > h2:nth-of-type(1)', { x: 24, y: 916, w: 300, h: 32 }, { name: 'Questions', tag: 'h2' }),
])
const candidate = map([
  el(0, '#main', { x: 0, y: 0, w: 1280, h: 1700 }),
  el(1, '[data-testid="cta"]', { x: 96, y: 412, w: 160, h: 44 }, { name: 'Start free trial', tag: 'button' }),
  el(2, '[data-testid="badge"]', { x: 1000, y: 20, w: 60, h: 20 }, { name: 'New', tag: 'span' }),
])

test('regions are attributed to the smallest covering element on each side', () => {
  const regions = [
    region('r1', 'removed', { x: 0, y: 900, w: 1280, h: 320 }, null, 0.9),
    region('r2', 'changed', { x: 100, y: 420, w: 150, h: 30 }, { x: 100, y: 420, w: 150, h: 30 }, 0.6),
    region('r3', 'added', null, { x: 1000, y: 20, w: 60, h: 20 }, 0.4),
    region('r4', 'changed', { x: 500, y: 500, w: 10, h: 10 }, { x: 500, y: 500, w: 10, h: 10 }, 0.2),
  ]
  const report = mapLocators(regions, { baseline, candidate })
  assert.equal(report.coverage, 'both')
  assert.deepEqual(report.warnings, [])
  assert.equal(report.byRegion.length, 4)
  assert.equal(report.byRegion[0]!.baseline?.locator, '#faq')
  assert.equal(report.byRegion[0]!.candidate, null)
  assert.equal(report.byRegion[1]!.baseline?.locator, '[data-testid="cta"]')
  assert.equal(report.byRegion[1]!.candidate?.locator, '[data-testid="cta"]')
  assert.equal(report.byRegion[2]!.candidate?.locator, '[data-testid="badge"]')
  // r4 sits inside #main only, which covers it but is huge; #main still owns it (smallest covering element)
  assert.equal(report.byRegion[3]!.baseline?.locator, '#main')
  assert.deepEqual(report.unmapped, [])

  const byLocator = Object.fromEntries(report.changedLocators.map((c) => [c.locator, c]))
  const faq = byLocator['#faq']!
  assert.deepEqual(faq.kinds, ['removed'])
  assert.equal(faq.presence, 'baseline-only')
  assert.deepEqual(faq.evidence, ['pixels', 'map'])
  assert.deepEqual(faq.regions, ['r1'])
  const cta = byLocator['[data-testid="cta"]']!
  assert.deepEqual(cta.kinds, ['changed'])
  assert.equal(cta.presence, 'both')
  assert.equal(cta.sideBaseline?.name, 'Get started')
  assert.equal(cta.sideCandidate?.name, 'Start free trial')
  const badge = byLocator['[data-testid="badge"]']!
  assert.deepEqual(badge.kinds, ['added'])
  assert.equal(badge.presence, 'candidate-only')
  assert.deepEqual(badge.evidence, ['pixels', 'map'])
  // the h2 inside the removed FAQ exists only in the baseline map: reported with map evidence only
  const h2 = byLocator['#faq > h2:nth-of-type(1)']!
  assert.deepEqual(h2.evidence, ['map'])
  assert.deepEqual(h2.kinds, ['removed'])
  // pixel-evidenced entries come first, highest score first
  assert.deepEqual(report.changedLocators.slice(0, 2).map((c) => c.locator), ['#faq', '[data-testid="cta"]'])
})

test('falls back to the best overlap and reports unmapped regions', () => {
  const regions = [
    region('r1', 'changed', { x: 80, y: 400, w: 200, h: 70 }, { x: 80, y: 400, w: 200, h: 70 }), // covers the button, not covered by it
    region('r2', 'changed', { x: 1200, y: 1900, w: 60, h: 60 }, { x: 1200, y: 1900, w: 60, h: 60 }),
  ]
  const only = map([el(0, '[data-testid="cta"]', { x: 96, y: 412, w: 160, h: 44 })])
  const report = mapLocators(regions, { baseline: only, candidate: only }, { iouMin: 0.3 })
  assert.equal(report.byRegion[0]!.baseline?.locator, '[data-testid="cta"]')
  assert.ok(report.byRegion[0]!.baseline!.iou > 0.3)
  assert.equal(report.byRegion[1]!.baseline, null)
  assert.deepEqual(report.unmapped, ['r2'])
})

test('works with one map, and degrades gracefully with none', () => {
  const regions = [region('r1', 'changed', { x: 100, y: 420, w: 150, h: 30 }, { x: 100, y: 420, w: 150, h: 30 })]
  const one = mapLocators(regions, { baseline })
  assert.equal(one.coverage, 'baseline')
  assert.equal(one.changedLocators[0]!.locator, '[data-testid="cta"]')
  assert.equal(one.changedLocators[0]!.presence, 'unknown')
  assert.equal(one.byRegion[0]!.candidate, null)
  const none = mapLocators(regions, {})
  assert.equal(none.coverage, 'none')
  assert.deepEqual(none.changedLocators, [])
  assert.deepEqual(none.unmapped, [])
  assert.equal(none.warnings.length, 1)
  assert.equal(none.byRegion.length, 1)
})

test('map-only moves are reported when enabled, measured through the transform', () => {
  const moved = map([el(0, '[data-testid="cta"]', { x: 96, y: 512, w: 160, h: 44 })])
  const still = map([el(0, '[data-testid="cta"]', { x: 96, y: 412, w: 160, h: 44 })])
  const off = mapLocators([], { baseline: still, candidate: moved })
  assert.deepEqual(off.changedLocators, [])
  const on = mapLocators([], { baseline: still, candidate: moved }, { mapMoves: true })
  assert.equal(on.changedLocators.length, 1)
  assert.deepEqual(on.changedLocators[0]!.kinds, ['moved'])
  assert.deepEqual(on.changedLocators[0]!.evidence, ['map'])
  // the candidate is shifted down by 100 px as a whole: after the transform nothing moved
  const explained = mapLocators([], { baseline: still, candidate: moved }, { mapMoves: true, transform: makeTransform(translation(0, -100)) })
  assert.deepEqual(explained.changedLocators, [])
})

test('every region appears exactly once in byRegion', () => {
  const regions = Array.from({ length: 20 }, (_, i) => region(`r${i}`, (['added', 'removed', 'changed', 'moved'] as RegionKind[])[i % 4]!, i % 4 === 0 ? null : { x: i * 50, y: i * 90, w: 40, h: 40 }, i % 4 === 1 ? null : { x: i * 50, y: i * 90, w: 40, h: 40 }))
  const report = mapLocators(regions, { baseline, candidate })
  assert.deepEqual(report.byRegion.map((b) => b.regionId), regions.map((r) => r.id))
  for (const id of report.unmapped) assert.ok(regions.some((r) => r.id === id))
})
