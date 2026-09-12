import type { RegionKind } from '../core/types.ts'
import { escapeHtml, formatDate, layout, pct, STATUS_LABEL } from './html.ts'
import type { PairReport, ReportJson } from './schema.ts'

export interface SummaryOptions {
  title?: string
  /** How many changed locators to list per card. */
  topLocators?: number
}

const KIND_SIGN: Record<RegionKind, string> = { added: '+', removed: '-', changed: '~', moved: '>' }

function counts(p: PairReport): string {
  if (!p.summary) return ''
  const c = p.summary.counts
  return `<div class="counts" aria-label="regions">${(['added', 'removed', 'changed', 'moved'] as RegionKind[])
    .map((k) => `<span class="k-${k}" title="${k}">${KIND_SIGN[k]}${c[k]}</span>`)
    .join('')}</div>`
}

function thumbs(p: PairReport): string {
  const t = p.artifacts.thumbs
  if (!t) return ''
  const fig = (src: string | undefined, label: string) =>
    src ? `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy"><figcaption>${escapeHtml(label)}</figcaption></figure>` : ''
  return `<div class="thumbs">${fig(t.baseline, 'baseline')}${fig(t.candidate, 'candidate')}${fig(t.diff, 'diff')}</div>`
}

function locatorList(p: PairReport, max: number): string {
  const items = p.locators?.changedLocators.slice(0, max) ?? []
  if (!items.length) return ''
  return `<ul class="locators">${items
    .map((l) => `<li>${escapeHtml(l.name)} <code>${escapeHtml(l.locator)}</code> <span class="muted">${l.kinds.join(', ')}</span></li>`)
    .join('')}</ul>`
}

function card(p: PairReport, opts: Required<SummaryOptions>): string {
  const title = p.artifacts.report ? `<a href="${escapeHtml(p.artifacts.report)}">${escapeHtml(p.name)}</a>` : escapeHtml(p.name)
  const viewport = p.viewport ? `<span class="muted">${escapeHtml(p.viewport.name ?? `${p.viewport.width}x${p.viewport.height}`)}</span>` : ''
  const score = p.summary ? `<span class="score" title="similarity">${pct(p.summary.similarity)}</span>` : ''
  const reasons = p.failReasons.length ? `<ul class="reasons">${p.failReasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''
  const error = p.error ? `<p class="reasons">${escapeHtml(p.error)}</p>` : ''
  return `<article class="card" data-status="${p.status}">
<div class="head"><h3>${title} ${viewport}</h3><span class="pill ${p.status}">${STATUS_LABEL[p.status]}</span></div>
${thumbs(p)}
<div>${score} ${counts(p)}</div>
${locatorList(p, opts.topLocators)}${reasons}${error}
</article>`
}

const FILTER_SCRIPT = `
for (const b of document.querySelectorAll('.filters button')) b.addEventListener('click', () => {
  const f = b.dataset.filter
  for (const x of document.querySelectorAll('.filters button')) x.setAttribute('aria-pressed', String(x === b))
  for (const c of document.querySelectorAll('.card[data-status]')) c.hidden = f !== 'all' && c.dataset.status !== f
})`

/** One page: a card per compared pair. Images come from the pair artifacts (paths or data URIs). */
export function renderSummaryReport(report: ReportJson, options: SummaryOptions = {}): string {
  const opts: Required<SummaryOptions> = { title: options.title ?? 'Elastishot report', topLocators: options.topLocators ?? 5 }
  const t = report.totals
  const filters = [
    ['all', `All ${t.pairs}`],
    ['failed', `Failed ${t.failed}`],
    ['new', `New ${t.new}`],
    ['passed', `Passed ${t.passed}`],
    ['error', `Errors ${t.errors}`],
  ]
  const body = `<header class="top">
<h1>${escapeHtml(opts.title)}</h1>
<div class="muted">run ${escapeHtml(report.runId)} · ${escapeHtml(formatDate(report.createdAt))} · elastishot ${escapeHtml(report.elastishotVersion)} · threshold ${pct(report.config.threshold)}</div>
</header>
<div class="filters" role="group" aria-label="filter pairs">${filters
    .map(([f, label], i) => `<button type="button" data-filter="${f}" aria-pressed="${i === 0}">${escapeHtml(label)}</button>`)
    .join('')}</div>
<div class="grid">
${report.pairs.map((p) => card(p, opts)).join('\n')}
</div>`
  return layout({ title: opts.title, body, scripts: [{ code: FILTER_SCRIPT }] })
}
