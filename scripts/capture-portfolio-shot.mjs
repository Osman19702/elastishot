#!/usr/bin/env node
/**
 * The 1200x750 screenshot on the portfolio's Projects card: the pair report
 * of the UI lab's "release" scenario with the slider at 55 %, header and
 * toolbar included, so the picture shows a real run, not a mock-up.
 *
 *   node examples/ui-lab/run-lab.mjs --no-video      # produces the run it captures
 *   node scripts/capture-portfolio-shot.mjs ../my-portfolio/img/elastishot.png
 *
 * The output path is the only argument; it defaults to portfolio-shot.png in
 * the current folder.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from 'playwright'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] ?? 'portfolio-shot.png')
const latest = fs.readFileSync(path.join(repo, 'examples', 'ui-lab', '.elastishot', 'runs', 'latest'), 'utf8').trim()
const report = path.join(latest, 'pairs', 'release--desktop', 'report.html')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 750 }, deviceScaleFactor: 1 })
await page.goto(pathToFileURL(report).href, { waitUntil: 'load' })
await page.waitForTimeout(1200)
await page.evaluate(() => {
  document.querySelector('elastishot-viewer')?.setAttribute('position', '55')
  document.querySelector('elastishot-viewer')?.setAttribute('zoom', 'fit')
  window.scrollTo(0, 0)
})
await page.waitForTimeout(400)
await page.screenshot({ path: out, fullPage: false })
await browser.close()
console.log(`${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB) from ${report}`)
