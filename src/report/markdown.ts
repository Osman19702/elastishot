/**
 * A Markdown summary of a run, for a GitHub job summary or a pull request
 * comment: one table row per pair that needs a look, the passed pairs folded
 * away below.
 */
import type { PairReport, ReportJson } from './schema.ts'

export interface MarkdownOptions {
  /** The heading when the run has no pull request context. */
  title?: string
  /** A link to the full report: an artifact or a hosted page. */
  reportUrl?: string
  /** Upper bound in bytes; GitHub takes at most 1 MiB per step summary. */
  maxBytes?: number
}

const SIGN = { added: '+', removed: '-', changed: '~', moved: '>' } as const

/** The changed elements with pixel evidence, the most evidence first: what a summary line names. */
export function topLocators(p: PairReport, n = 3): string[] {
  return p.locators?.changedLocators.filter((l) => l.evidence.includes('pixels')).slice(0, n).map((l) => l.locator) ?? []
}

/** Text safe inside a table cell: no pipe ends the cell, no newline ends the row. */
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
/** An inline code span that survives backticks in the text. */
const code = (s: string): string => (s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``)

function row(p: PairReport): string {
  const s = p.summary
  const similarity = s ? `${(s.similarity * 100).toFixed(1)}%` : ''
  // In backticks: a pair of ~ would otherwise turn the cell into strikethrough.
  const counts = s ? code((Object.keys(SIGN) as Array<keyof typeof SIGN>).map((k) => `${SIGN[k]}${s.counts[k]}`).join(' ')) : ''
  const elements = p.error ?? (p.status === 'new' ? p.failReasons.join('; ') : topLocators(p).map(code).join(', '))
  const viewport = p.viewport?.name ?? (p.viewport ? `${p.viewport.width}x${p.viewport.height}` : '')
  return `| ${cell(p.target ?? p.name)} | ${cell(viewport)} | ${p.status === 'failed' ? '**failed**' : p.status} | ${similarity} | ${counts} | ${cell(elements)} |`
}

const HEAD = ['| Target | Viewport | Result | Similarity | Regions | Elements |', '|---|---|---|---|---|---|']
const ORDER = { error: 0, failed: 1, new: 2, passed: 3 } as const

export function renderMarkdownSummary(report: ReportJson, options: MarkdownOptions = {}): string {
  const maxBytes = options.maxBytes ?? 900_000
  const base = report.context?.kind === 'pr' ? report.context.base : null
  const heading = base ? `### Visual check against ${code(base.ref)} (${base.sha.slice(0, 7)})` : `### ${options.title ?? 'Elastishot'}`
  const t = report.totals
  const totals = `${t.passed} passed, ${t.failed} with differences, ${t.new} new, ${t.errors} errors.${options.reportUrl ? ` [Full report](${options.reportUrl}).` : ''}`
  const pairs = [...report.pairs].sort((a, b) => ORDER[a.status] - ORDER[b.status])
  const attention = pairs.filter((p) => p.status !== 'passed')
  const passed = pairs.filter((p) => p.status === 'passed')
  const lines = [heading, '', totals, '']
  let size = lines.join('\n').length
  let dropped = 0
  const take = (rows: PairReport[]): string[] => {
    const out: string[] = []
    for (const p of rows) {
      const line = row(p)
      if (size + line.length + 200 > maxBytes) {
        dropped++
        continue
      }
      size += line.length + 1
      out.push(line)
    }
    return out
  }
  if (attention.length) lines.push(...HEAD, ...take(attention), '')
  if (passed.length) {
    const rows = take(passed)
    if (rows.length) lines.push(`<details><summary>${passed.length} passed</summary>`, '', ...HEAD, ...rows, '', '</details>', '')
  }
  if (dropped) lines.push(`${dropped} more pair${dropped === 1 ? '' : 's'} left out to keep this summary small; the full report has them.`, '')
  return lines.join('\n')
}
