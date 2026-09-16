/**
 * The viewer with an inserted section: both sides are drawn in one row space,
 * the stage grows by the inserted rows, the added region is a full box and
 * the diff tint covers the gap.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, before, test } from 'node:test'

import { loadPlaywright } from '../../src/capture/index.ts'
import { createImage, fillRect } from '../../src/core/image.ts'
import { readImageFile, writeImageFile } from '../../src/node/io.ts'
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
  assert.ok(r.artifacts.gapFills, 'gapFills')
  await writeImageFile(path.join(dir, 'gaps.png'), r.artifacts.gapFills!)
  const data = JSON.stringify({ regions: r.regions, locators: null, alignment: r.alignment }).replace(/<\//g, '<\\/')
  const host = (script: string, gaps: boolean) => `<!doctype html><html><head><meta charset="utf-8"><title>aligned host</title>
<style>body { margin: 0; padding: 20px; } elastishot-viewer { width: 800px; }</style>
${script}</head>
<body>
<elastishot-viewer id="v" baseline-src="baseline.png" candidate-src="candidate.png" diff-src="diff.png" warped-src="warped.png"${gaps ? ' gaps-src="gaps.png"' : ''} mode="slider" show-regions>
<script type="application/json">${data}</script>
</elastishot-viewer>
</body></html>`
  await writeFile(path.join(dir, 'index.html'), host('<script type="module" src="elastishot-viewer.js"></script>', true))
  // the same page without a gaps image: the viewer reads the pixels itself
  await writeFile(path.join(dir, 'pixels.html'), host('<script type="module" src="elastishot-viewer.js"></script>', false))
  // and as a downloaded report is opened: from file://, with the bundle inlined (a module file would be refused there)
  const bundle = (await readFile(path.join(dir, 'elastishot-viewer.js'), 'utf8')).replace(/<\/script/g, '<\\/script')
  await writeFile(path.join(dir, 'file.html'), host(`<script type="module">${bundle}</script>`, true))
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

const gapPixels = async (p: import('playwright').Page) =>
  p.locator('#v').locator('.layer.baseline canvas.aligned').evaluate((el, box) => {
    const c = el as HTMLCanvasElement
    const ctx = c.getContext('2d')!
    const x = Math.floor(c.width / 2)
    const at = (y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data)
    return { above: at(box.anchorY - 3), inside: at(box.anchorY + Math.floor(box.h / 2)) }
  }, addedBox!)

// The fixture page is white around the insertion: the gap must be white under a light green
// tint, neither the viewer's own background nor a stretched copy of the section above.
const assertWhiteUnderTint = (gap: { above: number[]; inside: number[] }) => {
  assert.ok(gap.above[0]! > 240 && gap.above[3] === 255, JSON.stringify(gap))
  assert.ok(gap.inside[3] === 255 && gap.inside[0]! > 200 && gap.inside[0]! < 250 && gap.inside[1]! > 230, JSON.stringify(gap))
}

test('the gap continues the page background under its tint, from the gaps image', async () => {
  assertWhiteUnderTint(await gapPixels(page))
})

test('without a gaps image the viewer reads the pixels around the gap itself', async () => {
  const p = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  await p.goto(`${server.url}/pixels.html`)
  await p.waitForSelector('elastishot-viewer[ready]', { timeout: 15_000 })
  assertWhiteUnderTint(await gapPixels(p))
  await p.close()
})

test('a report opened from file:// draws the gaps image, where pixel reads are refused', async () => {
  const p = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  const fileErrors: string[] = []
  p.on('pageerror', (e) => fileErrors.push(e.message))
  await p.goto(pathToFileURL(path.join(dir, 'file.html')).href)
  await p.waitForSelector('elastishot-viewer[ready]', { timeout: 15_000 })
  // a canvas that drew a file:// image is tainted and cannot be read back, so read what the
  // page shows: scroll the gap into the scroll container and screenshot the container
  const gapRow = addedBox!.anchorY + Math.floor(addedBox!.h / 2)
  // the whole view shows the baseline, so the slider's handle is out of the way
  await p.locator('#v').evaluate((el) => el.setAttribute('position', '100'))
  const view = await p.locator('#v').locator('.viewport').evaluate((el, row) => {
    const canvas = el.querySelector('canvas.aligned') as HTMLCanvasElement
    const stage = el.querySelector('.stage-box') as HTMLElement
    const scale = stage.getBoundingClientRect().width / canvas.width
    el.scrollTop = Math.max(0, Math.round(row * scale) - 40)
    return { scale, scrollTop: el.scrollTop, width: canvas.width }
  }, gapRow)
  const shotPath = path.join(dir, 'file-shot.png')
  await p.locator('#v').locator('.viewport').screenshot({ path: shotPath })
  const png = await readImageFile(shotPath)
  const at = (y: number) => {
    const sy = Math.round(y * view.scale) - view.scrollTop
    const i = (sy * png.width + Math.round((view.width / 2) * view.scale)) * 4
    return Array.from(png.data.subarray(i, i + 4))
  }
  assertWhiteUnderTint({ above: at(addedBox!.anchorY - 3), inside: at(gapRow) })
  assert.deepEqual(fileErrors, [])
  await p.close()
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
