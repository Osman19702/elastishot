/**
 * Group C — Naming what changed.
 * Scenarios: acceptance/features/C-locators.feature. Run: npm run test:acceptance
 */

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import { elastishot, image, workspace } from './support/cli.js'
import { startSite } from './support/site.js'

let ws
let site
let pair
let locators
before(async () => {
  ws = await workspace()
  site = await startSite()
  const r = await elastishot(['compare', site.v1, site.v2, '--full-page', '--json'], { cwd: ws.dir })
  assert.equal(r.code, 1, r.stderr)
  pair = JSON.parse(r.stdout).pairs[0]
  locators = new Map(pair.locators.changedLocators.map((l) => [l.locator, l]))
})
after(async () => {
  await site.close()
  await ws.remove()
})

const listing = () => [...locators.values()].map((l) => `${l.locator} ${l.kinds.join('/')} ${l.evidence.join('+')}`).join('\n')

test('C1 — A collapsed section is attributed to the section', () => {
  const faq = [...locators.values()].find((l) => l.locator.startsWith('#faq') && l.kinds.includes('removed'))
  assert.ok(faq, listing())
  assert.ok(faq.evidence.includes('pixels'), listing())
  assert.ok(faq.regions.length >= 1)
})

test('C2 — A renamed button keeps its locator and shows both names', () => {
  const cta = locators.get('[data-testid="cta"]')
  assert.ok(cta, listing())
  assert.ok(cta.kinds.includes('changed'), listing())
  assert.equal(cta.sideBaseline.name, 'Get started')
  assert.equal(cta.sideCandidate.name, 'Start free trial')
  assert.equal(cta.presence, 'both')
})

test('C3 — A new element is reported as added and candidate-only', () => {
  const badge = locators.get('[data-testid="badge"]')
  assert.ok(badge, listing())
  assert.ok(badge.kinds.includes('added'), listing())
  assert.equal(badge.presence, 'candidate-only')
})

test('C4 — Plain images still produce a report, without names', async () => {
  const r = await elastishot(['compare', image('base.png'), image('recolored.png'), '--json'], { cwd: ws.dir })
  assert.equal(r.code, 1, r.stderr)
  const p = JSON.parse(r.stdout).pairs[0]
  assert.equal(p.locators.coverage, 'none')
  assert.match(p.locators.warnings[0], /no element maps/)
  assert.ok(p.regions.length >= 1)
  assert.ok(p.regions[0].boxBaseline.w > 0)
})
