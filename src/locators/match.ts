import { area, coverage, iou } from '../core/geometry.ts'
import type { Box, ElementMap, ElementMapEntry, LocatorStrategy } from '../core/types.ts'

export interface ElementRef {
  locator: string
  name: string
  strategy: LocatorStrategy
  tag: string
  box: Box
  /** Fraction of the region covered by this element. */
  coverage: number
  iou: number
}

export interface MatchOptions {
  coverMin: number
  iouMin: number
  touchMin: number
  maxPerRegion: number
  preferStrategies: readonly LocatorStrategy[]
}

export interface ElementMatch {
  /** The element that owns the region: smallest one covering it, else best overlap. */
  owner: ElementRef | null
  /** Every element touching the region, smallest first, owner included. */
  all: ElementRef[]
}

function toRef(e: ElementMapEntry, cov: number, overlap: number): ElementRef {
  return { locator: e.locator, name: e.name, strategy: e.strategy, tag: e.tag, box: e.box, coverage: cov, iou: overlap }
}

/** Match one region box against every element of a map. */
export function matchElements(box: Box, map: ElementMap, options: MatchOptions): ElementMatch {
  const rank = (s: LocatorStrategy): number => {
    const i = options.preferStrategies.indexOf(s)
    return i === -1 ? options.preferStrategies.length : i
  }
  const touching: ElementRef[] = []
  for (const e of map.elements) {
    const cov = coverage(box, e.box)
    if (cov <= 0) continue
    touching.push(toRef(e, cov, iou(box, e.box)))
  }
  const byArea = (a: ElementRef, b: ElementRef) => area(a.box) - area(b.box) || rank(a.strategy) - rank(b.strategy)
  const covering = touching.filter((r) => r.coverage >= options.coverMin).sort(byArea)
  let owner = covering[0] ?? null
  if (!owner) {
    const overlapping = touching.filter((r) => r.iou >= options.iouMin).sort((a, b) => b.iou - a.iou || rank(a.strategy) - rank(b.strategy))
    owner = overlapping[0] ?? null
  }
  const all = touching.filter((r) => r.coverage >= options.touchMin || r === owner).sort(byArea)
  if (owner && !all.includes(owner)) all.unshift(owner)
  return { owner, all: all.slice(0, options.maxPerRegion) }
}
