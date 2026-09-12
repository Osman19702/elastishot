/**
 * Group F — Looking at a difference.
 * Scenarios: acceptance/features/F-viewer.feature. Run: npm run test:acceptance
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { openBrowser } from './support/browser.js'
import { elastishot, image, workspace } from './support/cli.js'

let ws
let browser
let page
let errors
before(async () => {
  ws = await workspace()
  const runDir = path.join(ws.dir, 'run')
  const r = await elastishot(['compare', image('base.png'), image('recolored.png'), '--out', runDir, '--name', 'home'], { cwd: ws.dir })
  assert.equal(r.code, 1, r.stderr)
  browser = await openBrowser()
  ;({ page, errors } = await browser.page())
  await browser.openFile(page, path.join(runDir, 'pairs', 'home', 'report.html'))
  await page.waitForSelector('elastishot-viewer[ready]', { timeout: 15_000 })
})
after(async () => {
  await browser?.close()
  await ws.remove()
})

const viewer = () => page.locator('elastishot-viewer')

test('F1 — The slider handle is keyboard operable', async () => {
  const handle = viewer().locator('.handle.v')
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  assert.equal(await handle.getAttribute('aria-valuenow'), '52')
  const clip = await viewer().locator('.layer.candidate').evaluate((el) => el.style.clipPath)
  assert.equal(clip, 'inset(0px 0px 0px 52%)')
})

test('F2 — Modes switch from the page toolbar', async () => {
  for (const [label, mode] of [['Diff', 'diff'], ['Overlay', 'overlay'], ['Flip', 'flip'], ['Blink', 'blink']]) {
    await page.locator('.toolbar button', { hasText: label }).first().click()
    assert.equal(await viewer().getAttribute('mode'), mode)
  }
  assert.deepEqual(errors, [])
})

test('F3 — Clicking a region shows what it is', async () => {
  await page.locator('.toolbar button', { hasText: 'Slider' }).first().click()
  await viewer().locator('.region').first().click()
  const chip = await viewer().locator('.chip').textContent()
  assert.match(chip, /changed r1.*score/)
  assert.equal(await page.locator('tr.selected').count(), 1)
  assert.equal(await page.locator('tr.selected').getAttribute('data-region-id'), 'r1')
})
