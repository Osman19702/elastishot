import assert from 'node:assert/strict'
import { test } from 'node:test'

import { renderMarkdownSummary, topLocators } from './markdown.ts'
import { buildReport, type PairReport, type PairStatus } from './schema.ts'

function pair(name: string, status: PairStatus, extra: Partial<PairReport> = {}): PairReport {
  return {
    id: name,
    name,
    target: name,
    viewport: { name: 'desktop', width: 1280, height: 800 },
    status,
    failReasons: [],
    baseline: { source: 'b', map: true },
    candidate: { source: 'c', map: true },
    regions: [],
    artifacts: {},
    ...(status === 'failed' || status === 'passed'
      ? { summary: { passed: status === 'passed', similarity: status === 'passed' ? 1 : 0.9123, counts: { added: 1, removed: 0, changed: 2, moved: 0 }, warnings: [], structural: { matchedRows: 1, deletedRows: 0, insertedRows: 0 } } as unknown as PairReport['summary'] }
      : {}),
    ...extra,
  }
}

const locators = (...ls: string[]) =>
  ({ changedLocators: ls.map((locator) => ({ locator, evidence: ['pixels'] })), byRegion: [], unmapped: [], coverage: 'both' }) as unknown as PairReport['locators']

test('pairs that need a look come first; passed ones fold away', () => {
  const report = buildReport(
    [pair('home', 'passed'), pair('pricing', 'failed', { locators: locators('[data-testid="cta"]', '#faq | answers', 'a', 'b') }), pair('blog', 'new', { failReasons: ['not on main@abc1234: HTTP 404'] }), pair('docs', 'error', { error: 'cannot open http://x' })],
    { runId: 'r', elastishotVersion: '0', config: { threshold: 0.98, failOn: 'none', command: 'pr' }, context: { kind: 'pr', base: { ref: 'origin/main', sha: 'abc1234def', rule: 'r' }, head: { sha: 'h', dirty: true } } },
  )
  const md = renderMarkdownSummary(report)
  const lines = md.split('\n')
  assert.equal(lines[0], '### Visual check against `origin/main` (abc1234)')
  assert.equal(lines[2], '1 passed, 1 with differences, 1 new, 1 errors.')
  const rows = lines.filter((l) => l.startsWith('| ') && !l.startsWith('| Target'))
  assert.deepEqual(rows.map((r) => r.split(' | ')[0]), ['| docs', '| pricing', '| blog', '| home'])
  assert.match(md, /\| pricing \| desktop \| \*\*failed\*\* \| 91\.2% \| `\+1 -0 ~2 >0` \| `\[data-testid="cta"\]`, `#faq \\\| answers`, `a` \|/)
  assert.match(md, /\| blog \| desktop \| new \| {2}\| {2}\| not on main@abc1234: HTTP 404 \|/)
  assert.match(md, /\| docs \| desktop \| error \| .* cannot open http:\/\/x \|/)
  assert.match(md, /<details><summary>1 passed<\/summary>/)
})

test('without a pr context the title is used, and a size cap leaves rows out with a note', () => {
  const many = Array.from({ length: 50 }, (_, i) => pair(`page-${i}`, 'failed', { locators: locators(`[data-testid="t${i}"]`) }))
  const report = buildReport(many, { runId: 'r', elastishotVersion: '0', config: { threshold: 0.98, failOn: 'none' } })
  const md = renderMarkdownSummary(report, { title: 'Nightly', maxBytes: 2_000, reportUrl: 'https://example.com/run' })
  assert.match(md, /^### Nightly\n\n0 passed, 50 with differences, 0 new, 0 errors\. \[Full report\]\(https:\/\/example\.com\/run\)\./)
  assert.ok(md.length <= 2_000, `length ${md.length}`)
  assert.match(md, /\d+ more pairs left out to keep this summary small/)
  assert.deepEqual(topLocators(many[0]!), ['[data-testid="t0"]'])
})
