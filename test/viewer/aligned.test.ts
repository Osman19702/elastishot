/**
 * The viewer with an inserted section: both sides are drawn in one row space,
 * the stage grows by the inserted rows, the added region is a full box and
 * the diff tint covers the gap.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { loadPlaywright } from '../../src/capture/index.ts'
import { createImage, fillRect } from '../../src/core/image.ts'
import { writeImageFile } from '../../src/node/io.ts'
import { createPage, insertRows } from '../fixtures/synth.ts'
import { engine } from '../support/cv.ts'
import { startStaticServer } from '../support/static-server.js'

const BLOCK = 160
let dir = ''
let server: { url: string; close: () => Promise<void> }
let browser: import('playwright').Browser
let page: import('playwright').Page
let baselineHeight = 0
let insertedRows = 0
let addedBox: { y: number; h: number; anchorY: number } | null = null
const errors: string[] = []

before(async () => {
  execFileSync(process.execPath, ['scripts/build-viewer.mjs'], { stdio: 'pipe' })
  dir = await mkdtemp(path.join(os.tmpdir(), 'elastishot-viewer-aligned-'))
  await copyFile('dist/viewer/elastishot-viewer.js', path.join(dir, 'elastishot-viewer.js'))
  const p = createPage({ seed: 21, sections: 3 })
  const base = p.image
  const block = createImage(base.width, BLOCK, [255, 255, 255, 255])
  fillRect(block, { x: 24, y: 12, w: base.width - 48, h: 136 }, [254, 226, 226, 255])
  fillRect(block, { x: 60, y: 40, w: 300, h: 24 }, [153, 27, 27, 255])
  for (let i = 0; i < 5; i++) fillRect(block, { x: 60 + i * 130, y: 90, w: 90, h: 40 }, [220, 38, 38, 255])
  const s0 = p.manifest.sections[0]!
  const candidate = insertRows(base, s0.box.y + s0.box.h + 12, block)
  await engine.warmup()
  const r = await engine.compare(base, candidate, { artifacts: { warpedCandidate: true } })
  baselineHeight = base.height
  insertedRows = r.summary.structural.insertedRows
  assert.ok(insertedRows >= BLOCK * 0.8, JSON.stringify(r.summary.structural))
  const added = r.regions.filter((x) => x.kind === 'added').sort((a, b) => b.score - a.score)[0]
  assert.ok(added?.boxCandidate && added.anchorBaseline, JSON.stringify(r.regions))
  addedBox = { y: added.boxCandidate.y, h: added.boxCandidate.h, anchorY: added.anchorBaseline.y }
  await writeImageFile(path.join(dir, 'baseline.png'), base)
  await writeImageFile(path.join(dir, 'candidate.png'), candidate)
  await writeImageFile(path.join(dir, 'diff.png'), r.artifacts.diffMask!)
  await writeImageFile(path.join(dir, 'warped.png'), r.artifacts.warpedCandidate!)
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>aligned host</title>
<style>body { margin: 0; padding: 20px; } elastishot-viewer { width: 800px; }</style>
<script type="module" src="elastishot-viewer.js"></script></head>
<body>
<elastishot-viewer id="v" baseline-src="baseline.png" candidate-src="candidate.png" diff-src="diff.png" warped-src="warped.png" mode="slider" show-regions>
<script type="application/json">${JSON.stringify({ regions: r.regions, locators: null, alignment: r.alignment }).replace(/<\//g, '<\\/')}</script>
</elastishot-viewer>
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

const inShadow = (sel: string) => page.locator('#v').locator(sel)

test('the stage is as tall as the baseline plus the inserted rows and both sides are drawn on canvases', async () => {
  const stageH = await inShadow('.stage').evaluate((el) => parseInt((el as HTMLElement).style.height, 10))
  assert.equal(stageH, baselineHeight + insertedRows)
  assert.equal(await inShadow('.layer.baseline canvas.aligned').isHidden(), false)
  assert.equal(await inShadow('.layer.candidate canvas.aligned').isHidden(), false)
  assert.equal(await inShadow('.layer.baseline img').isHidden(), true)
  const sizes = await inShadow('canvas.aligned').evaluateAll((els) => els.map((c) => (c as HTMLCanvasElement).height))
  assert.deepEqual(sizes, [stageH, stageH])
})

test('the added region is a full box over the inserted rows, not a line', async () => {
  const box = await inShadow('.region.k-added').first().evaluate((el) => ({ y: parseInt((el as HTMLElement).style.top, 10), h: parseInt((el as HTMLElement).style.height, 10) }))
  assert.ok(box.h >= BLOCK * 0.8, JSON.stringify({ box, addedBox }))
  // rows above the insertion keep their baseline coordinates, so the box starts at the anchor row
  assert.ok(Math.abs(box.y - addedBox!.anchorY) <= 8, JSON.stringify({ box, addedBox }))
})

test('the diff tint spans the aligned height and marks the gap as changed', async () => {
  await page.locator('#v').evaluate((el) => el.setAttribute('mode', 'diff'))
  const tint = await inShadow('.diff-tint').evaluate((el) => {
    const c = el as HTMLCanvasElement
    const ctx = c.getContext('2d')!
    const mid = ctx.getImageData(Math.floor(c.width / 2), 0, 1, c.height).data
    const changed = (y: number) => mid[y * 4 + 1]! < 200 // white rows stay white; changed rows take the tint
    return { height: c.height, gapChanged: changed(0) ? 'top-changed' : 'top-clean', gapRow: changed(0) }
  })
  assert.equal(tint.height, baselineHeight + insertedRows)
  const inGap = await inShadow('.diff-tint').evaluate((el, y) => {
    const c = el as HTMLCanvasElement
    const d = c.getContext('2d')!.getImageData(Math.floor(c.width / 2), y, 1, 1).data
    return d[1]! < 200
  }, addedBox!.anchorY + Math.floor(addedBox!.h / 2))
  assert.equal(inGap, true)
  assert.equal(tint.gapRow, false)
})

test('no errors were logged', () => {
  assert.deepEqual(errors, [])
})
