import { applyToBox, centre } from '../core/geometry.ts'
import type { ElementMap, ElementMapEntry, Transform2D } from '../core/types.ts'
import { indexByLocator } from './element-map.ts'

export type PresenceKind = 'added' | 'removed' | 'moved'

export interface PresenceChange {
  kind: PresenceKind
  locator: string
  baseline?: ElementMapEntry
  candidate?: ElementMapEntry
  /** Pixels the element centre moved, in baseline space (moved only). */
  distance?: number
}

export interface PresenceOptions {
  /** Candidate pixels -> baseline pixels; without it moves are measured in raw pixels. */
  transform?: Transform2D
  moveTolerancePx: number
  /** Report elements present on both sides whose position changed. */
  detectMoves: boolean
}

/**
 * Compare two element maps by locator string: elements that exist on one
 * side only, and (optionally) elements that moved.
 */
export function presenceDiff(baseline: ElementMap, candidate: ElementMap, options: PresenceOptions): PresenceChange[] {
  const b = indexByLocator(baseline)
  const c = indexByLocator(candidate)
  const out: PresenceChange[] = []
  for (const [locator, entry] of b) {
    const other = c.get(locator)
    if (!other) {
      out.push({ kind: 'removed', locator, baseline: entry })
      continue
    }
    if (!options.detectMoves) continue
    const box = options.transform ? applyToBox(options.transform.m, other.box) : other.box
    const from = centre(entry.box)
    const to = centre(box)
    const distance = Math.hypot(to.x - from.x, to.y - from.y)
    if (distance > options.moveTolerancePx) out.push({ kind: 'moved', locator, baseline: entry, candidate: other, distance })
  }
  for (const [locator, entry] of c) {
    if (!b.has(locator)) out.push({ kind: 'added', locator, candidate: entry })
  }
  return out
}
