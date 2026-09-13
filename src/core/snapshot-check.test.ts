import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkSnapshot } from './snapshot-check.ts'
import type { ElementMap, SnapshotMeta } from './types.ts'

const meta = (extra: Partial<SnapshotMeta> = {}): SnapshotMeta => ({
  schema: 'elastishot.snapshot/1',
  capturedAt: '2026-09-13T00:00:00.000Z',
  dpr: 1,
  fullPage: true,
  elastishotVersion: '0.1.0',
  ...extra,
})
const map = (count: number): ElementMap => ({
  schema: 'elastishot.element-map/1',
  capturedAt: '2026-09-13T00:00:00.000Z',
  viewport: { width: 1280, height: 800 },
  dpr: 1,
  fullPage: true,
  image: { width: 1280, height: 800 },
  truncated: false,
  elements: Array.from({ length: count }, (_, i) => ({ i, locator: `#e${i}`, strategy: 'id' as const, tag: 'div', name: `e${i}`, box: { x: 0, y: i * 10, w: 10, h: 10 }, parent: null, fixed: false })),
})

test('a healthy capture raises no warning', () => {
  assert.deepEqual(checkSnapshot('baseline', { meta: meta({ httpStatus: 200, title: 'Acme - Home' }), elementMap: map(40) }), [])
})

test('files without meta are taken as they are', () => {
  assert.deepEqual(checkSnapshot('candidate', { meta: null, elementMap: map(1) }), [])
})

test('an HTTP error status, an error-looking title and a near-empty page are each reported', () => {
  const w = checkSnapshot('candidate', { meta: meta({ httpStatus: 404, title: '404 Not Found' }), elementMap: map(2) })
  assert.equal(w.length, 3)
  assert.ok(w.every((x) => x.code === 'CAPTURE_ERROR_PAGE' && x.message.startsWith('candidate: ')))
  assert.match(w[0]!.message, /HTTP 404/)
  assert.match(w[1]!.message, /looks like an error page/)
  assert.match(w[2]!.message, /only 2 elements/)
})

test('archive and browser placeholder titles count as error pages', () => {
  for (const title of ['This page couldn’t load', 'Internet Archive: Temporarily Offline', 'Redirecting...']) {
    assert.equal(checkSnapshot('baseline', { meta: meta({ title }) }).length, 1, title)
  }
})
