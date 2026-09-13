import { applyToBox, centre } from '../core/geometry.ts'
import type { ElementMap, ElementMapEntry, Transform2D } from '../core/types.ts'
import { indexByLocator } from './element-map.ts'

export type PresenceKind = 'added' | 'removed' | 'moved' | 'resized'

export interface PresenceChange {
  kind: PresenceKind
  locator: string
  baseline?: ElementMapEntry
  candidate?: ElementMapEntry
  /** Pixels the element centre moved, in baseline space (moved only). */
  distance?: number
  /** Width and height change in baseline pixels (resized only). */
  sizeDelta?: { w: number; h: number }
}

export interface PresenceOptions {
  /** Candidate pixels -> baseline pixels; without it moves are measured in raw pixels. */
  transform?: Transform2D
  moveTolerancePx: number
  /** Report elements present on both sides whose position changed. */
  detectMoves: boolean
  /** Report elements present on both sides whose size changed (default true in mapLocators). */
  detectResizes?: boolean
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
    if (!options.detectMoves && !options.detectResizes) continue
    const box = options.transform ? applyToBox(options.transform.m, other.box) : other.box
    if (options.detectResizes) {
      // A button that grew for a longer label, a card that wrapped to one
      // more line: the DOM knows even when the pixels land on a neighbour.
      const dw = box.w - entry.box.w
      const dh = box.h - entry.box.h
      if (Math.abs(dw) > options.moveTolerancePx || Math.abs(dh) > options.moveTolerancePx) {
        out.push({ kind: 'resized', locator, baseline: entry, candidate: other, sizeDelta: { w: Math.round(dw), h: Math.round(dh) } })
      }
    }
    if (!options.detectMoves) continue
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
