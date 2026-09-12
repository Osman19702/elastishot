import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import { capture, createCaptureAdapter, loadPlaywright } from '../../src/capture/index.ts'
import { isElastishotError } from '../../src/core/errors.ts'
import type { ElementMapEntry } from '../../src/core/types.ts'
import { startStaticServer } from '../support/static-server.js'

let server: { url: string; close: () => Promise<void> }
before(async () => {
  server = await startStaticServer('test/fixtures/site')
})
after(() => server.close())

const find = (elements: ElementMapEntry[], locator: string): ElementMapEntry => {
  const e = elements.find((x) => x.locator === locator)
  assert.ok(e, `no element with locator ${locator}; have: ${elements.map((x) => x.locator).slice(0, 40).join(' | ')}`)
  return e
}

test('captures a full page with an element map', async () => {
  const snap = await capture(`${server.url}/v1/`, { fullPage: true })
  assert.equal(snap.image.width, 1280)
  assert.ok(snap.image.height > 900, `height ${snap.image.height}`)
  assert.ok(snap.png && snap.png.length > 1000)
  assert.equal(snap.meta.fullPage, true)
  assert.equal(snap.meta.url, `${server.url}/v1/`)
  const map = snap.elementMap!
  assert.equal(map.image.width, snap.image.width)
  assert.equal(map.image.height, snap.image.height)
  assert.equal(map.truncated, false)

  const cta = find(map.elements, '[data-testid="cta"]')
  assert.equal(cta.strategy, 'testid')
  assert.equal(cta.name, 'Get started')
  assert.equal(cta.tag, 'button')
  assert.ok(cta.box.w > 100 && cta.box.h > 30)

  const faq = find(map.elements, '#faq')
  assert.equal(faq.strategy, 'id')
  assert.ok(faq.box.y > cta.box.y)

  const heading = find(map.elements, 'role=heading[name="Ship UI changes with confidence"]')
  assert.equal(heading.strategy, 'role')
  assert.equal(heading.tag, 'h1')

  // duplicated role+name falls back to a css path anchored at the nearest id/testid
  const questionTerms = map.elements.filter((e) => e.tag === 'dt')
  assert.equal(questionTerms.length, 3)
  assert.ok(questionTerms.every((e) => e.strategy === 'css' && e.locator.startsWith('#faq > ')), questionTerms.map((e) => e.locator).join(' | '))
  assert.equal(questionTerms[1]!.locator, '#faq > dl:nth-of-type(1) > dt:nth-of-type(2)')

  // parents point at included ancestors
  const card = find(map.elements, '[data-testid="card-align"]')
  const cardTitle = map.elements.find((e) => e.parent === card.i && e.tag === 'h3')
  assert.ok(cardTitle)
  assert.equal(cardTitle!.name, 'Aligns first')
})

test('boxes match Playwright bounding boxes scaled by the device pixel ratio', async () => {
  const pw = await loadPlaywright()
  const browser = await pw.chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
    const page = await context.newPage()
    await page.goto(`${server.url}/v1/`)
    const expected = (await page.locator('[data-testid="cta"]').boundingBox())!
    await context.close()

    const snap = await capture(`${server.url}/v1/`, { fullPage: true, deviceScaleFactor: 2, browser })
    assert.equal(snap.image.width, 2560)
    const cta = find(snap.elementMap!.elements, '[data-testid="cta"]')
    assert.ok(Math.abs(cta.box.x - expected.x * 2) <= 1, `x ${cta.box.x} vs ${expected.x * 2}`)
    assert.ok(Math.abs(cta.box.y - expected.y * 2) <= 1, `y ${cta.box.y} vs ${expected.y * 2}`)
    assert.ok(Math.abs(cta.box.w - expected.width * 2) <= 2, `w ${cta.box.w} vs ${expected.width * 2}`)
    assert.ok(Math.abs(cta.box.h - expected.height * 2) <= 2, `h ${cta.box.h} vs ${expected.height * 2}`)
  } finally {
    await browser.close()
  }
})

test('viewport captures clip to the viewport and hidden selectors leave the map', async () => {
  const adapter = createCaptureAdapter({ hide: ['#faq'] })
  try {
    const snap = await adapter.capture(`${server.url}/v1/`, { fullPage: false })
    assert.equal(snap.image.height, 800)
    const map = snap.elementMap!
    assert.ok(map.elements.every((e) => e.box.y + e.box.h <= 800), 'an element extends below the viewport')
    assert.ok(!map.elements.some((e) => e.locator === '#faq'))
    assert.ok(map.elements.some((e) => e.locator === '[data-testid="cta"]'))
    const full = await adapter.capture(`${server.url}/v2/`, { fullPage: true, elementMap: false })
    assert.equal(full.elementMap, null)
    const badgeless = await adapter.capture(`${server.url}/v2/`, { fullPage: true, elementMap: { text: false } })
    const badge = find(badgeless.elementMap!.elements, '[data-testid="badge"]')
    assert.equal(badge.text, undefined)
    assert.equal(badge.name, 'New')
  } finally {
    await adapter.close()
  }
})

test('unreachable pages fail with E_CAPTURE', async () => {
  await assert.rejects(capture(`${server.url}/missing/`, { waitFor: '#never', timeoutMs: 1500 }), (e: unknown) => isElastishotError(e, 'E_CAPTURE') || (e as Error).name === 'TimeoutError')
  await assert.rejects(capture('http://127.0.0.1:9/', { timeoutMs: 3000 }), (e: unknown) => isElastishotError(e, 'E_CAPTURE'))
})
