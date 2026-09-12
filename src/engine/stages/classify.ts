/**
 * Move detection: a removed region whose pixels reappear somewhere in the
 * candidate, or a changed region whose baseline content is found at another
 * position, is reported once as `moved` instead of as two changes.
 */
import { centre, expand } from '../../core/geometry.ts'
import type { Box } from '../../core/types.ts'
import type { Mat } from '../cv/cv-types.ts'
import { clipToMat, roi } from '../cv/ops.ts'
import type { ClassifyOutput, DiffOutput, WorkingRegion } from '../model.ts'
import type { Stage, StageContext } from '../stage.ts'

const MAX_TEMPLATE_SIDE = 256
const MIN_TEMPLATE_SIDE = 4
const MIN_TEMPLATE_STD = 4
const MIN_SELF_SEARCH_SIDE = 32
const MAX_SELF_SEARCH_AREA = 2_000_000
const MIN_MOVE_DISTANCE = 4
const MAX_NCC_AT_ORIGIN = 0.6
const SIZE_TOLERANCE = 0.15

interface Match {
  value: number
  box: Box
}

function templateMatch(ctx: StageContext, image: Mat, templateBox: Box, search: Mat, searchBox: Box): Match | null {
  const { cv, mats } = ctx
  const tb = clipToMat(templateBox, image)
  const sb = clipToMat(searchBox, search)
  if (!tb || !sb || tb.w < MIN_TEMPLATE_SIDE || tb.h < MIN_TEMPLATE_SIDE || sb.w < tb.w || sb.h < tb.h) return null
  const tpl = roi(ctx, image, tb)
  const area = roi(ctx, search, sb)
  const mean = mats.mat()
  const std = mats.mat()
  const noMask = mats.mat()
  cv.meanStdDev(tpl, mean, std, noMask)
  const sd = std.data64F[0]!
  mats.release(mean)
  mats.release(std)
  if (sd < MIN_TEMPLATE_STD) {
    for (const m of [tpl, area, noMask]) mats.release(m)
    return null
  }
  let tplUsed = tpl
  let areaUsed = area
  let f = 1
  const maxSide = Math.max(tb.w, tb.h)
  if (maxSide > MAX_TEMPLATE_SIDE) {
    f = MAX_TEMPLATE_SIDE / maxSide
    tplUsed = mats.mat()
    areaUsed = mats.mat()
    cv.resize(tpl, tplUsed, new cv.Size(Math.max(1, Math.round(tb.w * f)), Math.max(1, Math.round(tb.h * f))), 0, 0, cv.INTER_AREA)
    cv.resize(area, areaUsed, new cv.Size(Math.max(1, Math.round(sb.w * f)), Math.max(1, Math.round(sb.h * f))), 0, 0, cv.INTER_AREA)
  }
  let match: Match | null = null
  if (areaUsed.cols >= tplUsed.cols && areaUsed.rows >= tplUsed.rows) {
    const result = mats.mat()
    cv.matchTemplate(areaUsed, tplUsed, result, cv.TM_CCOEFF_NORMED, noMask)
    const { maxVal, maxLoc } = cv.minMaxLoc(result, noMask)
    match = { value: maxVal, box: { x: Math.round(sb.x + maxLoc.x / f), y: Math.round(sb.y + maxLoc.y / f), w: tb.w, h: tb.h } }
    mats.release(result)
  }
  for (const m of new Set([tpl, area, tplUsed, areaUsed, noMask])) mats.release(m)
  return match
}

function similarSize(a: Box, b: Box): boolean {
  return Math.abs(a.w - b.w) <= SIZE_TOLERANCE * Math.max(a.w, b.w) && Math.abs(a.h - b.h) <= SIZE_TOLERANCE * Math.max(a.h, b.h)
}

const area = (b: Box) => b.w * b.h

export const classifyStage: Stage<DiffOutput, ClassifyOutput> = {
  name: 'classify',
  run(input, ctx) {
    const md = ctx.options.moveDetection
    const regions = input.regions.map((r) => ({ ...r, tags: [...r.tags] }))
    if (!md.enabled) return { ...input, classified: regions }
    const B = input.baseline
    const W = input.warped
    const pad = W.padTop
    const toCanvas = (b: Box): Box => ({ ...b, y: b.y + pad })
    const fromCanvas = (b: Box): Box => ({ ...b, y: b.y - pad })
    const consumed = new Set<WorkingRegion>()
    const moved: WorkingRegion[] = []
    let budget = md.maxCandidates
    let capped = false

    const removed = regions.filter((r) => r.kind === 'removed' && !r.tags.includes('whitespace-only'))
    const added = regions.filter((r) => r.kind === 'added' && !r.tags.includes('whitespace-only'))
    const pairs: Array<[WorkingRegion, WorkingRegion]> = []
    for (const r of removed) for (const a of added) if (similarSize(r.boxBaseline!, a.boxWarped!)) pairs.push([r, a])
    pairs.sort((p, q) => area(q[0].boxBaseline!) - area(p[0].boxBaseline!))
    for (const [r, a] of pairs) {
      if (consumed.has(r) || consumed.has(a)) continue
      if (budget-- <= 0) {
        capped = true
        break
      }
      const search = toCanvas(expand(a.boxWarped!, Math.round(0.5 * Math.max(a.boxWarped!.w, a.boxWarped!.h))))
      const m = ctx.time('moveSearch', () => templateMatch(ctx, B.gray, r.boxBaseline!, W.gray, search))
      if (m && m.value >= md.minNcc) {
        moved.push({
          kind: 'moved',
          boxBaseline: r.boxBaseline,
          boxWarped: fromCanvas(m.box),
          pixelsChanged: r.pixelsChanged,
          areaFraction: 1,
          meanDelta: 0,
          score: 0.3 * r.score,
          confidence: m.value,
          ...(r.band !== undefined ? { band: r.band } : {}),
          tags: ['moved-section'],
        })
        consumed.add(r)
        consumed.add(a)
      }
    }

    const changed = regions
      .filter((r) => r.kind === 'changed' && r.boxBaseline!.w >= MIN_SELF_SEARCH_SIDE && r.boxBaseline!.h >= MIN_SELF_SEARCH_SIDE)
      .sort((p, q) => area(q.boxBaseline!) - area(p.boxBaseline!))
    const whole = W.width * W.height <= MAX_SELF_SEARCH_AREA
    for (const c of changed) {
      if (capped) break
      if (budget-- <= 0) {
        capped = true
        break
      }
      const box = c.boxBaseline!
      const search = whole ? { x: 0, y: 0, w: W.width, h: W.height } : toCanvas(expand(c.boxWarped!, 2 * Math.max(box.w, box.h)))
      const m = ctx.time('moveSearch', () => templateMatch(ctx, B.gray, box, W.gray, search))
      if (!m || m.value < md.minNcc) continue
      const found = fromCanvas(m.box)
      const from = centre(c.boxWarped!)
      const to = centre(found)
      if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_MOVE_DISTANCE) continue
      const atOrigin = ctx.time('moveSearch', () => templateMatch(ctx, B.gray, box, W.gray, toCanvas(c.boxWarped!)))
      if (atOrigin && atOrigin.value >= MAX_NCC_AT_ORIGIN) continue
      moved.push({
        kind: 'moved',
        boxBaseline: box,
        boxWarped: found,
        pixelsChanged: c.pixelsChanged,
        areaFraction: c.areaFraction,
        meanDelta: c.meanDelta,
        score: 0.3 * c.score,
        confidence: m.value,
        ...(c.band !== undefined ? { band: c.band } : {}),
        tags: ['moved-block'],
      })
      consumed.add(c)
    }
    if (capped) ctx.warn('MOVE_SEARCH_CAPPED', `move detection stopped after ${md.maxCandidates} candidates`, { maxCandidates: md.maxCandidates })
    return { ...input, classified: [...regions.filter((r) => !consumed.has(r)), ...moved] }
  },
}
