/**
 * Record the walkthrough: the seven builds scrolling past, then the
 * Elastishot summary and three pair reports with the viewer in every mode.
 * Playwright writes a WebM; screenshots of each build and of the summary
 * page are taken on the way. Returns the file names relative to `outDir`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium } from 'playwright'

import { BUILDS } from './site.mjs'

const CAPTION_CSS = `position:fixed;left:24px;bottom:24px;z-index:99999;background:rgba(22,32,43,.92);color:#fff;font:600 18px/1.3 "Segoe UI",Arial,sans-serif;padding:12px 18px;border-radius:10px;max-width:60%;box-shadow:0 4px 18px rgba(0,0,0,.3)`

async function caption(page, text, sub = '') {
  await page.evaluate(
    ([text, sub, css]) => {
      let el = document.getElementById('lab-caption')
      if (!el) {
        el = document.createElement('div')
        el.id = 'lab-caption'
        el.setAttribute('style', css)
        document.body.appendChild(el)
      }
      el.innerHTML = `<div>${text}</div>${sub ? `<div style="font-weight:400;font-size:14px;opacity:.85;margin-top:4px">${sub}</div>` : ''}`
    },
    [text, sub, CAPTION_CSS],
  )
}

async function scrollThrough(page, { step = 160, pause = 110, settle = 700 } = {}) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
  for (let y = 0; y < total; y += step) {
    await page.evaluate((y) => scrollTo(0, y), Math.min(y, total))
    await page.waitForTimeout(pause)
  }
  await page.waitForTimeout(settle)
}

async function dragSlider(page, from = 0.12, to = 0.88, steps = 40) {
  const rect = await page.evaluate(() => {
    const v = document.querySelector('elastishot-viewer')
    const stage = v?.shadowRoot?.querySelector('.viewport')
    const r = stage?.getBoundingClientRect()
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
  })
  if (!rect) return
  const y = rect.y + Math.min(rect.h, 600) / 2
  await page.mouse.move(rect.x + rect.w * from, y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(rect.x + rect.w * (from + ((to - from) * i) / steps), y)
    await page.waitForTimeout(30)
  }
  await page.mouse.up()
}

async function mode(page, name, holdMs) {
  await page.click(`.toolbar button[data-mode="${name}"]`)
  await page.waitForTimeout(holdMs)
}

async function showReport(page, runDir, pairId, label, modes) {
  await page.goto(pathToFileURL(path.join(runDir, 'pairs', pairId, 'report.html')).href, { waitUntil: 'load' })
  await page.waitForTimeout(600)
  await caption(page, `Elastishot report: ${label}`, 'slider, flip, blink, overlay and diff modes')
  await page.evaluate(() => document.querySelector('elastishot-viewer')?.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(700)
  for (const [m, hold] of modes) {
    if (m === 'slider') {
      await mode(page, 'slider', 300)
      await dragSlider(page)
      await page.waitForTimeout(500)
    } else await mode(page, m, hold)
  }
}

export async function record({ siteUrl, runDir, outDir }) {
  const videoDir = path.join(outDir, 'video')
  const imgDir = path.join(outDir, 'img')
  fs.rmSync(videoDir, { recursive: true, force: true })
  fs.mkdirSync(videoDir, { recursive: true })
  fs.mkdirSync(imgDir, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } } })
  const page = await context.newPage()
  const shots = {}

  // 1. the builds
  for (const b of BUILDS) {
    await page.goto(`${siteUrl}/build-${b.n}/`, { waitUntil: 'load' })
    await page.evaluate(() => scrollTo(0, 0))
    await caption(page, b.title, b.summary)
    await page.waitForTimeout(b.n === 1 ? 2200 : 1400)
    await page.screenshot({ path: path.join(imgDir, `build-${b.n}.png`) })
    shots[`build-${b.n}`] = `img/build-${b.n}.png`
    await scrollThrough(page, { step: 200, pause: 90, settle: b.n === 1 ? 900 : 500 })
  }

  // 2. the summary page
  await page.goto(pathToFileURL(path.join(runDir, 'index.html')).href, { waitUntil: 'load' })
  await page.waitForTimeout(500)
  await caption(page, 'Elastishot summary', 'one card per scenario: similarity, counts and the elements that changed')
  await page.screenshot({ path: path.join(imgDir, 'summary.png'), fullPage: true })
  shots.summary = 'img/summary.png'
  await page.waitForTimeout(2500)
  await scrollThrough(page, { step: 240, pause: 120, settle: 600 })

  // 3. three pair reports
  await showReport(page, runDir, 'release--desktop', 'release (desktop)', [['slider', 0], ['flip', 1600], ['blink', 2600], ['overlay', 1600], ['diff', 1800]])
  await page.evaluate(() => document.querySelector('h2')?.nextElementSibling?.scrollIntoView({ block: 'start' }))
  await caption(page, 'Changed elements', 'the table names every element behind a change; a row jumps to its region')
  await page.waitForTimeout(1200)
  const row = page.locator('tr[data-regions]').first()
  if (await row.count()) {
    await row.click()
    await page.waitForTimeout(1800)
  }
  await showReport(page, runDir, 'text-changes--desktop', 'text changes (desktop)', [['diff', 1800], ['blink', 2600]])
  await showReport(page, runDir, 'images--desktop', 'images (desktop)', [['slider', 0], ['flip', 1500]])
  await showReport(page, runDir, 'release--mobile', 'release (mobile, 390 px)', [['slider', 0], ['diff', 1500]])
  await caption(page, 'That is the lab.', 'node examples/ui-lab/run-lab.mjs reproduces everything you just saw')
  await page.waitForTimeout(2200)

  const video = page.video()
  await context.close()
  await browser.close()
  const recorded = video ? await video.path() : null
  let file = null
  if (recorded && fs.existsSync(recorded)) {
    file = path.join(videoDir, 'lab-walkthrough.webm')
    fs.renameSync(recorded, file)
  }
  return { video: file ? 'video/lab-walkthrough.webm' : null, shots }
}
