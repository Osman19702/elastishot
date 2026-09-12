/**
 * The baseline workflow end to end with real captures: run --update writes
 * baselines from v1, a run against v2 fails and names the changes, approve
 * promotes v2, and the next run passes.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { main, type CliIo } from '../../src/cli/main.ts'
import { startStaticServer } from '../support/static-server.js'

let tmp = ''
let server: { url: string; close: () => Promise<void> }

before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'elastishot-workflow-'))
  server = await startStaticServer('test/fixtures/site')
})
after(async () => {
  await server.close()
  await rm(tmp, { recursive: true, force: true })
})

function io(): CliIo & { out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { cwd: tmp, out, err, stdout: (l) => out.push(l), stderr: (l) => err.push(l) }
}

async function writeConfig(version: 'v1' | 'v2'): Promise<void> {
  await writeFile(
    path.join(tmp, 'elastishot.config.json'),
    JSON.stringify({
      viewports: [{ name: 'desktop', width: 1280, height: 800 }],
      capture: { fullPage: true },
      report: { junit: true },
      targets: [{ name: 'home', url: `${server.url}/${version}/` }],
    }),
  )
}

test('run without baselines reports new and exits 1; --update writes them', async () => {
  await writeConfig('v1')
  const first = io()
  assert.equal(await main(['run'], first), 1, first.err.join('\n'))
  assert.match(first.out[0]!, /^NEW {2}home \[desktop\]/)
  const update = io()
  assert.equal(await main(['run', '--update'], update), 0, update.err.join('\n'))
  const meta = JSON.parse(await readFile(path.join(tmp, 'baselines', 'home', 'desktop', 'meta.json'), 'utf8'))
  assert.equal(meta.schema, 'elastishot.snapshot/1')
  assert.equal(meta.target, 'home')
  assert.equal(meta.viewportName, 'desktop')
})

test('a run against the new version fails and names the changed locators', async () => {
  await writeConfig('v2')
  const run = io()
  assert.equal(await main(['run', '--json'], run), 1, run.err.join('\n'))
  const report = JSON.parse(run.out[0]!)
  const pair = report.pairs[0]
  assert.equal(pair.status, 'failed')
  assert.equal(pair.target, 'home')
  const locators = pair.locators.changedLocators.map((l: { locator: string }) => l.locator)
  assert.ok(locators.includes('[data-testid="cta"]'), locators.join(', '))
  assert.ok(locators.includes('[data-testid="badge"]'), locators.join(', '))
  assert.ok(locators.some((l: string) => l.startsWith('#faq')), locators.join(', '))
  const junit = await readFile(path.join(tmp, '.elastishot', 'runs', report.runId, 'junit.xml'), 'utf8')
  assert.match(junit, /<failure message=/)
  const human = io()
  assert.equal(await main(['run'], human), 1)
  assert.match(human.out[0]!, /^FAIL home \[desktop\]\s+score \d+\.\d%.*-> .*(cta|faq|badge)/)
})

test('approve promotes the candidate and the next run passes', async () => {
  const listing = io()
  assert.equal(await main(['approve'], listing), 2)
  assert.match(listing.err[0]!, /candidates .*home\/desktop/)
  const approve = io()
  assert.equal(await main(['approve', 'home', '--json'], approve), 0, approve.err.join('\n'))
  assert.deepEqual(JSON.parse(approve.out[0]!).approved, ['home/desktop'])
  const meta = JSON.parse(await readFile(path.join(tmp, 'baselines', 'home', 'desktop', 'meta.json'), 'utf8'))
  assert.ok(meta.approvedAt)
  const again = io()
  assert.equal(await main(['run'], again), 0, again.err.join('\n'))
  assert.match(again.out[0]!, /^PASS home \[desktop\]/)
})

test('compare a baseline folder against a page URL reuses the baseline viewport', async () => {
  const c = io()
  const code = await main(['compare', path.join(tmp, 'baselines', 'home', 'desktop'), `${server.url}/v1/`, '--json'], c)
  assert.equal(code, 1, c.err.join('\n'))
  const report = JSON.parse(c.out[0]!)
  assert.equal(report.pairs[0].candidate.size.width, 1280)
  assert.equal(report.pairs[0].candidate.map, true)
  assert.ok(report.pairs[0].locators.changedLocators.some((l: { locator: string }) => l.locator === '[data-testid="cta"]'))
})

test('snapshot writes a baseline folder for a URL', async () => {
  const s = io()
  const code = await main(['snapshot', `${server.url}/v1/`, '--name', 'landing', '--viewport', '390x844@2', '--full-page', '--json'], s)
  assert.equal(code, 0, s.err.join('\n'))
  const info = JSON.parse(s.out[0]!)
  // the fixture page is 1200 px wide, so a full-page capture is wider than the 390 px viewport
  assert.ok(info.image.width >= 780, `width ${info.image.width}`)
  assert.equal(info.meta.dpr, 2)
  assert.ok(info.elements > 10)
  assert.equal(info.dir, path.join(tmp, 'baselines', 'landing', '390x844-2'))
})
