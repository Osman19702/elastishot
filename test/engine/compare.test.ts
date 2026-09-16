import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { isElastishotError } from '../../src/core/errors.ts'
import { iou } from '../../src/core/geometry.ts'
import { cloneImage, createImage, fillRect } from '../../src/core/image.ts'
import type { Box, CompareResult, DiffRegion, RasterImage, RegionKind } from '../../src/core/types.ts'
import { addNoise, collapseRows, createPage, insertBlankRows, insertRows, moveBlock, padTo, recolor, scaleImage, shiftImage, strokeChange, glyphSpot } from '../fixtures/synth.ts'
import { engine } from '../support/cv.ts'

before(() => engine.warmup())

const page = createPage({ seed: 3, sections: 4 })
const base = page.image
const sections = page.manifest.sections
const GAP = 24

const ofKind = (r: CompareResult, kind: RegionKind, minScore = 0.05): DiffRegion[] =>
  r.regions.filter((x) => x.kind === kind && x.score >= minScore)
const covers = (box: Box | null, target: Box, min = 0.5): boolean => box !== null && iou(box, target) >= min
const describe = (r: CompareResult): string =>
  `${r.summary.alignMethod} sim=${r.summary.similarity.toFixed(3)} ` +
  r.regions.map((x) => `${x.id}:${x.kind}@${JSON.stringify(x.boxBaseline ?? x.anchorBaseline)}(${x.score.toFixed(2)})`).join(' ') +
  ` warnings=${r.summary.warnings.map((w) => w.code).join(',')}`

test('identical images: no regions, similarity 1, pass', async () => {
  const r = await engine.compare(base, base)
  assert.equal(r.regions.length, 0, describe(r))
  assert.ok(r.summary.similarity > 0.99)
  assert.equal(r.summary.passed, true)
  assert.equal(r.summary.counts.changed, 0)
  assert.ok(['features-similarity', 'identity'].includes(r.summary.alignMethod))
  assert.ok(r.artifacts.diffMask)
  assert.equal(r.artifacts.diffMask!.width, base.width)
})

test('recoloured title: one changed region on the title', async () => {
  const title = sections[1]!.title
  const r = await engine.compare(base, recolor(base, title, [220, 38, 38, 255]))
  const changed = ofKind(r, 'changed')
  assert.equal(changed.length, 1, describe(r))
  assert.ok(covers(changed[0]!.boxBaseline, title, 0.6), describe(r))
  assert.ok(covers(changed[0]!.boxCandidate, title, 0.6), describe(r))
  assert.equal(r.summary.passed, false)
  assert.equal(r.regions[0]!.id, 'r1')
})

test('zoomed candidate (1.25x): aligned, no meaningful regions', async () => {
  const r = await engine.compare(base, scaleImage(base, 1.25))
  assert.equal(r.summary.alignMethod, 'features-similarity', describe(r))
  assert.ok(Math.abs(r.alignment.scale - 0.8) < 0.02, `scale ${r.alignment.scale}`)
  assert.ok(r.regions.every((x) => x.score < 0.2), describe(r))
  assert.ok(r.summary.similarity > 0.97, describe(r))
})

test('collapsed section: one removed region, nothing spurious below', async () => {
  const s = sections[1]!
  const candidate = collapseRows(base, s.box.y, s.box.y + s.box.h + GAP)
  const r = await engine.compare(base, candidate)
  const removed = ofKind(r, 'removed')
  assert.ok(removed.length >= 1, describe(r))
  assert.ok(removed.some((x) => covers(x.boxBaseline, s.box, 0.6)), describe(r))
  assert.equal(ofKind(r, 'changed', 0.1).length, 0, describe(r))
  assert.equal(ofKind(r, 'added').length, 0, describe(r))
  assert.ok(r.summary.structural.deletedRows >= s.box.h * 0.8, describe(r))
})

test('inserted section: one added region with an anchor at the insertion row', async () => {
  // a block unlike any existing section, so the alignment has one right answer
  const block = createImage(base.width, 160, [255, 255, 255, 255])
  fillRect(block, { x: 24, y: 12, w: base.width - 48, h: 136 }, [254, 226, 226, 255])
  fillRect(block, { x: 60, y: 40, w: 300, h: 24, }, [153, 27, 27, 255])
  for (let i = 0; i < 5; i++) fillRect(block, { x: 60 + i * 130, y: 90, w: 90, h: 40 }, [220, 38, 38, 255])
  const at = sections[0]!.box.y + sections[0]!.box.h + GAP / 2
  const r = await engine.compare(base, insertRows(base, at, block))
  const added = ofKind(r, 'added')
  assert.ok(added.length >= 1, describe(r))
  const big = added.sort((a, b) => b.score - a.score)[0]!
  assert.ok(Math.abs(big.anchorBaseline!.y - at) <= 40, describe(r))
  assert.ok(big.boxCandidate && big.boxCandidate.y >= at - 40 && big.boxCandidate.y + big.boxCandidate.h <= at + block.height + 40, describe(r))
  assert.equal(ofKind(r, 'changed', 0.1).length, 0, describe(r))
  assert.equal(ofKind(r, 'removed').length, 0, describe(r))
})

test('collapse plus a change below it: removed and changed', async () => {
  const s = sections[1]!
  const below = sections[3]!.title
  const candidate = collapseRows(recolor(base, below, [16, 185, 129, 255]), s.box.y, s.box.y + s.box.h + GAP)
  const r = await engine.compare(base, candidate)
  assert.ok(ofKind(r, 'removed').some((x) => covers(x.boxBaseline, s.box, 0.6)), describe(r))
  const changed = ofKind(r, 'changed')
  assert.equal(changed.length, 1, describe(r))
  assert.ok(covers(changed[0]!.boxBaseline, below, 0.6), describe(r))
})

test('mixed dimensions: a 320x320 crop of the page shrunk to 40%', async () => {
  const candidate = padTo(scaleImage(base, 0.4), 320, 320)
  const r = await engine.compare(base, candidate)
  assert.equal(r.summary.alignMethod, 'features-similarity', describe(r))
  assert.ok(Math.abs(r.alignment.scale - 2.5) < 0.1, `scale ${r.alignment.scale}`)
  const visibleHeight = 320 / 0.4
  const spurious = ofKind(r, 'changed', 0.2).filter((x) => x.boxBaseline!.y + x.boxBaseline!.h <= visibleHeight - 8)
  assert.equal(spurious.length, 0, describe(r))
  // the rows the crop does not show are unknown, not removed
  assert.ok(r.summary.warnings.some((w) => w.code === 'PARTIAL_COVERAGE'), describe(r))
  assert.equal(ofKind(r, 'removed').length, 0, describe(r))
})

test('a shifted candidate passes: rows outside its field of view are not compared', async () => {
  const r = await engine.compare(base, shiftImage(base, 17, -9))
  assert.equal(r.regions.length, 0, describe(r))
  assert.equal(r.summary.passed, true)
  assert.ok(r.summary.warnings.some((w) => w.code === 'PARTIAL_COVERAGE'), describe(r))
})

test('moved block: reported once as moved', async () => {
  const s = sections[1]!
  const from = { x: s.box.x + 16, y: s.lines[0]!.y, w: 160, h: 60 }
  const r = await engine.compare(base, moveBlock(base, from, { x: from.x + 320, y: from.y }, [249, 250, 251, 255]))
  const moved = ofKind(r, 'moved', 0)
  assert.ok(moved.length >= 1, describe(r))
  assert.ok(moved.some((x) => covers(x.boxBaseline, from, 0.5) && x.confidence >= 0.9), describe(r))
})

test('flat images fall back without throwing', async () => {
  const a = createImage(400, 300)
  const b = createImage(400, 310)
  fillRect(b, { x: 10, y: 10, w: 100, h: 3 }, [0, 0, 0, 255])
  const r = await engine.compare(a, b)
  assert.ok(['projection', 'resize'].includes(r.summary.alignMethod), describe(r))
  assert.ok(r.summary.warnings.some((w) => w.code.startsWith('ALIGN_')), describe(r))
  assert.ok(r.summary.similarity < 1)
})

test('noise below the threshold produces no regions', async () => {
  const r = await engine.compare(base, addNoise(base, 6))
  assert.equal(r.regions.length, 0, describe(r))
  assert.equal(r.summary.passed, true)
})

test('ignoreRegions suppresses a change inside the box', async () => {
  const title = sections[1]!.title
  const candidate = recolor(base, title, [220, 38, 38, 255])
  const r = await engine.compare(base, candidate, { ignoreRegions: [title] })
  assert.equal(r.regions.length, 0, describe(r))
  const r2 = await engine.compare(base, candidate, { ignoreRegionsCandidate: [title] })
  assert.equal(r2.regions.length, 0, describe(r2))
})

test('too many regions are merged and capped with a warning', async () => {
  const candidate = cloneImage(base)
  for (let y = 60; y < base.height - 60; y += 64) for (let x = 24; x < base.width - 24; x += 64) fillRect(candidate, { x, y, w: 20, h: 20 }, [0, 0, 0, 255])
  const r = await engine.compare(base, candidate, { diff: { maxRegions: 10 } })
  assert.ok(r.regions.length <= 10, describe(r))
  assert.ok(r.summary.warnings.some((w) => w.code === 'DIFF_TOO_MANY_REGIONS'), describe(r))
})

test('abort signal rejects with E_ABORTED', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(engine.compare(base, base, { signal: controller.signal }), (e: unknown) => isElastishotError(e, 'E_ABORTED'))
})

test('alignMode none compares pixel for pixel', async () => {
  const title = sections[0]!.title
  const r = await engine.compare(base, recolor(base, title, [255, 200, 0, 255]), { alignMode: 'none', structural: { enabled: false } })
  assert.equal(r.summary.alignMethod, 'identity')
  assert.equal(ofKind(r, 'changed').length, 1, describe(r))
})

test('artifacts can be requested', async () => {
  const r = await engine.compare(base, scaleImage(base, 0.9), { artifacts: { overlay: true, warpedCandidate: true, candidateOverlay: true } })
  assert.equal(r.artifacts.overlay!.width, base.width)
  assert.equal(r.artifacts.warpedCandidate!.width, base.width)
  assert.equal(r.artifacts.candidateOverlay!.width, Math.round(base.width * 0.9))
  assert.ok(r.summary.timingsMs.globalAlign! > 0)
})

test('content added at the very top of the page is reported', async () => {
  const banner = createImage(base.width, 72, [255, 247, 237, 255])
  fillRect(banner, { x: 24, y: 24, w: 400, h: 24 }, [194, 65, 12, 255])
  const r = await engine.compare(base, insertRows(base, 0, banner))
  const added = ofKind(r, 'added')
  assert.ok(added.length >= 1, describe(r))
  const top = added.sort((a, b) => b.score - a.score)[0]!
  assert.ok(top.boxCandidate && top.boxCandidate.y <= 24 && top.boxCandidate.h >= 30, describe(r))
  assert.ok(top.anchorBaseline!.y <= 8, describe(r))
  assert.equal(ofKind(r, 'changed', 0.1).length, 0, describe(r))
  assert.equal(ofKind(r, 'removed').length, 0, describe(r))
})

test('a one-pixel stroke change (one digit in small text) is reported', async () => {
  const s = sections[1]!
  const at = glyphSpot(s)
  const r = await engine.compare(base, strokeChange(base, at))
  const changed = ofKind(r, 'changed')
  assert.equal(changed.length, 1, describe(r))
  assert.ok(covers(changed[0]!.boxBaseline, { x: at.x, y: at.y, w: 7, h: 9 }, 0.3), describe(r))
  assert.equal(r.summary.passed, false, describe(r))
})

test('a one-pixel stroke change is still reported when the page moved down by whole pixels', async () => {
  const s = sections[1]!
  const at = glyphSpot(s)
  const r = await engine.compare(base, insertBlankRows(strokeChange(base, at), 0, 44))
  assert.equal(r.summary.alignMethod, 'features-similarity', describe(r))
  assert.equal(ofKind(r, 'changed').length, 1, describe(r))
})

test('a block that changed its look entirely does not make the rest of the page "removed"', async () => {
  // A dark theme on one card plus a taller header: the strips of that card
  // match nothing, but everything else still lines up on the global alignment.
  const s = sections[1]!
  const dark = recolor(base, s.box, [31, 41, 55, 255])
  const r = await engine.compare(base, insertBlankRows(dark, 0, 40, [31, 41, 55, 255]))
  const others = [sections[0]!, sections[2]!, sections[3]!]
  const removedOthers = ofKind(r, 'removed').filter((x) => others.some((o) => covers(x.boxBaseline, o.box, 0.5)))
  assert.equal(removedOthers.length, 0, describe(r))
  assert.ok(r.summary.structural.matchedRows >= base.height * 0.6, describe(r))
  assert.ok(ofKind(r, 'changed').some((x) => covers(x.boxBaseline, s.box, 0.5)), describe(r))
})

test('a few rows of extra padding do not become an added region', async () => {
  const s = sections[1]!
  const r = await engine.compare(base, insertBlankRows(base, s.box.y + s.box.h + GAP / 2, 8))
  assert.equal(ofKind(r, 'added').length, 0, describe(r))
  assert.equal(ofKind(r, 'changed', 0.1).length, 0, describe(r))
  assert.ok(r.summary.similarity > 0.98, describe(r))
})

test('an insertion that is not a whole number of strips keeps every row below it exact', async () => {
  // 34 rows: strips are 8 px, so below the block no candidate strip lines up
  // with a baseline strip, and only the rows themselves can settle the pairing.
  const block = createImage(base.width, 34, [255, 255, 255, 255])
  fillRect(block, { x: 24, y: 6, w: base.width - 48, h: 22 }, [254, 226, 226, 255])
  fillRect(block, { x: 40, y: 12, w: 220, h: 10 }, [153, 27, 27, 255])
  const at = sections[1]!.box.y + sections[1]!.box.h + GAP / 2
  const r = await engine.compare(base, insertRows(base, at, block))
  const added = ofKind(r, 'added')
  assert.equal(added.length, 1, describe(r))
  // The block starts with six blank rows, interchangeable with the padding it lands in: the anchor sits where the visible rows begin.
  assert.ok(added[0]!.anchorBaseline!.y >= at - 2 && added[0]!.anchorBaseline!.y <= at + 8, describe(r))
  assert.equal(ofKind(r, 'changed', 0.1).length, 0, describe(r))
  assert.equal(ofKind(r, 'removed').length, 0, describe(r))
  assert.equal(r.summary.structural.insertedRows, 34, describe(r))
})

test('rows appended after look-alike rows are one added region after them, not a shift of the block', async () => {
  // A changelog: rows of one shape whose only difference is where a word sits.
  const row = (mark: number): RasterImage => {
    const img = createImage(base.width, 28, [255, 255, 255, 255])
    fillRect(img, { x: 24, y: 0, w: base.width - 48, h: 27 }, [249, 250, 251, 255])
    fillRect(img, { x: 40, y: 9, w: 60, h: 10 }, [75, 85, 99, 255])
    fillRect(img, { x: 130 + mark * 37, y: 9, w: 80, h: 10 }, [75, 85, 99, 255])
    return img
  }
  const table = (marks: number[]): RasterImage => marks.slice(1).reduce((acc, m) => insertRows(acc, acc.height, row(m)), row(marks[0]!))
  const at = sections[2]!.box.y + sections[2]!.box.h + GAP / 2
  const baseline = insertRows(base, at, table([0, 1, 2, 3]))
  const candidate = insertRows(base, at, table([0, 1, 2, 3, 4, 5, 6]))
  const r = await engine.compare(baseline, candidate)
  const added = ofKind(r, 'added')
  assert.equal(added.length, 1, describe(r))
  const appendedAt = at + 4 * 28
  assert.ok(Math.abs(added[0]!.anchorBaseline!.y - appendedAt) <= 2, describe(r))
  assert.ok(added[0]!.boxCandidate && Math.abs(added[0]!.boxCandidate.h - 3 * 28) <= 4, describe(r))
  assert.equal(ofKind(r, 'changed', 0.1).length, 0, describe(r))
  assert.equal(ofKind(r, 'removed').length, 0, describe(r))
})

test('two side-by-side columns: the left one gains a line, the right one is compared in place', async () => {
  // A card with two text columns. The candidate inserts a line at the top of
  // the left column and grows the card by that much; the right column keeps
  // its rows. Row alignment alone cannot pair both columns at once.
  const W = 800
  const LINE = 22
  const draw = (leftLines: number[], rightLines: number[]): RasterImage => {
    const cardH = 40 + Math.max(leftLines.length, rightLines.length) * LINE + 40
    const img = createImage(W, 96 + cardH + 48 + 48 + 40, [255, 255, 255, 255])
    fillRect(img, { x: 0, y: 0, w: W, h: 56 }, [31, 41, 55, 255])
    fillRect(img, { x: 24, y: 16, w: 120, h: 24 }, [37, 99, 235, 255])
    fillRect(img, { x: 24, y: 96, w: W - 48, h: cardH }, [249, 250, 251, 255])
    leftLines.forEach((wd, i) => fillRect(img, { x: 48, y: 136 + i * LINE, w: wd, h: 10 }, [55, 65, 81, 255]))
    rightLines.forEach((wd, i) => fillRect(img, { x: 430, y: 136 + i * LINE, w: wd, h: 10 }, [55, 65, 81, 255]))
    fillRect(img, { x: 0, y: 96 + cardH + 48, w: W, h: 48 }, [229, 231, 235, 255])
    fillRect(img, { x: 24, y: 96 + cardH + 64, w: 200, h: 12 }, [107, 114, 128, 255])
    return img
  }
  const left = [300, 260, 320, 240, 290, 310]
  const right = [280, 330, 250, 300, 270]
  const baseline = draw(left, right)
  const candidate = draw([180, ...left], right)
  const r = await engine.compare(baseline, candidate)
  const added = ofKind(r, 'added')
  assert.equal(added.length, 1, describe(r))
  assert.ok(added[0]!.boxCandidate && added[0]!.boxCandidate.x < 400 && added[0]!.boxCandidate.y >= 120 && added[0]!.boxCandidate.y <= 160, describe(r))
  assert.equal(ofKind(r, 'changed', 0.1).length, 0, describe(r))
  assert.equal(ofKind(r, 'removed').length, 0, describe(r))
  assert.ok(r.alignment.bandMap.some((b) => b.columns), describe(r))
})
