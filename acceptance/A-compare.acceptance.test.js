/**
 * Group A — Comparing two images or two pages.
 * Scenarios: acceptance/features/A-compare.feature. Run: npm run test:acceptance
 */

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import { elastishot, image, workspace } from './support/cli.js'
import { startSite } from './support/site.js'

let ws
let site
before(async () => {
  ws = await workspace()
  site = await startSite()
})
after(async () => {
  await site.close()
  await ws.remove()
})

const run = (args) => elastishot([...args, '--json'], { cwd: ws.dir })
const report = (r) => JSON.parse(r.stdout)

test('A1 — Two identical images pass', async () => {
  const r = await run(['compare', image('base.png'), image('base.png')])
  assert.equal(r.code, 0, r.stderr)
  const pair = report(r).pairs[0]
  assert.equal(pair.status, 'passed')
  assert.equal(pair.regions.length, 0)
})

test('A2 — A collapsed section is reported as removed', async () => {
  const r = await run(['compare', image('base.png'), image('collapsed.png')])
  assert.equal(r.code, 1, r.stderr)
  const pair = report(r).pairs[0]
  const removed = pair.regions.filter((x) => x.kind === 'removed' && x.score >= 0.5)
  assert.ok(removed.length >= 1, JSON.stringify(pair.regions))
  assert.ok(Math.max(...removed.map((x) => x.boxBaseline.h)) >= 100, JSON.stringify(removed))
  assert.equal(pair.regions.filter((x) => x.kind === 'changed' && x.score >= 0.1).length, 0, JSON.stringify(pair.regions))
})

test('A3 — Images of different sizes are aligned before comparing', async () => {
  const r = await run(['compare', image('base.png'), image('padded.png')])
  assert.notEqual(r.code, 2, r.stderr)
  const pair = report(r).pairs[0]
  assert.ok(Math.abs(pair.alignment.scale - 2.5) < 0.1, `scale ${pair.alignment.scale}`)
  const visible = 320 / 0.4
  const spurious = pair.regions.filter((x) => x.kind === 'changed' && x.score >= 0.2 && x.boxBaseline.y + x.boxBaseline.h <= visible - 8)
  assert.equal(spurious.length, 0, JSON.stringify(pair.regions))
})

test('A4 — Two versions of a page are captured and compared by URL', async () => {
  const r = await run(['compare', site.v1, site.v2, '--full-page'])
  assert.equal(r.code, 1, r.stderr)
  const pair = report(r).pairs[0]
  assert.equal(pair.status, 'failed')
  const locators = pair.locators.changedLocators.map((l) => l.locator)
  assert.ok(locators.some((l) => l.startsWith('#faq')), locators.join(', '))
  assert.ok(locators.includes('role=img[name="Illustration"]'), locators.join(', '))
  assert.ok(locators.includes('[data-testid="cta"]'), locators.join(', '))
  assert.ok(locators.includes('[data-testid="badge"]'), locators.join(', '))
})
