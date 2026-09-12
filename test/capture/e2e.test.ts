/**
 * The first real-screenshot pair: both versions of the fixture site are
 * captured with Playwright, compared by the engine and named by the locator
 * mapper. v2 collapses the FAQ, zooms the hero illustration, renames the call
 * to action and adds a footer badge.
 */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import { createCaptureAdapter } from '../../src/capture/index.ts'
import type { Snapshot } from '../../src/core/types.ts'
import { mapLocators } from '../../src/locators/index.ts'
import { engine } from '../support/cv.ts'
import { startStaticServer } from '../support/static-server.js'

let server: { url: string; close: () => Promise<void> }
let v1: Snapshot
let v2: Snapshot
const adapter = createCaptureAdapter({ fullPage: true })

before(async () => {
  server = await startStaticServer('test/fixtures/site')
  await engine.warmup()
  ;[v1, v2] = await Promise.all([adapter.capture(`${server.url}/v1/`), adapter.capture(`${server.url}/v2/`)])
})
after(async () => {
  await adapter.close()
  await server.close()
})

test('the same page captured twice compares as identical', async () => {
  const again = await adapter.capture(`${server.url}/v1/`)
  const r = await engine.compare(v1.image, again.image)
  assert.equal(r.summary.passed, true, JSON.stringify(r.summary))
  assert.equal(r.regions.length, 0)
})

test('v1 vs v2: collapsed FAQ, zoomed hero, renamed button and new badge are all found and named', async () => {
  assert.ok(v2.image.height < v1.image.height, 'v2 should be shorter (FAQ collapsed)')
  const r = await engine.compare(v1.image, v2.image)
  const describe = () =>
    `${r.summary.alignMethod} sim=${r.summary.similarity.toFixed(3)} ${r.regions.map((x) => `${x.id}:${x.kind}@${JSON.stringify(x.boxBaseline ?? x.anchorBaseline)}(${x.score.toFixed(2)})`).join(' ')}`
  assert.equal(r.summary.passed, false, describe())
  assert.ok(r.summary.structural.deletedRows > 100, describe())

  const locators = mapLocators(r.regions, { baseline: v1.elementMap, candidate: v2.elementMap }, { transform: r.alignment.transform })
  const by = new Map(locators.changedLocators.map((l) => [l.locator, l]))
  const listing = () => `${describe()}\n${locators.changedLocators.map((l) => `${l.locator} ${l.kinds.join('/')} ${l.evidence.join('+')} ${l.score.toFixed(2)}`).join('\n')}`

  // the collapsed content is attributed to the smallest element covering it: the FAQ box or its list
  const faq = locators.changedLocators.find((l) => l.locator.startsWith('#faq') && l.kinds.includes('removed') && l.evidence.includes('pixels'))
  assert.ok(faq, listing())
  assert.ok(faq!.score >= 0.9, listing())

  const cta = by.get('[data-testid="cta"]')
  assert.ok(cta, listing())
  assert.ok(cta!.kinds.includes('changed'), listing())
  assert.equal(cta!.sideBaseline?.name, 'Get started')
  assert.equal(cta!.sideCandidate?.name, 'Start free trial')

  const hero = by.get('role=img[name="Illustration"]')
  assert.ok(hero, listing())
  assert.ok(hero!.evidence.includes('pixels'), listing())

  const badge = by.get('[data-testid="badge"]')
  assert.ok(badge, listing())
  assert.ok(badge!.kinds.includes('added'), listing())
  assert.equal(badge!.presence, 'candidate-only')

  // nothing changed inside the feature cards or pricing
  for (const stable of ['[data-testid="card-align"]', '[data-testid="card-locators"]', '[data-testid="card-reports"]', '#plan-free', '#plan-team']) {
    const l = by.get(stable)
    assert.ok(!l || !l.evidence.includes('pixels'), `${stable} should be unchanged\n${listing()}`)
  }
})
