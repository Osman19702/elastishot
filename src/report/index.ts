/**
 * elastishot/report: report.json, the summary page, the per-pair page and
 * JUnit XML. Pure string rendering; the Node layer decides where files go.
 */
export { renderJUnit } from './junit.ts'
export { renderPairReport, type PairOptions } from './pair.ts'
export {
  buildReport,
  isReportJson,
  REPORT_SCHEMA,
  reportExitCode,
  type PairArtifacts,
  type PairReport,
  type PairStatus,
  type ReportConfig,
  type ReportJson,
  type ReportMeta,
  type ReportTotals,
  type SideInfo,
} from './schema.ts'
export { renderSummaryReport, type SummaryOptions } from './summary.ts'
export { escapeHtml, jsonForScript } from './html.ts'
export { viewerBundle } from './viewer-bundle.ts'
