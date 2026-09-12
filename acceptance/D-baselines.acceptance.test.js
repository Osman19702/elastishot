/**
 * Group D — Tracking a URL across deployments.
 * Scenarios: acceptance/features/D-baselines.feature. Run: npm run test:acceptance
 */

import assert from 'node:assert/strict'
import { access, readFile, writeFile } from 'node:fs/promises'
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

const exists = (p) => access(p).then(() => true, () => false)
const cli = (args) => elastishot(args, { cwd: ws.dir })

async function config(version) {
  await writeFile(
    path.join(ws.dir, 'elastishot.config.json'),
    JSON.stringify({ viewports: [{ name: 'desktop', width: 1280, height: 800 }], capture: { fullPage: true }, targets: [{ name: 'home', url: version === 1 ? site.v1 : site.v2 }] }),
  )
}

test('D1 — snapshot writes a baseline folder', async () => {
  await config(1)
  const r = await cli(['snapshot', site.v1, '--name', 'landing', '--json'])
  assert.equal(r.code, 0, r.stderr)
  const dir = JSON.parse(r.stdout).dir
  for (const f of ['baseline.png', 'baseline.map.json', 'meta.json']) assert.ok(await exists(path.join(dir, f)), f)
  assert.equal(path.basename(path.dirname(dir)), 'landing')
})

test('D2 — A target without a baseline is new until --update creates it', async () => {
  await config(1)
  const first = await cli(['run'])
  assert.equal(first.code, 1, first.stderr)
  assert.match(first.lines[0], /^NEW {2}home \[desktop\]/)
  const update = await cli(['run', '--update'])
  assert.equal(update.code, 0, update.stderr)
  assert.ok(await exists(path.join(ws.dir, 'baselines', 'home', 'desktop', 'baseline.png')))
})

test('D3 — A changed deployment fails, approve promotes it, the next run passes', async () => {
  await config(2)
  const failing = await cli(['run'])
  assert.equal(failing.code, 1, failing.stderr)
  assert.match(failing.lines[0], /^FAIL home \[desktop\]\s+score \d+\.\d%.*-> /)
  const approve = await cli(['approve', 'home', '--json'])
  assert.equal(approve.code, 0, approve.stderr)
  assert.deepEqual(JSON.parse(approve.stdout).approved, ['home/desktop'])
  const meta = JSON.parse(await readFile(path.join(ws.dir, 'baselines', 'home', 'desktop', 'meta.json'), 'utf8'))
  assert.ok(meta.approvedAt)
  assert.ok(meta.approvedFrom)
  const passing = await cli(['run'])
  assert.equal(passing.code, 0, passing.stderr)
  assert.match(passing.lines[0], /^PASS home \[desktop\]/)
})
