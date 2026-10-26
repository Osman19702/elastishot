/**
 * Group H — Checking a pull request without baselines.
 * Scenarios: acceptance/features/H-pr.feature. Run: npm run test:acceptance
 */

import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { prFixture } from '../test/support/git-fixture.ts'
import { elastishot, workspace } from './support/cli.js'

const CONFIG = {
  viewports: [{ name: 'desktop', width: 1280, height: 800 }],
  capture: { fullPage: true },
  targets: [{ name: 'home', url: '/page/' }],
}

let ws
const fixtures = []
before(async () => {
  ws = await workspace()
})
after(async () => {
  for (const f of fixtures) await f.remove()
  await ws.remove()
})

async function repo(config = CONFIG) {
  const f = await prFixture(config)
  fixtures.push(f)
  return f
}

// The repositories have no pull request, whatever job runs this tier.
const pr = (f, args = [], env = {}) => elastishot(['pr', ...args], { cwd: f.dir, env: { GITHUB_BASE_REF: '', GITHUB_STEP_SUMMARY: '', ...env } })
const worktrees = (f) => f.git('worktree', 'list').split('\n').length

test('H1 — A branch is compared with its base without committed baselines', async () => {
  const f = await repo()
  const r = await pr(f)
  assert.equal(r.code, 1, r.stderr)
  assert.match(r.lines[0], /^FAIL home \[desktop\]\s+score \d+\.\d%.*-> /)
  assert.match(r.stderr, /comparing the working tree with main \([0-9a-f]{7}, where this branch left main\)/)
  await assert.rejects(access(path.join(f.dir, 'baselines')))
  assert.equal(worktrees(f), 1)
})

test('H2 — A page the branch adds is new, not an error', async () => {
  const f = await repo()
  await f.page('v2', 'pricing')
  await f.write('elastishot.config.json', JSON.stringify({ ...CONFIG, targets: [...CONFIG.targets, { name: 'pricing', url: '/pricing/' }] }))
  const r = await pr(f, ['--json'])
  assert.equal(r.code, 1, r.stderr)
  const pricing = JSON.parse(r.stdout).pairs.find((p) => p.target === 'pricing')
  assert.equal(pricing.status, 'new')
  assert.match(pricing.failReasons[0], /^not on main@[0-9a-f]{7}: HTTP 404$/)
})

test('H3 — The job summary gets a table that names the base', async () => {
  const f = await repo()
  const summary = path.join(ws.dir, 'h3-summary.md')
  const r = await pr(f, [], { GITHUB_STEP_SUMMARY: summary })
  assert.equal(r.code, 1, r.stderr)
  const text = await readFile(summary, 'utf8')
  assert.match(text, /^### Visual check against `main` \([0-9a-f]{7}\)$/m)
  assert.match(text, /^\| home \| desktop \| \*\*failed\*\* \| \d+\.\d% \| `\+\d+ -\d+ ~\d+ >\d+` \| /m)
})

test('H4 — A base that captures nothing exits 2 and leaves no worktree behind', async () => {
  const f = await repo({ ...CONFIG, targets: [{ name: 'pricing', url: '/pricing/' }] })
  const r = await pr(f)
  assert.equal(r.code, 2)
  assert.match(r.stderr, /elastishot: nothing could be captured on main@[0-9a-f]{7}: HTTP 404/)
  assert.equal(worktrees(f), 1)
})

test('H5 — A server command that ignores its port fails instead of comparing another server', async () => {
  const server = path.resolve('test/fixtures/servers/wrong-port.mjs')
  const f = await repo({ ...CONFIG, pr: { serve: { command: `node "${server}"`, timeoutMs: 3000 } } })
  const r = await pr(f)
  assert.equal(r.code, 2)
  assert.match(r.stderr, /Does the command listen on \{port\}/)
  assert.equal(worktrees(f), 1)
})
