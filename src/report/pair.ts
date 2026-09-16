import type { DiffRegion, RegionKind } from '../core/types.ts'
import type { ChangedLocator, RegionLocators } from '../locators/index.ts'
import { displayName, escapeHtml, formatBox, formatDate, jsonForScript, layout, pct, shortLocator, STATUS_LABEL } from './html.ts'
import type { PairReport } from './schema.ts'
import { viewerBundle } from './viewer-bundle.ts'

export interface PairOptions {
  title?: string
  /** The viewer element's JavaScript; defaults to the bundled <elastishot-viewer>. */
  viewerScript?: string
  /** Rows shown before the rest of a table is folded away (default 25). */
  foldAfter?: number
}

const MODES: Array<[string, string]> = [
  ['slider', 'Slider'],
  ['flip', 'Flip'],
  ['blink', 'Blink'],
  ['overlay', 'Overlay'],
  ['diff', 'Diff'],
]

const locatorCell = (locator: string): string => `<code class="loc" title="${escapeHtml(locator)}">${escapeHtml(shortLocator(locator))}</code>`
const kindsCell = (kinds: RegionKind[]): string => kinds.map((k) => `<span class="k-${k}">${k}</span>`).join(' ')

function regionRow(r: DiffRegion, locators: RegionLocators | undefined): string {
  const loc = (ref: RegionLocators['baseline']) => (ref ? `${escapeHtml(displayName(ref.name))} ${locatorCell(ref.locator)}` : '<span class="muted">-</span>')
  return `<tr data-region-id="${escapeHtml(r.id)}">
<td>${escapeHtml(r.id)}</td><td class="k-${r.kind}">${r.kind}</td><td class="score">${r.score.toFixed(2)}</td>
<td>${formatBox(r.boxBaseline)}</td><td>${formatBox(r.boxCandidate)}</td>
<td>${loc(locators?.baseline ?? null)}</td><td>${loc(locators?.candidate ?? null)}</td>
</tr>`
}

/**
 * One line per block of rows that only one side has, with the element behind
 * it: the plain-language answer to "why is the similarity 65% when one card
 * was added".
 */
function structureSection(p: PairReport, byRegion: Map<string, RegionLocators>): string {
  const bands = p.alignment?.bandMap ?? []
  const gaps = bands.map((band, index) => ({ band, index })).filter(({ band }) => band.axis === 'y' && band.kind !== 'matched')
  if (!gaps.length) return ''
  const items = gaps.map(({ band, index }) => {
    const inserted = band.kind === 'inserted'
    const rows = inserted ? band.candidate.end - band.candidate.start : band.baseline.end - band.baseline.start
    const owners = p.regions
      .filter((r) => r.band === index && r.kind === (inserted ? 'added' : 'removed'))
      .map((r) => byRegion.get(r.id))
      .map((l) => (inserted ? l?.candidate : l?.baseline) ?? null)
      .filter((ref, i, all): ref is NonNullable<typeof ref> => ref !== null && all.findIndex((x) => x?.locator === ref.locator) === i)
    const who = owners.length ? `: ${owners.slice(0, 3).map((o) => `${escapeHtml(displayName(o.name, 50))} ${locatorCell(o.locator)}`).join(', ')}` : ''
    const lane = band.columns ? ` in columns ${band.columns.start}–${band.columns.end}` : ''
    return `<li><span class="k-${inserted ? 'added' : 'removed'}">${rows} rows ${inserted ? 'inserted' : 'removed'}</span> at baseline row ${band.baseline.start}${lane}${who}</li>`
  })
  const delta = (p.candidate.size?.height ?? 0) - (p.baseline.size?.height ?? 0)
  const height = delta ? ` The candidate is ${Math.abs(delta)} px ${delta > 0 ? 'taller' : 'shorter'}.` : ''
  return `<h2>Structure</h2>
<p class="muted">Blocks of rows that exist on one side only.${height} Rows below each block moved with it and were compared in place; the viewer shows the blocks as tinted gaps. A block "in columns" belongs to one of several side-by-side columns that moved on their own.</p>
<ul class="structure">${items.join('')}</ul>`
}

/** One row per element that changed on screen: what a tester reads first. */
function elementRow(l: ChangedLocator): string {
  return `<tr data-regions="${escapeHtml(l.regions.join(' '))}">
<td class="name">${escapeHtml(displayName(l.name))}</td><td>${locatorCell(l.locator)}</td><td>${kindsCell(l.kinds)}</td>
<td class="score">${l.score.toFixed(2)}</td><td>${l.regions.length}</td><td>${escapeHtml(l.presence)}</td>
</tr>`
}

function mapOnlyRow(l: ChangedLocator): string {
  const presence = l.sizeDelta ? `resized ${l.sizeDelta.w >= 0 ? '+' : ''}${l.sizeDelta.w}×${l.sizeDelta.h >= 0 ? '+' : ''}${l.sizeDelta.h} px` : l.presence
  return `<tr class="map-only"><td class="name">${escapeHtml(displayName(l.name))}</td><td>${locatorCell(l.locator)}</td><td>${kindsCell(l.kinds)}</td><td>${escapeHtml(presence)}</td></tr>`
}

/** A table whose rows beyond `foldAfter` sit in a collapsed details block. */
function foldedTable(head: string, rows: string[], foldAfter: number, label: string): string {
  const shown = rows.slice(0, foldAfter)
  const rest = rows.slice(foldAfter)
  const table = (body: string[]) => `<table><thead><tr>${head}</tr></thead><tbody>${body.join('\n')}</tbody></table>`
  if (!rest.length) return table(shown)
  return `${table(shown)}<details class="more"><summary>Show the other ${rest.length} ${label}</summary>${table(rest)}</details>`
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
  const status = (label: string, meta: PairReport['baseline']['meta']) => {
    if (!meta || (meta.httpStatus === undefined && !meta.title)) return
    rows.push([label, [meta.httpStatus !== undefined ? `HTTP ${meta.httpStatus}` : '', meta.title ? `"${meta.title}"` : ''].filter(Boolean).join(' · ')])
  }
  status('Baseline page', p.baseline.meta)
  status('Candidate page', p.candidate.meta)
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
const show = (id) => { select(id); if (viewer && typeof viewer.selectRegion === 'function') viewer.selectRegion(id); if (viewer) viewer.scrollIntoView({ block: 'nearest' }) }
for (const tr of rows) tr.addEventListener('click', () => show(tr.dataset.regionId))
for (const tr of document.querySelectorAll('tr[data-regions]')) tr.addEventListener('click', () => { const first = tr.dataset.regions.split(' ')[0]; if (first) show(first) })
if (viewer) viewer.addEventListener('elastishot-region-select', (e) => select(e.detail && e.detail.region ? e.detail.region.id : null))
const hideRegions = document.getElementById('hide-regions')
if (viewer && hideRegions) {
  hideRegions.addEventListener('change', () => viewer.toggleAttribute('hide-regions', hideRegions.checked))
  new MutationObserver(() => { hideRegions.checked = viewer.hasAttribute('hide-regions') }).observe(viewer, { attributes: true, attributeFilter: ['hide-regions'] })
}
const modeButtons = [...document.querySelectorAll('.toolbar button[data-mode]')]
for (const b of modeButtons) b.addEventListener('click', () => {
  if (viewer) viewer.setAttribute('mode', b.dataset.mode)
  for (const x of modeButtons) x.setAttribute('aria-pressed', String(x === b))
})`

/** The detailed page of one pair: viewer, changed elements, regions, locators. */
export function renderPairReport(p: PairReport, options: PairOptions = {}): string {
  const title = options.title ?? `${p.name} - Elastishot`
  const foldAfter = options.foldAfter ?? 25
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
    p.artifacts.gaps ? `gaps-src="${escapeHtml(p.artifacts.gaps)}"` : '',
    'mode="slider"',
    'show-regions',
    // The page draws the mode buttons itself, so the element's own row stays hidden.
    'no-toolbar',
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
  const all = p.locators?.changedLocators ?? []
  const onScreen = all.filter((l) => l.evidence.includes('pixels'))
  const mapOnly = all.filter((l) => !l.evidence.includes('pixels'))
  const elementsHead = '<th>Element</th><th>Locator</th><th>Kinds</th><th>Score</th><th>Regions</th><th>Presence</th>'
  const regionsHead = '<th>Id</th><th>Kind</th><th>Score</th><th>Baseline box</th><th>Candidate box</th><th>Baseline locator</th><th>Candidate locator</th>'
  const body = `<header class="top">
<h1>${escapeHtml(p.name)} <span class="pill ${p.status}">${STATUS_LABEL[p.status]}</span></h1>
<div>${p.summary ? `<span class="score">similarity ${pct(p.summary.similarity)}</span> ` : ''}${counts}</div>
</header>
${p.failReasons.length ? `<ul class="reasons">${p.failReasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
${p.error ? `<p class="reasons">${escapeHtml(p.error)}</p>` : ''}
${
  p.baseline.image || p.candidate.image
    ? `<div class="toolbar" role="group" aria-label="viewer mode">${MODES.map(([m, label], i) => `<button type="button" data-mode="${m}" aria-pressed="${i === 0}">${label}</button>`).join('')}<label class="toggle"><input type="checkbox" id="hide-regions"> Hide region boxes</label></div>
<elastishot-viewer ${viewerAttrs}>
<script type="application/json" id="es-data">${jsonForScript(data)}</script>
</elastishot-viewer>
<details><summary>Side by side</summary><div class="side-by-side">
${p.baseline.image ? `<figure><img src="${escapeHtml(p.baseline.image)}" alt="baseline" loading="lazy"><figcaption>Baseline: ${escapeHtml(p.baseline.source)}</figcaption></figure>` : ''}
${p.candidate.image ? `<figure><img src="${escapeHtml(p.candidate.image)}" alt="candidate" loading="lazy"><figcaption>Candidate: ${escapeHtml(p.candidate.source)}</figcaption></figure>` : ''}
</div></details>`
    : ''
}
${structureSection(p, byRegion)}
${
  onScreen.length
    ? `<h2>Changed elements (${onScreen.length})</h2>
<p class="muted">Elements whose pixels changed, largest change first. Click a row to jump to its first region.</p>
${foldedTable(elementsHead, onScreen.map(elementRow), foldAfter, 'elements')}`
    : ''
}
${
  p.regions.length
    ? `<details${p.regions.length <= foldAfter ? ' open' : ''}><summary>Regions (${p.regions.length})</summary>
${foldedTable(regionsHead, p.regions.map((r) => regionRow(r, byRegion.get(r.id))), foldAfter, 'regions')}</details>`
    : '<h2>Regions (0)</h2><p class="muted">No differences.</p>'
}
${
  mapOnly.length
    ? `<details><summary>Seen in the DOM only (${mapOnly.length})</summary>
<p class="muted">Elements the element maps found on one side only, or whose size changed, with no pixel change attributed to them.</p>
${foldedTable('<th>Element</th><th>Locator</th><th>Kinds</th><th>Presence</th>', mapOnly.map(mapOnlyRow), foldAfter, 'elements')}</details>`
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
