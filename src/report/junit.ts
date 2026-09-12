import type { ReportJson } from './schema.ts'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
const escapeXml = (v: unknown): string => String(v).replace(/[&<>"']/g, (c) => ESCAPES[c]!)

/** JUnit XML: one testsuite per run, one testcase per pair; new pairs are skipped, errors are errors. */
export function renderJUnit(report: ReportJson, suiteName = 'elastishot'): string {
  const t = report.totals
  const time = (report.pairs.reduce((s, p) => s + (p.durationMs ?? 0), 0) / 1000).toFixed(3)
  const cases = report.pairs.map((p) => {
    const name = p.viewport ? `${p.name} [${p.viewport.name ?? `${p.viewport.width}x${p.viewport.height}`}]` : p.name
    const open = `  <testcase classname="${escapeXml(suiteName)}" name="${escapeXml(name)}" time="${((p.durationMs ?? 0) / 1000).toFixed(3)}"`
    if (p.status === 'passed') return `${open}/>`
    if (p.status === 'new') return `${open}>\n    <skipped message="no baseline yet"/>\n  </testcase>`
    if (p.status === 'error') return `${open}>\n    <error message="${escapeXml(p.error ?? 'comparison failed')}">${escapeXml(p.error ?? '')}</error>\n  </testcase>`
    const locators = p.locators?.changedLocators.map((l) => `${l.kinds.join('/')} ${l.name} ${l.locator}`).join('\n') ?? ''
    const body = [...p.failReasons, locators ? `changed locators:\n${locators}` : ''].filter(Boolean).join('\n')
    return `${open}>\n    <failure message="${escapeXml(p.failReasons[0] ?? 'differences found')}">${escapeXml(body)}</failure>\n  </testcase>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="${escapeXml(suiteName)}" tests="${t.pairs}" failures="${t.failed}" errors="${t.errors}" skipped="${t.new}" time="${time}">
<testsuite name="${escapeXml(suiteName)}" tests="${t.pairs}" failures="${t.failed}" errors="${t.errors}" skipped="${t.new}" time="${time}" timestamp="${escapeXml(report.createdAt)}">
${cases.join('\n')}
</testsuite>
</testsuites>
`
}
