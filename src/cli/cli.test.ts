import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { main, type CliIo } from './main.ts'

let tmp = ''
before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'elastishot-cli-'))
})
after(() => rm(tmp, { recursive: true, force: true }))

function io(cwd = tmp): CliIo & { out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { cwd, out, err, stdout: (l) => out.push(l), stderr: (l) => err.push(l) }
}

const fixtures = path.resolve('test/fixtures/images')
const exists = (p: string) => access(p).then(() => true, () => false)

test('help, version and usage errors', async () => {
  const h = io()
  assert.equal(await main(['--help'], h), 0)
  assert.match(h.out.join('\n'), /^Usage: elastishot <command>/)
  const v = io()
  assert.equal(await main(['-v'], v), 0)
  assert.match(v.out[0]!, /^\d+\.\d+\.\d+/)
  const none = io()
  assert.equal(await main([], none), 2)
  const bad = io()
  assert.equal(await main(['compare', 'a', 'b', '--nope'], bad), 2)
  assert.match(bad.err[0]!, /nope/)
  const few = io()
  assert.equal(await main(['compare', 'only-one'], few), 2)
  assert.match(few.err[0]!, /exactly two sides/)
  const missing = io()
  assert.equal(await main(['compare', path.join(tmp, 'nope.png'), path.join(tmp, 'nope2.png')], missing), 2)
  assert.match(missing.err[0]!, /no such file/)
})

test('compare two images: run folder, report files and exit code 1', async () => {
  const out = path.join(tmp, 'run-collapsed')
  const c = io()
  const code = await main(['compare', path.join(fixtures, 'base.png'), path.join(fixtures, 'collapsed.png'), '--out', out, '--name', 'collapsed'], c)
  assert.equal(code, 1, c.err.join('\n'))
  assert.match(c.out[0]!, /^FAIL collapsed\s+score \d+\.\d%\s+\+\d -\d ~\d >\d/)
  assert.match(c.out.at(-2)!, /1 pair: 0 passed, 1 failed, 0 new, 0 errors/)
  assert.match(c.out.at(-1)!, /report: .*run-collapsed\/index\.html/)
  for (const f of ['report.json', 'index.html', 'pairs/collapsed/report.html', 'pairs/collapsed/baseline.png', 'pairs/collapsed/candidate.png', 'pairs/collapsed/diff.png', 'pairs/collapsed/result.json']) {
    assert.ok(await exists(path.join(out, f)), `missing ${f}`)
  }
  const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'))
  assert.equal(report.schema, 'elastishot.report/1')
  assert.equal(report.pairs[0].status, 'failed')
  assert.ok(report.pairs[0].summary.counts.removed >= 1)
  assert.equal(report.pairs[0].locators.coverage, 'none')
  const html = await readFile(path.join(out, 'pairs/collapsed/report.html'), 'utf8')
  assert.match(html, /<elastishot-viewer baseline-src="baseline\.png" candidate-src="candidate\.png" diff-src="diff\.png" warped-src="warped\.png"/)
  assert.match(html, /customElements\.define|class \w+ extends HTMLElement/)
  assert.ok(await exists(path.join(tmp, '.elastishot', 'runs', 'latest')))
})

test('identical images pass with exit 0, --json prints one object, --quiet prints one line', async () => {
  const j = io()
  const code = await main(['compare', path.join(fixtures, 'base.png'), path.join(fixtures, 'base.png'), '--out', path.join(tmp, 'run-same'), '--json'], j)
  assert.equal(code, 0)
  assert.equal(j.out.length, 1)
  const report = JSON.parse(j.out[0]!)
  assert.equal(report.totals.passed, 1)
  const q = io()
  assert.equal(await main(['compare', path.join(fixtures, 'base.png'), path.join(fixtures, 'shifted.png'), '--out', path.join(tmp, 'run-shift'), '--quiet'], q), 0)
  assert.equal(q.out.length, 1)
  assert.match(q.out[0]!, /1 passed/)
})

test('--fail-on none and a low threshold let differences pass; --single-file inlines images', async () => {
  const c = io()
  const out = path.join(tmp, 'run-lenient')
  const code = await main(['compare', path.join(fixtures, 'base.png'), path.join(fixtures, 'recolored.png'), '--out', out, '--fail-on', 'none', '--threshold', '0.5', '--single-file', '--junit'], c)
  assert.equal(code, 0, c.err.join('\n'))
  assert.ok(await exists(path.join(out, 'junit.xml')))
  assert.equal(await exists(path.join(out, 'pairs', 'recolored', 'baseline.png')), false)
  const html = await readFile(path.join(out, 'pairs', 'recolored', 'report.html'), 'utf8')
  assert.match(html, /baseline-src="data:image\/png;base64,/)
  const junit = await readFile(path.join(out, 'junit.xml'), 'utf8')
  assert.match(junit, /<testcase classname="elastishot" name="recolored" time="[\d.]+"\/>/)
})

test('approve without a target or --all explains what it needs; report re-renders a run', async () => {
  const a = io()
  assert.equal(await main(['approve'], a), 2)
  assert.match(a.err[0]!, /approve needs a target or --all/)
  const r = io()
  assert.equal(await main(['report', path.join(tmp, 'run-collapsed')], r), 1)
  assert.match(r.out.at(-2)!, /1 failed/)
  const missing = io()
  assert.equal(await main(['report', path.join(tmp, 'nowhere')], missing), 2)
})
