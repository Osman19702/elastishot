/**
 * The first real-screenshot pair: both versions of the fixture site are
 * captured with Playwright, compared by the engine and named by the locator
 * mapper. v2 collapses the FAQ, zooms the hero illustration, renames the call
 * to action and adds a footer badge.
 */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import { createCaptureAdapter } from '../../src/capture/index.ts'
import type { Box, Snapshot } from '../../src/core/types.ts'
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

test('v1 vs v2: the collapsed FAQ is the only block of rows either side lost, and the map invents nothing', async () => {
  // v2 is the same page with the FAQ collapsed: it lost rows in one column and
  // gained none anywhere. The hero is zoomed in place, and an alignment free to
  // describe that as a block that slid down and back again reports a full-width
  // stripe of added rows under the hero (named `#hero`), widens the FAQ's
  // removal from its own column across the whole page, and stops modelling the
  // footer's own three-row growth, which then surfaces as a change on the
  // "Back to top" link - a link that is byte-identical in both pages. None of
  // the three is real, and each has been reported by a released build.
  // Measured: sim 0.9331 forward and 0.9274 back, removal 54,1043 466x166.
  const edited = ['#faq', '#footer', '[data-testid="cta"]', '[data-testid="badge"]', 'role=img[name="Illustration"]']
  for (const { name, a, b, added, removed } of [
    { name: 'v1 vs v2', a: v1, b: v2, added: 0, removed: 1 },
    { name: 'v2 vs v1', a: v2, b: v1, added: 1, removed: 0 },
  ]) {
    const r = await engine.compare(a.image, b.image)
    const shape = () => `${name} sim=${r.summary.similarity.toFixed(3)} ${JSON.stringify(r.summary.counts)} ${r.regions.map((x) => `${x.kind}@${JSON.stringify(x.boxBaseline ?? x.boxCandidate)}`).join(' ')}`
    assert.equal(r.summary.counts.added, added, shape())
    assert.equal(r.summary.counts.removed, removed, shape())
    assert.ok(r.summary.similarity > 0.92, shape())
    // one block of rows, and it is the FAQ's own column: across the page it is the map giving up
    const gaps = r.regions.filter((x) => x.kind === 'added' || x.kind === 'removed')
    assert.equal(gaps.length, 1, shape())
    const box = gaps[0]!.boxBaseline ?? gaps[0]!.boxCandidate!
    assert.ok(box.w < a.image.width / 2, shape())
    // and every region with pixels behind it belongs to something v2 actually edits
    const locators = mapLocators(r.regions, { baseline: a.elementMap, candidate: b.elementMap }, { transform: r.alignment.transform })
    const pixels = locators.changedLocators.filter((l) => l.evidence.includes('pixels')).map((l) => l.locator)
    const stray = pixels.filter((l) => !edited.some((e) => l === e || l.startsWith(`${e} `)))
    assert.deepEqual(stray, [], `${shape()}\n${pixels.join('\n')}`)
  }
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
  // and the removal is one region inside the FAQ, not the FAQ plus a sliver somewhere else. A lane cut
  // that takes the end of the FAQ's one long line for a column of its own splits the removal in two and
  // leaves the second piece across the page; the score above then misses the bar by a few thousandths,
  // which is not a margin to rest a defect on. The count and the box are what say it.
  const box = v1.elementMap!.elements.find((e) => e.locator === '#faq')!.box
  const PAD = 12 // a region takes in the card's border and rounding around the ink it found
  const inside = (b: Box | null) => b !== null && b.x >= box.x - PAD && b.y >= box.y - PAD && b.x + b.w <= box.x + box.w + PAD && b.y + b.h <= box.y + box.h + PAD
  const removed = r.regions.filter((x) => x.kind === 'removed')
  assert.equal(removed.length, 1, listing())
  assert.deepEqual(removed.filter((x) => !inside(x.boxBaseline)).map((x) => [x.id, x.boxBaseline]), [], `#faq is ${JSON.stringify(box)}\n${listing()}`)

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
