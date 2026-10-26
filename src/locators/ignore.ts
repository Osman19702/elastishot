/**
 * Ignore by locator: each locator is looked up in both element maps and its
 * boxes become ignore regions on that side, so an element that moved with
 * the layout is left out wherever it landed. Baselines need no recapture:
 * the maps stored next to them are enough.
 */
import type { Box, ElementMap } from '../core/types.ts'

export interface IgnoredElement {
  /** The locator as configured. */
  selector: string
  side: 'baseline' | 'candidate'
  /** The map entry it matched. */
  locator: string
  box: Box
}

export interface IgnoreResolution {
  /** Boxes in baseline pixels. */
  baseline: Box[]
  /** Boxes in candidate pixels. */
  candidate: Box[]
  ignored: IgnoredElement[]
  /** Locators that matched nothing in either map. */
  unresolved: string[]
}

/** `[data-testid=x]`, `[data-testid='x']` and `[data-testid="x"]` are the same locator. */
export function normalizeLocator(locator: string): string {
  return locator.trim().replace(/\[\s*([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s"']+))\s*\]/g, (_m, attr: string, dq?: string, sq?: string, bare?: string) => `[${attr}="${dq ?? sq ?? bare ?? ''}"]`)
}

/**
 * Resolve locators through the maps. A locator matches an entry with the
 * same locator, and every `>> nth=` instance of it when the page repeats it.
 */
export function resolveIgnore(selectors: readonly string[], maps: { baseline: ElementMap | null; candidate: ElementMap | null }): IgnoreResolution {
  const out: IgnoreResolution = { baseline: [], candidate: [], ignored: [], unresolved: [] }
  for (const selector of selectors) {
    const wanted = normalizeLocator(selector)
    let hits = 0
    for (const side of ['baseline', 'candidate'] as const) {
      for (const e of maps[side]?.elements ?? []) {
        if (e.locator !== wanted && !e.locator.startsWith(`${wanted} >> nth=`)) continue
        out[side].push(e.box)
        out.ignored.push({ selector, side, locator: e.locator, box: e.box })
        hits++
      }
    }
    if (!hits) out.unresolved.push(selector)
  }
  return out
}
