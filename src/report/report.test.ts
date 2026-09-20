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

test('the Structure list calls a blank band of one column levelling, not a removal', () => {
  // the committed columns fixture: the left column gained two blocks and lost the 66 rows of
  // padding under it, the right one gained a block and 44 rows of padding; the card grew by 66.
  const bandMap: AlignmentResult['bandMap'] = [
    { kind: 'matched', axis: 'y', baseline: { start: 0, end: 574 }, candidate: { start: 0, end: 574 }, similarity: 1, offset: 0 },
    { kind: 'inserted', axis: 'y', baseline: { start: 574, end: 574 }, candidate: { start: 574, end: 662 }, similarity: 0, offset: 0, columns: { start: 0, end: 473 } },
    { kind: 'deleted', axis: 'y', baseline: { start: 672, end: 738 }, candidate: { start: 804, end: 804 }, similarity: 0, offset: 132, columns: { start: 0, end: 473 }, blank: true },
    { kind: 'inserted', axis: 'y', baseline: { start: 738, end: 738 }, candidate: { start: 760, end: 804 }, similarity: 0, offset: 22, columns: { start: 473, end: 1040 }, blank: true },
    // A blank block across the whole width is a spacing change and is reported as one. The engine never
    // marks such a band (gapRegions only marks a band that has `columns`), so this half is a guard on the
    // rule, not a shape any pair produces: do not go looking for the pair that made it.
    { kind: 'inserted', axis: 'y', baseline: { start: 900, end: 900 }, candidate: { start: 966, end: 1086 }, similarity: 0, offset: 66, blank: true },
  ]
  const gaps: PairReport = { ...failed, regions: [], locators: undefined, alignment: { ...alignment, bandMap } }
  const html = renderPairReport(gaps, { viewerScript: '' })
  assert.match(html, /<span class="k-added">88 rows inserted<\/span> at baseline row 574 in columns 0–473/)
  assert.match(html, /<li class="levelled"><span class="muted">66 blank rows closed up<\/span> at baseline row 672 in columns 0–473<\/li>/)
  assert.match(html, /<li class="levelled"><span class="muted">44 blank rows opened up<\/span> at baseline row 738 in columns 473–1040<\/li>/)
  assert.match(html, /<span class="k-added">120 rows inserted<\/span> at baseline row 900<\/li>/)
  assert.doesNotMatch(html, /66 rows removed|44 rows inserted/)
  assert.match(html, /the padding that column's own growth needed/)
  // with no blank column band the note stays away
  const plain = renderPairReport({ ...gaps, alignment: { ...alignment, bandMap: bandMap.filter((b) => !b.blank || !b.columns) } }, { viewerScript: '' })
  assert.doesNotMatch(plain, /the padding that column's own growth needed/)
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
