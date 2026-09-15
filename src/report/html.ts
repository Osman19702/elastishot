import type { Box } from '../core/types.ts'
import type { PairStatus } from './schema.ts'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]!)
}

/** JSON that is safe inside a <script> element. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--')
}

/** JavaScript that is safe inside a <script> element. */
export function scriptForHtml(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')
}

export const STATUS_LABEL: Record<PairStatus, string> = { passed: 'Passed', failed: 'Failed', new: 'New', error: 'Error' }

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

export function formatBox(b: Box | null | undefined): string {
  return b ? `${b.x},${b.y} ${b.w}x${b.h}` : '-'
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

export const BASE_CSS = `
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1f2937; --muted: #6b7280; --line: #e5e7eb; --card: #f9fafb; --accent: #2563eb;
  --pass: #16a34a; --fail: #dc2626; --new: #d97706; --err: #7c3aed; --added: #16a34a; --removed: #dc2626; --changed: #c026d3; --moved: #2563eb; }
@media (prefers-color-scheme: dark) { :root { --bg: #0f172a; --fg: #e5e7eb; --muted: #94a3b8; --line: #334155; --card: #1e293b; --accent: #60a5fa;
  --added: #4ade80; --removed: #f87171; --changed: #e879f9; --moved: #93c5fd; } }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--fg); }
.wrap { max-width: 1240px; margin: 0 auto; padding: 24px 20px 48px; }
header.top { display: flex; flex-wrap: wrap; gap: 8px 24px; align-items: baseline; justify-content: space-between; margin-bottom: 18px; }
h1 { font-size: 22px; margin: 0; } h2 { font-size: 17px; margin: 28px 0 10px; } h3 { font-size: 15px; margin: 0; }
a { color: var(--accent); }
.muted { color: var(--muted); }
.pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-weight: 600; font-size: 12px; color: #fff; background: var(--muted); vertical-align: middle; }
.pill.passed { background: var(--pass); } .pill.failed { background: var(--fail); } .pill.new { background: var(--new); } .pill.error { background: var(--err); }
.score { font-variant-numeric: tabular-nums; font-weight: 600; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
.card { border: 1px solid var(--line); border-radius: 12px; background: var(--card); padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.card[hidden] { display: none; }
.card .head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.card .thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.card .thumbs img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
.card .thumbs figcaption { font-size: 11px; color: var(--muted); text-align: center; }
.card figure { margin: 0; }
.counts span { margin-right: 10px; font-variant-numeric: tabular-nums; }
.k-added { color: var(--added); } .k-removed { color: var(--removed); } .k-changed { color: var(--changed); } .k-moved { color: var(--moved); }
.locators { margin: 0; padding-left: 18px; } .locators li { margin: 2px 0; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr[data-region-id] { cursor: pointer; } tr.selected td { background: color-mix(in srgb, var(--accent) 18%, transparent); }
code { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: color-mix(in srgb, var(--fg) 8%, transparent); padding: 1px 5px; border-radius: 4px; word-break: break-all; }
.filters, .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.filters button, .toolbar button { font: inherit; padding: 6px 12px; border: 1px solid var(--line); background: var(--card); color: var(--fg); border-radius: 8px; cursor: pointer; }
.filters button[aria-pressed="true"], .toolbar button[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
.side-by-side { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } .side-by-side figure { margin: 0; } .side-by-side img { width: 100%; height: auto; border: 1px solid var(--line); background: #fff; }
.side-by-side figcaption { font-size: 12px; color: var(--muted); margin-top: 4px; }
elastishot-viewer { display: block; margin: 12px 0; max-width: 100%; }
elastishot-viewer::part(stage) { max-height: 80vh; }
details { margin: 20px 0 0; } details > summary { cursor: pointer; font-weight: 600; font-size: 15px; margin-bottom: 8px; }
details.more { margin: 8px 0 0; } details.more > summary { font-weight: 500; font-size: 13px; color: var(--muted); }
td.name { max-width: 34ch; } .loc { white-space: nowrap; } .loc[title] { cursor: help; }
tr[data-regions] { cursor: pointer; }
.map-only td { color: var(--muted); }
.warnings { margin: 0; padding-left: 18px; } .warnings li { color: var(--new); }
.meta th { width: 160px; color: var(--muted); font-weight: 500; }
.reasons { margin: 6px 0 0; padding-left: 18px; color: var(--fail); }
.structure { margin: 0; padding-left: 18px; } .structure li { margin: 3px 0; } .structure .k-added, .structure .k-removed { font-weight: 600; }
@media (max-width: 720px) { .side-by-side { grid-template-columns: 1fr; } .card .thumbs { grid-template-columns: repeat(3, 1fr); } }
`

export interface LayoutOptions {
  title: string
  body: string
  /** Extra <head> content, already escaped. */
  headExtra?: string
  /** Inline script bodies, appended at the end of <body>. */
  scripts?: Array<{ code: string; module?: boolean }>
}

export function layout(o: LayoutOptions): string {
  const scripts = (o.scripts ?? [])
    .filter((s) => s.code.trim().length > 0)
    .map((s) => `<script${s.module ? ' type="module"' : ''}>\n${scriptForHtml(s.code)}\n</script>`)
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<style>${BASE_CSS}</style>
${o.headExtra ?? ''}
</head>
<body>
<div class="wrap">
${o.body}
</div>
${scripts}
</body>
</html>
`
}

/** A readable element label: whitespace collapsed and cut at `max` characters. */
export function displayName(name: string, max = 70): string {
  const flat = name.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** The tail of a long CSS path; testid, id and role locators are short already. */
export function shortLocator(locator: string, keep = 2): string {
  const parts = locator.split(' > ')
  return parts.length > keep ? `… > ${parts.slice(-keep).join(' > ')}` : locator
}
