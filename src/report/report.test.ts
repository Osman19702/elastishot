import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { AlignmentResult, CompareSummary, DiffRegion } from '../core/types.ts'
import type { LocatorReport } from '../locators/index.ts'
import { buildReport, renderJUnit, renderPairReport, renderSummaryReport, reportExitCode, type PairReport } from './index.ts'

const summary: CompareSummary = {
  passed: false,
  similarity: 0.912,
  counts: { added: 0, removed: 1, changed: 1, moved: 0 },
  changedPixelFraction: 0.08,
  alignMethod: 'features-similarity',
  scale: 1,
  baselineSize: { width: 1280, height: 2100 },
  candidateSize: { width: 1280, height: 1800 },
  workingScale: { baseline: 0.8, candidate: 0.8 },
  structural: { matchedRows: 1780, insertedRows: 0, deletedRows: 320 },
  warnings: [{ code: 'PARTIAL_COVERAGE', message: 'the candidate covers only 85% of the baseline' }],
  timingsMs: { globalAlign: 120 },
}
const alignment: AlignmentResult = {
  method: 'features-similarity',
  transform: { kind: 'identity', m: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotationDeg: 0,
  translation: { x: 0, y: 0 },
  keypoints: { baseline: 900, candidate: 880 },
  matches: 600,
  inliers: 540,
  inlierRatio: 0.9,
  spread: 0.8,
  reprojectionRms: 0.4,
  confidence: 0.93,
  bandMap: [],
  fallbackChain: ['features-similarity'],
}
const regions: DiffRegion[] = [
  { id: 'r1', kind: 'removed', boxBaseline: { x: 0, y: 900, w: 1280, h: 320 }, boxCandidate: null, score: 0.97, pixelsChanged: 400000, areaFraction: 1, meanDelta: 1, confidence: 0.9, tags: [] },
  { id: 'r2', kind: 'changed', boxBaseline: { x: 96, y: 412, w: 160, h: 44 }, boxCandidate: { x: 96, y: 412, w: 160, h: 44 }, score: 0.4, pixelsChanged: 3000, areaFraction: 0.4, meanDelta: 0.5, confidence: 0.8, tags: [] },
]
const locators: LocatorReport = {
  coverage: 'both',
  changedLocators: [
    { locator: '#faq', name: 'FAQ <section>', strategy: 'id', kinds: ['removed'], regions: ['r1'], presence: 'baseline-only', evidence: ['pixels', 'map'], score: 0.97 },
    { locator: '[data-testid="cta"]', name: 'Get started', strategy: 'testid', kinds: ['changed'], regions: ['r2'], presence: 'both', evidence: ['pixels'], score: 0.4 },
  ],
  byRegion: [
    { regionId: 'r1', kind: 'removed', baseline: { locator: '#faq', name: 'FAQ <section>', strategy: 'id', tag: 'details', box: { x: 0, y: 900, w: 1280, h: 320 }, coverage: 1, iou: 1 }, candidate: null, all: [] },
    { regionId: 'r2', kind: 'changed', baseline: null, candidate: null, all: [] },
  ],
  unmapped: ['r2'],
  warnings: [],
}
const failed: PairReport = {
  id: 'home--desktop',
  name: 'home',
  target: 'home',
  viewport: { name: 'desktop', width: 1280, height: 800 },
  status: 'failed',
  failReasons: ['similarity 0.912 is below the threshold 0.98', '1 removed region at or above score 0.05'],
  baseline: { source: 'baselines/home/desktop', image: 'pairs/home--desktop/baseline.png', map: true, size: { width: 1280, height: 2100 } },
  candidate: { source: 'https://example.test/', image: 'pairs/home--desktop/candidate.png', map: true, size: { width: 1280, height: 1800 } },
  summary,
  alignment,
  regions,
  locators,
  artifacts: { diff: 'pairs/home--desktop/diff.png', report: 'pairs/home--desktop/report.html', thumbs: { baseline: 'data:image/jpeg;base64,AAAA', candidate: 'data:image/jpeg;base64,BBBB', diff: 'data:image/jpeg;base64,CCCC' } },
  durationMs: 2310,
}
const passed: PairReport = { ...failed, id: 'pricing--desktop', name: 'pricing "quoted" </script>', status: 'passed', failReasons: [], regions: [], summary: { ...summary, passed: true, similarity: 0.999, counts: { added: 0, removed: 0, changed: 0, moved: 0 } }, artifacts: {} }
const errored: PairReport = {
  id: 'blog--mobile',
  name: 'blog',
  status: 'error',
  failReasons: [],
  error: 'cannot open https://example.test/blog: net::ERR_CONNECTION_REFUSED',
  baseline: { source: 'baselines/blog/mobile', map: false },
  candidate: { source: 'https://example.test/blog', map: false },
  regions: [],
  artifacts: {},
}
const fresh: PairReport = { ...passed, id: 'docs--desktop', name: 'docs', status: 'new' }

const report = buildReport([failed, passed, errored, fresh], { runId: '2026-09-11T18-00-00Z', elastishotVersion: '0.1.0', config: { threshold: 0.98, failOn: ['added', 'removed', 'changed', 'moved'] } })

test('buildReport totals and exit codes', () => {
  assert.deepEqual(report.totals, { pairs: 4, passed: 1, failed: 1, new: 1, errors: 1 })
  assert.equal(reportExitCode(report), 2)
  assert.equal(reportExitCode(buildReport([passed], { runId: 'x', elastishotVersion: '0', config: report.config })), 0)
  assert.equal(reportExitCode(buildReport([passed, fresh], { runId: 'x', elastishotVersion: '0', config: report.config })), 1)
})

test('the summary page has a card per pair with status, score, locators and escaped names', () => {
  const html = renderSummaryReport(report)
  assert.equal((html.match(/<article class="card"/g) ?? []).length, 4)
  assert.match(html, /class="pill failed">Failed</)
  assert.match(html, /class="pill error">Error</)
  assert.match(html, /91\.2%/)
  assert.match(html, /<code class="loc" title="#faq">#faq<\/code>/)
  assert.match(html, /FAQ &lt;section&gt;/)
  assert.match(html, /pricing &quot;quoted&quot; &lt;\/script&gt;/)
  assert.doesNotMatch(html, /pricing "quoted" <\/script>/)
  assert.match(html, /href="pairs\/home--desktop\/report\.html"/)
  assert.match(html, /data:image\/jpeg;base64,AAAA/)
  assert.match(html, /ERR_CONNECTION_REFUSED/)
  assert.doesNotMatch(html, /<link |src="http/)
})

test('the pair page embeds the viewer, region rows and changed locators', () => {
  const html = renderPairReport(failed, { viewerScript: 'customElements.define("x-y", class extends HTMLElement {})' })
  assert.match(html, /<elastishot-viewer baseline-src="pairs\/home--desktop\/baseline\.png" candidate-src="pairs\/home--desktop\/candidate\.png" diff-src="pairs\/home--desktop\/diff\.png" mode="slider" show-regions no-toolbar>/)
  assert.match(html, /<script type="application\/json" id="es-data">/)
  assert.equal((html.match(/<tr data-region-id=/g) ?? []).length, 2)
  assert.match(html, /<td class="k-removed">removed<\/td>/)
  assert.match(html, /0,900 1280x320/)
  assert.match(html, /Changed elements \(2\)/)
  assert.match(html, /<tr data-regions="r1">/)
  assert.match(html, /<details open><summary>Regions \(2\)<\/summary>/)
  assert.match(html, /baseline-only/)
  assert.match(html, /PARTIAL_COVERAGE/)
  assert.match(html, /customElements\.define/)
  assert.match(html, /Regions with no element behind them: r2/)
  // the embedded JSON cannot break out of its script element
  const json = html.match(/id="es-data">(.*?)<\/script>/s)![1]!
  assert.doesNotMatch(json, /<\/script/)
  const data = JSON.parse(json.replace(/<\\\//g, '</'))
  assert.equal(data.regions.length, 2)
  assert.equal(data.locators.changedLocators[0].name, 'FAQ <section>')
})

test('a pair without images still renders', () => {
  const html = renderPairReport(errored)
  assert.doesNotMatch(html, /<elastishot-viewer/)
  assert.match(html, /No differences\./)
  assert.match(html, /ERR_CONNECTION_REFUSED/)
})

test('JUnit output has one testcase per pair with failures, errors and skips', () => {
  const xml = renderJUnit(report)
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/)
  assert.equal((xml.match(/<testcase /g) ?? []).length, 4)
  assert.match(xml, /tests="4" failures="1" errors="1" skipped="1"/)
  assert.match(xml, /<testcase classname="elastishot" name="home \[desktop\]" time="2\.310">/)
  assert.match(xml, /<failure message="similarity 0\.912 is below the threshold 0\.98">/)
  assert.match(xml, /changed locators:\nremoved FAQ &lt;section&gt; #faq/)
  assert.match(xml, /<error message="cannot open https:\/\/example\.test\/blog: net::ERR_CONNECTION_REFUSED">/)
  assert.match(xml, /<skipped message="no baseline yet"\/>/)
  assert.match(xml, /name="pricing &quot;quoted&quot; &lt;\/script&gt; \[desktop\]"/)
})
