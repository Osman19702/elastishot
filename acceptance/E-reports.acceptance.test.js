/**
 * Group E — Reports that travel.
 * Scenarios: acceptance/features/E-reports.feature. Run: npm run test:acceptance
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { elastishot, image, workspace } from './support/cli.js'

let ws
let runDir
let report
before(async () => {
  ws = await workspace()
  runDir = path.join(ws.dir, 'run')
  const r = await elastishot(['compare', image('base.png'), image('collapsed.png'), '--out', runDir, '--name', 'home', '--junit', '--json'], { cwd: ws.dir })
  assert.equal(r.code, 1, r.stderr)
  report = JSON.parse(r.stdout)
})
after(() => ws.remove())

const read = (...p) => readFile(path.join(runDir, ...p), 'utf8')

test('E1 — The summary page has a card per pair', async () => {
  const html = await read('index.html')
  assert.equal((html.match(/<article class="card"/g) ?? []).length, 1)
  assert.match(html, /class="pill failed">Failed</)
  assert.match(html, /class="score" title="similarity">\d+\.\d%/)
  assert.equal((html.match(/data:image\/jpeg;base64,/g) ?? []).length, 3)
  assert.match(html, /href="pairs\/home\/report\.html"/)
})

test('E2 — The pair page lists every region', async () => {
  const html = await read('pairs', 'home', 'report.html')
  assert.equal((html.match(/<tr data-region-id=/g) ?? []).length, report.pairs[0].regions.length)
  assert.match(html, /<elastishot-viewer baseline-src="baseline\.png" candidate-src="candidate\.png" diff-src="diff\.png" warped-src="warped\.png"/)
})

test('E3 — report.json is the machine-readable source of both pages', async () => {
  const json = JSON.parse(await read('report.json'))
  assert.equal(json.schema, 'elastishot.report/1')
  assert.deepEqual(json.totals, { pairs: 1, passed: 0, failed: 1, new: 0, errors: 0 })
  const pair = json.pairs[0]
  assert.equal(pair.name, 'home')
  assert.ok(pair.summary.similarity < 1)
  assert.ok(pair.regions.length >= 1)
  assert.equal(pair.alignment.transform.m.length, 9)
  assert.deepEqual(json.pairs[0].regions, report.pairs[0].regions)
})

test('E4 — junit.xml has a testcase per pair', async () => {
  const xml = await read('junit.xml')
  assert.match(xml, /tests="1" failures="1" errors="0" skipped="0"/)
  assert.match(xml, /<testcase classname="elastishot" name="home" time="[\d.]+">\s*<failure message="[^"]+">/)
})

test('E5 — A single-file report has no external references', async () => {
  const out = path.join(ws.dir, 'single')
  const r = await elastishot(['compare', image('base.png'), image('collapsed.png'), '--out', out, '--name', 'home', '--single-file'], { cwd: ws.dir })
  assert.equal(r.code, 1, r.stderr)
  const html = await readFile(path.join(out, 'pairs', 'home', 'report.html'), 'utf8')
  assert.doesNotMatch(html, /src="[^"d][^"]*\.(png|js|css)"/)
  assert.doesNotMatch(html, /<link |https?:\/\//)
  assert.match(html, /baseline-src="data:image\/png;base64,/)
})
