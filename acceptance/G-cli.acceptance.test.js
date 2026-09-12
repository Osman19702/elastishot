/**
 * Group G — Behaving well in a pipeline.
 * Scenarios: acceptance/features/G-cli.feature. Run: npm run test:acceptance
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { elastishot, image, workspace } from './support/cli.js'

let ws
before(async () => {
  ws = await workspace()
})
after(() => ws.remove())

const cli = (args) => elastishot(args, { cwd: ws.dir })

test('G1 — --json prints one parseable object and nothing else', async () => {
  const out = path.join(ws.dir, 'g1')
  const r = await cli(['compare', image('base.png'), image('shifted.png'), '--out', out, '--json'])
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.lines.length, 1)
  const printed = JSON.parse(r.stdout)
  const written = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'))
  assert.deepEqual(printed, written)
})

test('G2 — --quiet prints only the summary line', async () => {
  const r = await cli(['compare', image('base.png'), image('base.png'), '--quiet'])
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual(r.lines, ['1 pair: 1 passed, 0 failed, 0 new, 0 errors'])
})

test('G3 — Unknown flags, commands and bad values exit 2 with usage', async () => {
  for (const args of [['compare', 'a', 'b', '--bogus'], ['frobnicate'], ['snapshot', 'http://x', '--viewport', 'huge'], ['compare', 'only-one']]) {
    const r = await cli(args)
    assert.equal(r.code, 2, args.join(' '))
    assert.match(r.stderr, /^elastishot: /)
    assert.match(r.stderr, /Usage: elastishot <command>/)
  }
})

test('G4 — --fail-on none with a low threshold passes despite regions', async () => {
  const r = await cli(['compare', image('base.png'), image('recolored.png'), '--fail-on', 'none', '--threshold', '0.5', '--json'])
  assert.equal(r.code, 0, r.stderr)
  const pair = JSON.parse(r.stdout).pairs[0]
  assert.equal(pair.status, 'passed')
  assert.ok(pair.regions.length >= 1)
})

test('G5 — --help and --version exit 0', async () => {
  const help = await cli(['--help'])
  assert.equal(help.code, 0)
  assert.match(help.stdout, /^Usage: elastishot <command>/)
  const version = await cli(['--version'])
  assert.equal(version.code, 0)
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+/)
})
