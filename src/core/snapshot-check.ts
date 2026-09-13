/**
 * Sanity checks on a captured page before it is compared: an error page, a
 * redirect notice or an empty document must not pass as "the site".
 */
import type { ElementMap, SnapshotMeta, Warning } from './types.ts'

const ERROR_TITLE = /\b(404|403|500|502|503|not found|page not found|error|couldn.t load|can.t be reached|temporarily (offline|unavailable)|access denied|forbidden|unavailable|redirecting)\b/i
/** Real pages expose more elements than this, even a login form. */
const MIN_ELEMENTS = 5

export interface SnapshotCheckInput {
  meta?: SnapshotMeta | null
  elementMap?: ElementMap | null
}

/**
 * Warnings for a side that looks like an error or placeholder page. `side`
 * names the side in the messages. Sides without meta are files, which are
 * taken as they are.
 */
export function checkSnapshot(side: 'baseline' | 'candidate', input: SnapshotCheckInput): Warning[] {
  const out: Warning[] = []
  const meta = input.meta
  if (!meta) return out
  const push = (message: string, data: Record<string, unknown>) => out.push({ code: 'CAPTURE_ERROR_PAGE', message: `${side}: ${message}`, data: { side, ...data } })
  if (meta.httpStatus !== undefined && meta.httpStatus >= 400) push(`the page answered HTTP ${meta.httpStatus}`, { httpStatus: meta.httpStatus })
  if (meta.title && ERROR_TITLE.test(meta.title)) push(`the document title "${meta.title.slice(0, 80)}" looks like an error page`, { title: meta.title })
  const map = input.elementMap
  if (map && map.elements.length < MIN_ELEMENTS) push(`only ${map.elements.length} elements were found on the page`, { elements: map.elements.length })
  return out
}
