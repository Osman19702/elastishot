/**
 * pr end to end with real git, servers and captures: the base commit and the
 * working tree of a throwaway repository, compared without baselines.
 */
import assert from 'node:assert/strict'
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { main, type CliIo } from '../../src/cli/main.ts'
import { prFixture, SERVE_SCRIPT, type PrFixture } from '../support/git-fixture.ts'

const CONFIG = {
  viewports: [{ name: 'desktop', width: 1280, height: 800 }],
  capture: { fullPage: true },
  targets: [{ name: 'home', url: '/page/' }],
}

// In a GitHub pull request job these are set for the job itself; the
// fixture repositories have no pull request, and their summaries go here.
const saved = { base: process.env.GITHUB_BASE_REF, summary: process.env.GITHUB_STEP_SUMMARY }
let tmp = ''
let summary = ''
const fixtures: PrFixture[] = []
before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'elastishot-pr-test-'))
  summary = path.join(tmp, 'step-summary.md')
  delete process.env.GITHUB_BASE_REF
  process.env.GITHUB_STEP_SUMMARY = summary
})
after(async () => {
  for (const f of fixtures) await f.remove()
  await rm(tmp, { recursive: true, force: true })
  if (saved.base === undefined) delete process.env.GITHUB_BASE_REF
  else process.env.GITHUB_BASE_REF = saved.base
  if (saved.summary === undefined) delete process.env.GITHUB_STEP_SUMMARY
  else process.env.GITHUB_STEP_SUMMARY = saved.summary
})

function io(cwd: string): CliIo & { out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { cwd, out, err, stdout: (l) => out.push(l), stderr: (l) => err.push(l) }
}

async function fixture(config: object): Promise<PrFixture> {
  const f = await prFixture(config)
  fixtures.push(f)
  return f
}

test('pr compares the working tree with its base and leaves nothing behind', async () => {
  const f = await fixture(CONFIG)
  const r = io(f.dir)
  assert.equal(await main(['pr', '--json'], r), 1, r.err.join('\n'))
  const report = JSON.parse(r.out[0]!)
  const head = f.git('rev-parse', 'HEAD')
  assert.equal(report.config.command, 'pr')
  assert.equal(report.context.kind, 'pr')
  assert.deepEqual([report.context.base.ref, report.context.base.sha], ['main', head])
  assert.deepEqual(report.context.head, { sha: head, dirty: true })
  const pair = report.pairs[0]
  const locators = pair.locators.changedLocators.map((l: { locator: string }) => l.locator)
  for (const want of ['[data-testid="cta"]', '[data-testid="badge"]']) assert.ok(locators.includes(want), locators.join(', '))
  assert.ok(locators.some((l: string) => l.startsWith('#faq')), locators.join(', '))
  assert.match(pair.baseline.source, /^main@[0-9a-f]{7} \/page\/$/)
  assert.equal(pair.candidate.source, 'working tree /page/')
  assert.match(await readFile(summary, 'utf8'), /### Visual check against `main` \([0-9a-f]{7}\)\n\n0 passed, 1 with differences/)
  assert.match(await readFile(path.join(f.dir, '.elastishot', 'runs', report.runId, 'summary.md'), 'utf8'), /\| home \| desktop \| \*\*failed\*\*/)
  // One run folder, no baselines, no worktree left.
  assert.deepEqual((await readdir(path.join(f.dir, '.elastishot', 'runs'))).sort(), [report.runId, 'latest'])
  await assert.rejects(access(path.join(f.dir, 'baselines')))
  assert.equal(f.git('worktree', 'list').split('\n').length, 1)
})

test('a page the branch adds is new rather than an error, and a clean tree passes', async () => {
  const f = await fixture(CONFIG)
  await f.page('v2', 'pricing')
  await f.write('elastishot.config.json', JSON.stringify({ ...CONFIG, targets: [...CONFIG.targets, { name: 'pricing', url: '/pricing/' }] }))
  const r = io(f.dir)
  assert.equal(await main(['pr', '--json'], r), 1, r.err.join('\n'))
  const pricing = JSON.parse(r.out[0]!).pairs.find((p: { target: string }) => p.target === 'pricing')
  assert.equal(pricing.status, 'new')
  assert.match(pricing.failReasons[0], /^not on main@[0-9a-f]{7}: HTTP 404$/)
  f.git('stash', '-u')
  const clean = io(f.dir)
  assert.equal(await main(['pr'], clean), 0, clean.err.join('\n'))
  assert.match(clean.out[0]!, /^PASS home \[desktop\]/)
})

test('a base that captures nothing exits 2 and leaves no worktree', async () => {
  const f = await fixture({ ...CONFIG, targets: [{ name: 'pricing', url: '/pricing/' }] })
  const r = io(f.dir)
  assert.equal(await main(['pr'], r), 2)
  assert.match(r.err.join('\n'), /nothing could be captured on main@[0-9a-f]{7}: HTTP 404/)
  assert.equal(f.git('worktree', 'list').split('\n').length, 1)
})

test('a serve command serves each side, and approve refuses a pr run', async () => {
  const f = await fixture({ ...CONFIG, pr: { serve: { command: 'node serve.mjs', ready: { log: 'ready' } } } })
  await f.write('serve.mjs', SERVE_SCRIPT)
  f.git('add', 'serve.mjs')
  f.git('commit', '-q', '-m', 'a server')
  const r = io(f.dir)
  assert.equal(await main(['pr', '--json'], r), 1, r.err.join('\n'))
  const report = JSON.parse(r.out[0]!)
  assert.equal(report.pairs[0].status, 'failed')
  const approve = io(f.dir)
  assert.equal(await main(['approve', '--all', path.join(f.dir, '.elastishot', 'runs', report.runId)], approve), 2)
  assert.match(approve.err[0]!, /was made by pr; only pairs made by run can be approved/)
})
