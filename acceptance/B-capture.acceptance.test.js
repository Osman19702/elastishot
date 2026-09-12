/**
 * Group B — Capturing a page with its element map.
 * Scenarios: acceptance/features/B-capture.feature. Run: npm run test:acceptance
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { elastishot, workspace } from './support/cli.js'
import { startSite } from './support/site.js'

let ws
let site
before(async () => {
  ws = await workspace()
  site = await startSite()
})
after(async () => {
  await site.close()
  await ws.remove()
})

async function snapshot(name, extra = []) {
  const r = await elastishot(['snapshot', site.v1, '--name', name, '--full-page', '--json', ...extra], { cwd: ws.dir })
  assert.equal(r.code, 0, r.stderr)
  const info = JSON.parse(r.stdout)
  const map = JSON.parse(await readFile(path.join(info.dir, 'baseline.map.json'), 'utf8'))
  return { info, map, find: (locator) => map.elements.find((e) => e.locator === locator) }
}

test('B1 — Elements get the most stable locator available', async () => {
  const { map, find } = await snapshot('b1')
  assert.equal(map.schema, 'elastishot.element-map/1')
  assert.equal(find('[data-testid="cta"]').strategy, 'testid')
  assert.equal(find('#faq').strategy, 'id')
  assert.equal(find('role=heading[name="Ship UI changes with confidence"]').strategy, 'role')
  const dts = map.elements.filter((e) => e.tag === 'dt')
  assert.equal(dts.length, 3)
  assert.ok(dts.every((e) => e.strategy === 'css' && e.locator.startsWith('#faq > ')), dts.map((e) => e.locator).join(' | '))
})

test('B2 — Hidden selectors are left out of the map', async () => {
  const { find } = await snapshot('b2', ['--hide', '#faq'])
  assert.equal(find('#faq'), undefined)
  assert.ok(find('[data-testid="cta"]'))
})

test('B3 — Element boxes follow the device pixel ratio', async () => {
  const one = await snapshot('b3-1x', ['--viewport', '1280x800'])
  const two = await snapshot('b3-2x', ['--viewport', '1280x800@2'])
  assert.equal(one.info.image.width, 1280)
  assert.equal(two.info.image.width, 2560)
  const a = one.find('[data-testid="cta"]').box
  const b = two.find('[data-testid="cta"]').box
  assert.ok(Math.abs(b.w - 2 * a.w) <= 2 && Math.abs(b.h - 2 * a.h) <= 2, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
  assert.ok(Math.abs(b.x - 2 * a.x) <= 2 && Math.abs(b.y - 2 * a.y) <= 2)
})
