import type { DiffRegion, RegionKind } from '../core/types.ts'
import type { RegionLocators } from '../locators/index.ts'
import { escapeHtml, formatBox, formatDate, jsonForScript, layout, pct, STATUS_LABEL } from './html.ts'
import type { PairReport } from './schema.ts'
import { viewerBundle } from './viewer-bundle.ts'

export interface PairOptions {
  title?: string
  /** The viewer element's JavaScript; defaults to the bundled <elastishot-viewer>. */
  viewerScript?: string
}

const MODES: Array<[string, string]> = [
  ['slider', 'Slider'],
  ['slider-h', 'Slider (horizontal)'],
  ['flip', 'Flip'],
  ['blink', 'Blink'],
  ['overlay', 'Overlay'],
  ['diff', 'Diff'],
]

function regionRow(r: DiffRegion, locators: RegionLocators | undefined): string {
  const loc = (ref: RegionLocators['baseline']) => (ref ? `${escapeHtml(ref.name)} <code>${escapeHtml(ref.locator)}</code>` : '<span class="muted">-</span>')
  return `<tr data-region-id="${escapeHtml(r.id)}">
<td>${escapeHtml(r.id)}</td><td class="k-${r.kind}">${r.kind}</td><td class="score">${r.score.toFixed(2)}</td>
<td>${formatBox(r.boxBaseline)}</td><td>${formatBox(r.boxCandidate)}</td>
<td>${loc(locators?.baseline ?? null)}</td><td>${loc(locators?.candidate ?? null)}</td>
</tr>`
}

function metaTable(p: PairReport): string {
  const rows: Array<[string, string]> = [
    ['Baseline', p.baseline.source],
    ['Candidate', p.candidate.source],
  ]
  if (p.baseline.size) rows.push(['Baseline size', `${p.baseline.size.width}x${p.baseline.size.height}`])
  if (p.candidate.size) rows.push(['Candidate size', `${p.candidate.size.width}x${p.candidate.size.height}`])
  if (p.baseline.meta?.capturedAt) rows.push(['Baseline captured', formatDate(p.baseline.meta.capturedAt)])
  if (p.candidate.meta?.capturedAt) rows.push(['Candidate captured', formatDate(p.candidate.meta.capturedAt)])
  if (p.viewport) rows.push(['Viewport', `${p.viewport.width}x${p.viewport.height}${p.viewport.deviceScaleFactor ? ` @${p.viewport.deviceScaleFactor}x` : ''}`])
  if (p.alignment) {
    rows.push(['Alignment', `${p.alignment.method}, scale ${p.alignment.scale.toFixed(3)}, confidence ${pct(p.alignment.confidence)}`])
    rows.push(['Inliers', `${p.alignment.inliers} of ${p.alignment.matches} matches`])
  }
  if (p.summary) rows.push(['Structural rows', `matched ${p.summary.structural.matchedRows}, removed ${p.summary.structural.deletedRows}, added ${p.summary.structural.insertedRows}`])
  if (p.durationMs !== undefined) rows.push(['Duration', `${Math.round(p.durationMs)} ms`])
  return `<table class="meta">${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`
}

const PAGE_SCRIPT = `
const viewer = document.querySelector('elastishot-viewer')
const dataEl = document.getElementById('es-data')
const data = dataEl ? JSON.parse(dataEl.textContent) : null
if (viewer && data) { viewer.regions = data.regions; viewer.locators = data.locators; viewer.alignment = data.alignment }
const rows = [...document.querySelectorAll('tr[data-region-id]')]
const select = (id) => { for (const tr of rows) tr.classList.toggle('selected', tr.dataset.regionId === id) }
for (const tr of rows) tr.addEventListener('click', () => { select(tr.dataset.regionId); if (viewer && typeof viewer.selectRegion === 'function') viewer.selectRegion(tr.dataset.regionId) })
if (viewer) viewer.addEventListener('elastishot-region-select', (e) => select(e.detail && e.detail.region ? e.detail.region.id : null))
const modeButtons = [...document.querySelectorAll('.toolbar button[data-mode]')]
for (const b of modeButtons) b.addEventListener('click', () => {
  if (viewer) viewer.setAttribute('mode', b.dataset.mode)
  for (const x of modeButtons) x.setAttribute('aria-pressed', String(x === b))
})`

/** The detailed page of one pair: viewer, side by side, regions and locators. */
export function renderPairReport(p: PairReport, options: PairOptions = {}): string {
  const title = options.title ?? `${p.name} - Elastishot`
  const byRegion = new Map((p.locators?.byRegion ?? []).map((l) => [l.regionId, l]))
  const c = p.summary?.counts
  const counts = c
    ? `<span class="counts">${(['added', 'removed', 'changed', 'moved'] as RegionKind[]).map((k) => `<span class="k-${k}">${k} ${c[k]}</span>`).join('')}</span>`
    : ''
  const warnings = p.summary?.warnings ?? []
  const viewerAttrs = [
    p.baseline.image ? `baseline-src="${escapeHtml(p.baseline.image)}"` : '',
    p.candidate.image ? `candidate-src="${escapeHtml(p.candidate.image)}"` : '',
    p.artifacts.diff ? `diff-src="${escapeHtml(p.artifacts.diff)}"` : '',
    p.artifacts.warped ? `warped-src="${escapeHtml(p.artifacts.warped)}"` : '',
    'mode="slider"',
    'show-regions',
  ]
    .filter(Boolean)
    .join(' ')
  const data = {
    regions: p.regions,
    locators: p.locators ?? null,
    alignment: p.alignment ?? null,
    baselineSize: p.baseline.size ?? null,
    candidateSize: p.candidate.size ?? null,
  }
  const body = `<header class="top">
<h1>${escapeHtml(p.name)} <span class="pill ${p.status}">${STATUS_LABEL[p.status]}</span></h1>
<div>${p.summary ? `<span class="score">similarity ${pct(p.summary.similarity)}</span> ` : ''}${counts}</div>
</header>
${p.failReasons.length ? `<ul class="reasons">${p.failReasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
${p.error ? `<p class="reasons">${escapeHtml(p.error)}</p>` : ''}
${
  p.baseline.image || p.candidate.image
    ? `<div class="toolbar" role="group" aria-label="viewer mode">${MODES.map(([m, label], i) => `<button type="button" data-mode="${m}" aria-pressed="${i === 0}">${label}</button>`).join('')}</div>
<elastishot-viewer ${viewerAttrs}>
<script type="application/json" id="es-data">${jsonForScript(data)}</script>
</elastishot-viewer>
<div class="side-by-side">
${p.baseline.image ? `<figure><img src="${escapeHtml(p.baseline.image)}" alt="baseline"><figcaption>Baseline: ${escapeHtml(p.baseline.source)}</figcaption></figure>` : ''}
${p.candidate.image ? `<figure><img src="${escapeHtml(p.candidate.image)}" alt="candidate"><figcaption>Candidate: ${escapeHtml(p.candidate.source)}</figcaption></figure>` : ''}
</div>`
    : ''
}
<h2>Regions (${p.regions.length})</h2>
${
  p.regions.length
    ? `<table><thead><tr><th>Id</th><th>Kind</th><th>Score</th><th>Baseline box</th><th>Candidate box</th><th>Baseline locator</th><th>Candidate locator</th></tr></thead>
<tbody>${p.regions.map((r) => regionRow(r, byRegion.get(r.id))).join('\n')}</tbody></table>`
    : '<p class="muted">No differences.</p>'
}
${
  p.locators && p.locators.changedLocators.length
    ? `<h2>Changed locators (${p.locators.changedLocators.length})</h2>
<table><thead><tr><th>Name</th><th>Locator</th><th>Kinds</th><th>Presence</th><th>Evidence</th><th>Regions</th></tr></thead><tbody>
${p.locators.changedLocators
  .map(
    (l) =>
      `<tr><td>${escapeHtml(l.name)}</td><td><code>${escapeHtml(l.locator)}</code></td><td>${l.kinds.map((k) => `<span class="k-${k}">${k}</span>`).join(' ')}</td><td>${escapeHtml(l.presence)}</td><td>${escapeHtml(l.evidence.join(', '))}</td><td>${escapeHtml(l.regions.join(', '))}</td></tr>`,
  )
  .join('\n')}
</tbody></table>`
    : ''
}
${p.locators?.unmapped.length ? `<p class="muted">Regions with no element behind them: ${escapeHtml(p.locators.unmapped.join(', '))}</p>` : ''}
${warnings.length ? `<h2>Warnings</h2><ul class="warnings">${warnings.map((w) => `<li><code>${escapeHtml(w.code)}</code> ${escapeHtml(w.message)}</li>`).join('')}</ul>` : ''}
<h2>Details</h2>
${metaTable(p)}`
  return layout({
    title,
    body,
    scripts: [
      { code: options.viewerScript ?? viewerBundle, module: true },
      { code: PAGE_SCRIPT, module: true },
    ],
  })
}
