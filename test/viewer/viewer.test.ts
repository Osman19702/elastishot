/**
 * The viewer element in a real browser: bundle it, generate a pair with the
 * engine, serve a host page, and drive the modes with Playwright.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { loadPlaywright } from '../../src/capture/index.ts'
import { writeImageFile } from '../../src/node/io.ts'
import { createPage, recolor } from '../fixtures/synth.ts'
import { engine } from '../support/cv.ts'
import { startStaticServer } from '../support/static-server.js'

let dir = ''
let server: { url: string; close: () => Promise<void> }
let regionCount = 0
let browser: import('playwright').Browser
let page: import('playwright').Page
const errors: string[] = []

before(async () => {
  execFileSync(process.execPath, ['scripts/build-viewer.mjs'], { stdio: 'pipe' })
  dir = await mkdtemp(path.join(os.tmpdir(), 'elastishot-viewer-'))
  await copyFile('dist/viewer/elastishot-viewer.js', path.join(dir, 'elastishot-viewer.js'))
  const p = createPage({ seed: 21, sections: 3 })
  const title = p.manifest.sections[1]!.title
  const candidate = recolor(p.image, title, [220, 38, 38, 255])
  await engine.warmup()
  const r = await engine.compare(p.image, candidate, { artifacts: { warpedCandidate: true } })
  regionCount = r.regions.length
  assert.ok(regionCount >= 1)
  await writeImageFile(path.join(dir, 'baseline.png'), p.image)
  await writeImageFile(path.join(dir, 'candidate.png'), candidate)
  await writeImageFile(path.join(dir, 'diff.png'), r.artifacts.diffMask!)
  await writeImageFile(path.join(dir, 'warped.png'), r.artifacts.warpedCandidate!)
  const locators = {
    coverage: 'both',
    changedLocators: [],
    byRegion: r.regions.map((x) => ({ regionId: x.id, kind: x.kind, baseline: { locator: '#section-2-title', name: 'Section two', strategy: 'id', tag: 'h2', box: x.boxBaseline, coverage: 1, iou: 1 }, candidate: null, all: [] })),
    unmapped: [],
    warnings: [],
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>viewer host</title>
<style>body { margin: 0; padding: 20px; } elastishot-viewer { width: 600px; }</style>
<script type="module" src="elastishot-viewer.js"></script></head>
<body>
<elastishot-viewer id="v" baseline-src="baseline.png" candidate-src="candidate.png" diff-src="diff.png" warped-src="warped.png" mode="slider" show-regions>
<script type="application/json">${JSON.stringify({ regions: r.regions, locators, alignment: r.alignment }).replace(/<\//g, '<\\/')}</script>
</elastishot-viewer>
<script>
window.__events = []
document.getElementById('v').addEventListener('elastishot-region-select', (e) => window.__events.push(['select', e.detail.region && e.detail.region.id]))
document.getElementById('v').addEventListener('elastishot-mode-change', (e) => window.__events.push(['mode', e.detail.mode]))
</script>
</body></html>`
  await writeFile(path.join(dir, 'index.html'), html)
  server = await startStaticServer(dir)
  const pw = await loadPlaywright()
  browser = await pw.chromium.launch()
  page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(`${server.url}/index.html`)
  await page.waitForSelector('elastishot-viewer[ready]', { timeout: 15_000 })
})

after(async () => {
  await browser?.close()
  await server?.close()
  await rm(dir, { recursive: true, force: true })
})

const viewer = () => page.locator('#v')
const inShadow = (sel: string) => page.locator('#v').locator(sel)

test('the element upgrades, fits its host and draws one box per region', async () => {
  assert.equal(await page.evaluate(() => Boolean(customElements.get('elastishot-viewer'))), true)
  const stage = await inShadow('.viewport').boundingBox()
  assert.ok(stage && stage.width <= 600 && stage.width > 500, JSON.stringify(stage))
  assert.equal(await inShadow('.region').count(), regionCount)
  const label = await inShadow('.region').first().getAttribute('aria-label')
  assert.match(label ?? '', /changed region r1: Section two \(#section-2-title\)/)
})

test('the slider handle is keyboard operable and reports its value', async () => {
  const handle = inShadow('.handle.v')
  assert.equal(await handle.getAttribute('aria-valuenow'), '50')
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await handle.getAttribute('aria-valuenow'), '51')
  await page.keyboard.press('Shift+ArrowLeft')
  assert.equal(await handle.getAttribute('aria-valuenow'), '41')
  await page.keyboard.press('End')
  assert.equal(await handle.getAttribute('aria-valuenow'), '100')
  const clip = await inShadow('.layer.candidate').evaluate((el) => (el as HTMLElement).style.clipPath)
  assert.equal(clip, 'inset(0px 0px 0px 100%)')
  await page.keyboard.press('Home')
  assert.equal(await handle.getAttribute('aria-valuenow'), '0')
})

test('modes switch by toolbar, attribute and keyboard, and fire events', async () => {
  await inShadow('.toolbar button[data-mode="diff"]').click()
  assert.equal(await viewer().getAttribute('mode'), 'diff')
  assert.equal(await inShadow('.diff-tint').evaluate((el) => getComputedStyle(el).display), 'block')
  await viewer().evaluate((el) => el.setAttribute('mode', 'overlay'))
  assert.equal(await inShadow('.layer.candidate').evaluate((el) => (el as HTMLElement).style.opacity), '0.5')
  await inShadow('.viewport').focus()
  await page.keyboard.press('2')
  assert.equal(await viewer().getAttribute('mode'), 'flip')
  assert.equal(await inShadow('.layer.candidate').evaluate((el) => (el as HTMLElement).style.transform), 'scaleY(-1)')
  await page.keyboard.press('f')
  assert.equal(await viewer().getAttribute('flip-side'), 'baseline')
  await page.keyboard.press('3')
  assert.equal(await inShadow('label.blink').isHidden(), false)
  await page.keyboard.press('1')
  const events = (await page.evaluate(() => (window as unknown as { __events: unknown[] }).__events)) as Array<[string, string]>
  assert.deepEqual(
    events.filter((e) => e[0] === 'mode').map((e) => e[1]),
    ['diff', 'overlay', 'flip', 'blink', 'slider'],
  )
})

test('clicking a region selects it, shows the chip and dispatches the event', async () => {
  await inShadow('.region').first().click()
  assert.equal(await inShadow('.region.selected').count(), 1)
  const chip = await inShadow('.chip').textContent()
  assert.match(chip ?? '', /changed r1 Section two #section-2-title score/)
  const selected = await viewer().evaluate((el) => (el as unknown as { selectedRegion: string }).selectedRegion)
  assert.equal(selected, 'r1')
  await page.keyboard.press('Escape')
  const events = (await page.evaluate(() => (window as unknown as { __events: unknown[] }).__events)) as Array<[string, string | null]>
  assert.deepEqual(events.filter((e) => e[0] === 'select').map((e) => e[1]), ['r1', null])
})

test('no errors were logged', () => {
  assert.deepEqual(errors, [])
})
