import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { collapseRows, createPage, recolor, scaleImage } from '../fixtures/synth.ts'
import { engine } from '../support/cv.ts'

before(() => engine.warmup())

test('a 1080x1350 pair compares in well under 1.5 s once warm', async () => {
  const page = createPage({ width: 1080, seed: 5, sections: 6, sectionHeight: 190 })
  assert.ok(page.image.height >= 1300, `page is ${page.image.height} tall`)
  const candidate = scaleImage(recolor(page.image, page.manifest.sections[2]!.title, [220, 38, 38, 255]), 1.1)
  await engine.compare(page.image, candidate)
  const t = performance.now()
  const r = await engine.compare(page.image, candidate)
  const ms = performance.now() - t
  assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms: ${JSON.stringify(r.summary.timingsMs)}`)
  assert.equal(r.summary.counts.changed, 1)
})

test('repeated compares do not leak memory', async () => {
  const page = createPage({ seed: 9, sections: 4 })
  const s = page.manifest.sections[1]!
  const candidate = collapseRows(page.image, s.box.y, s.box.y + s.box.h + 24)
  for (let i = 0; i < 5; i++) await engine.compare(page.image, candidate)
  const before = process.memoryUsage().rss
  for (let i = 0; i < 40; i++) await engine.compare(page.image, candidate)
  const growth = (process.memoryUsage().rss - before) / 1048576
  assert.ok(growth < 80, `rss grew by ${growth.toFixed(0)} MB over 40 compares`)
})
