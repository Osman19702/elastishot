/**
 * elastishot/locators: name the DOM elements behind diff regions.
 *
 * Given the regions of a comparison and the element maps captured with each
 * screenshot, every region is attributed to the smallest element that covers
 * it on each side, and the results are grouped per locator. Elements that
 * exist in only one map are reported as well, with map evidence.
 */
import type { Box, DiffRegion, ElementMap, LocatorStrategy, RegionKind, Transform2D } from '../core/types.ts'
import { indexByLocator } from './element-map.ts'
import { matchElements, type ElementRef } from './match.ts'
import { presenceDiff } from './presence.ts'

export { ELEMENT_MAP_SCHEMA, indexByLocator, isElementMap, isElementMapEntry, parseElementMap } from './element-map.ts'
export { matchElements, type ElementMatch, type ElementRef } from './match.ts'
export { presenceDiff, type PresenceChange, type PresenceKind } from './presence.ts'

export interface LocatorOptions {
  /** An element must cover at least this fraction of a region to own it (default 0.6). */
  coverMin?: number
  /** Otherwise the best overlap owns it when its IoU reaches this (default 0.3). */
  iouMin?: number
  /** Elements covering at least this fraction are listed as touching (default 0.1). */
  touchMin?: number
  maxPerRegion?: number
  /** Map-only moves below this distance are ignored (default 4). */
  moveTolerancePx?: number
  /** Tie-break order for owners (default testid, id, role, css). */
  preferStrategies?: LocatorStrategy[]
  /** Also report elements present in both maps whose position moved (default false). */
  mapMoves?: boolean
  /** Candidate pixels -> baseline pixels, for the map-vs-map move check. */
  transform?: Transform2D
}

export type Presence = 'both' | 'baseline-only' | 'candidate-only' | 'unknown'
export type Evidence = 'pixels' | 'map'
export type MapCoverage = 'both' | 'baseline' | 'candidate' | 'none'

export interface LocatorSide {
  box: Box
  name: string
  tag: string
}

export interface ChangedLocator {
  locator: string
  name: string
  strategy: LocatorStrategy
  kinds: RegionKind[]
  /** Ids of the diff regions attributed to this element. */
  regions: string[]
  presence: Presence
  evidence: Evidence[]
  /** Highest score among the attributed regions; 0 for map-only entries. */
  score: number
  sideBaseline?: LocatorSide
  sideCandidate?: LocatorSide
}

export interface RegionLocators {
  regionId: string
  kind: RegionKind
  baseline: ElementRef | null
  candidate: ElementRef | null
  all: ElementRef[]
}

export interface LocatorReport {
  coverage: MapCoverage
  changedLocators: ChangedLocator[]
  byRegion: RegionLocators[]
  /** Regions that no element owns on any side that has a map. */
  unmapped: string[]
  warnings: string[]
}

export interface LocatorMaps {
  baseline?: ElementMap | null
  candidate?: ElementMap | null
}

const DEFAULTS = {
  coverMin: 0.6,
  iouMin: 0.3,
  touchMin: 0.1,
  maxPerRegion: 5,
  moveTolerancePx: 4,
  preferStrategies: ['testid', 'id', 'role', 'css'] as LocatorStrategy[],
  mapMoves: false,
}

const KIND_ORDER: Record<RegionKind, number> = { removed: 0, added: 1, changed: 2, moved: 3 }

export function mapLocators(regions: readonly DiffRegion[], maps: LocatorMaps, options: LocatorOptions = {}): LocatorReport {
  const opts = { ...DEFAULTS }
  for (const [k, v] of Object.entries(options)) if (v !== undefined && k !== 'transform') (opts as Record<string, unknown>)[k] = v
  const baseline = maps.baseline ?? null
  const candidate = maps.candidate ?? null
  const coverage: MapCoverage = baseline && candidate ? 'both' : baseline ? 'baseline' : candidate ? 'candidate' : 'none'
  const warnings: string[] = []
  if (coverage === 'none') warnings.push('no element maps were supplied, so regions cannot be named')
  if (baseline?.truncated) warnings.push('the baseline element map was truncated; some elements are missing')
  if (candidate?.truncated) warnings.push('the candidate element map was truncated; some elements are missing')

  const inBaseline = baseline ? indexByLocator(baseline) : null
  const inCandidate = candidate ? indexByLocator(candidate) : null
  const presenceOf = (locator: string): Presence => {
    if (!inBaseline || !inCandidate) return 'unknown'
    const b = inBaseline.has(locator)
    const c = inCandidate.has(locator)
    return b && c ? 'both' : b ? 'baseline-only' : 'candidate-only'
  }

  const entries = new Map<string, ChangedLocator>()
  const entryFor = (locator: string, name: string, strategy: LocatorStrategy): ChangedLocator => {
    let e = entries.get(locator)
    if (!e) {
      e = { locator, name, strategy, kinds: [], regions: [], presence: presenceOf(locator), evidence: [], score: 0 }
      entries.set(locator, e)
    }
    return e
  }
  const addKind = (e: ChangedLocator, kind: RegionKind) => {
    if (!e.kinds.includes(kind)) e.kinds.push(kind)
  }
  const addEvidence = (e: ChangedLocator, ev: Evidence) => {
    if (!e.evidence.includes(ev)) e.evidence.push(ev)
  }
  const attribute = (ref: ElementRef, side: 'baseline' | 'candidate', region: DiffRegion) => {
    const e = entryFor(ref.locator, ref.name, ref.strategy)
    addKind(e, region.kind)
    if (!e.regions.includes(region.id)) e.regions.push(region.id)
    addEvidence(e, 'pixels')
    e.score = Math.max(e.score, region.score)
    const sideInfo: LocatorSide = { box: ref.box, name: ref.name, tag: ref.tag }
    if (side === 'baseline') e.sideBaseline ??= sideInfo
    else e.sideCandidate ??= sideInfo
  }

  const byRegion: RegionLocators[] = []
  const unmapped: string[] = []
  for (const r of regions) {
    const b = baseline && r.boxBaseline ? matchElements(r.boxBaseline, baseline, opts) : null
    const c = candidate && r.boxCandidate ? matchElements(r.boxCandidate, candidate, opts) : null
    const seen = new Set<string>()
    const all: ElementRef[] = []
    for (const ref of [...(b?.all ?? []), ...(c?.all ?? [])]) {
      if (seen.has(ref.locator)) continue
      seen.add(ref.locator)
      all.push(ref)
    }
    byRegion.push({ regionId: r.id, kind: r.kind, baseline: b?.owner ?? null, candidate: c?.owner ?? null, all: all.slice(0, opts.maxPerRegion) })
    if (b?.owner) attribute(b.owner, 'baseline', r)
    if (c?.owner) attribute(c.owner, 'candidate', r)
    if (coverage !== 'none' && !b?.owner && !c?.owner) unmapped.push(r.id)
  }

  if (baseline && candidate) {
    const changes = presenceDiff(baseline, candidate, {
      moveTolerancePx: opts.moveTolerancePx,
      detectMoves: opts.mapMoves,
      ...(options.transform ? { transform: options.transform } : {}),
    })
    for (const change of changes) {
      const entry = change.baseline ?? change.candidate!
      const e = entryFor(change.locator, entry.name, entry.strategy)
      addKind(e, change.kind)
      addEvidence(e, 'map')
      if (change.baseline) e.sideBaseline ??= { box: change.baseline.box, name: change.baseline.name, tag: change.baseline.tag }
      if (change.candidate) e.sideCandidate ??= { box: change.candidate.box, name: change.candidate.name, tag: change.candidate.tag }
    }
  }

  const changedLocators = [...entries.values()].sort((a, b) => {
    const ap = a.evidence.includes('pixels') ? 0 : 1
    const bp = b.evidence.includes('pixels') ? 0 : 1
    if (ap !== bp) return ap - bp
    if (ap === 0 && a.score !== b.score) return b.score - a.score
    const ak = Math.min(...a.kinds.map((k) => KIND_ORDER[k]))
    const bk = Math.min(...b.kinds.map((k) => KIND_ORDER[k]))
    return ak - bk || a.locator.localeCompare(b.locator)
  })
  return { coverage, changedLocators, byRegion, unmapped, warnings }
}
