import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { before, test } from 'node:test'

import { isElastishotError } from '../../src/core/errors.ts'
import { iou } from '../../src/core/geometry.ts'
import { columnModes, rowsAround } from '../../src/core/column-modes.ts'
import { cloneImage, createImage, cropImage, fillRect, imagesEqual } from '../../src/core/image.ts'
import { readImageFile } from '../../src/node/io.ts'
import type { Box, CompareResult, DiffRegion, RasterImage, RegionKind } from '../../src/core/types.ts'
import { COLUMNS_LINE, COLUMNS_PAIRS, addNoise, collapseRows, columnChanges, createColumnsPage, createPage, insertBlankRows, insertRows, moveBlock, padTo, recolor, scaleImage, shiftImage, strokeChange, glyphSpot, type ColumnsPair } from '../fixtures/synth.ts'
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

test('a block that slid up while the page kept its height: it is not compared in place', async () => {
  // The blank gap above section 2 loses 40 rows and the gap below it gains
  // them back, so only that section moved and the page is exactly as tall as
  // before. The strips describe that as a deletion, a matched band at another
  // offset and an insertion: a detour, and here a true one, because the rows
  // pair exactly where it says and nowhere else. A map that folded every such
  // detour to keep its two neighbours in one band would compare the section
  // against the rows it no longer occupies and report it changed in place.
  const s = sections[2]!
  const slide = 40
  const above = s.box.y - GAP / 2
  const below = s.box.y + s.box.h + GAP / 2
  const candidate = insertBlankRows(collapseRows(base, above, above + slide), below - slide, slide)
  assert.equal(candidate.height, base.height)
  const r = await engine.compare(base, candidate)
  assert.ok(
    r.alignment.bandMap.some((b) => b.kind === 'matched' && b.offset === -slide),
    describe(r),
  )
  assert.ok(!ofKind(r, 'changed').some((x) => covers(x.boxBaseline, s.box, 0.3)), describe(r))
  assert.ok(r.summary.similarity > 0.95, describe(r))
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

test('the gaps image has one row per gap with the colours around it', async () => {
  // 40 white rows inserted in the gap between two sections: one inserted band
  const s0 = page.manifest.sections[0]!
  const at = s0.box.y + s0.box.h + 12
  const candidate = insertBlankRows(base, at, 40)
  const r = await engine.compare(base, candidate, { artifacts: { warpedCandidate: true } })
  const gaps = r.alignment.bandMap.filter((b) => b.kind !== 'matched')
  assert.ok(gaps.length >= 1, JSON.stringify(r.alignment.bandMap))
  const strip = r.artifacts.gapFills!
  assert.ok(strip, 'gapFills')
  assert.equal(strip.height, gaps.length)
  assert.equal(strip.width, Math.round(base.width * r.summary.workingScale.baseline))
  const row = strip.data.subarray(0, strip.width * 4)
  // the page margins are white on every row, so they are white in the fill; the
  // columns through the sections take the card colour, never a line of text
  const px = (x: number) => Array.from(row.subarray(x * 4, x * 4 + 4))
  assert.deepEqual(px(2), [255, 255, 255, 255])
  assert.deepEqual(px(base.width - 3), [255, 255, 255, 255])
  const card = px(s0.box.x + 8)
  assert.ok(card[0]! > 200 && card[3] === 255, JSON.stringify(card))
  const title = px(s0.title.x + 4)
  assert.ok(title.every((v, i) => Math.abs(v - card[i]!) <= 3), JSON.stringify({ title, card }))
  // it is the most common colour of the rows around the gap in the baseline
  assert.deepEqual(row, columnModes(rowsAround(base.data, base.width, 0, base.height, gaps[0]!.baseline.start)))
  // without the warped candidate there is no gaps image
  const plain = await engine.compare(base, candidate)
  assert.equal(plain.artifacts.gapFills, undefined)
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

// The portfolio's project card: a screenshot across the card, two text columns
// below it, a nav rail beside it (see COLUMNS_PAIRS). The columns grow by
// different amounts, so they need a lane each; the screenshot changes in place,
// which once made the rows above the columns unstable as a band, let the
// conflict zone climb over the screenshot to the top of the page, where only
// the gutter before the rail is blank, and left both columns in one lane.
// Every pair is held against the same ground truth, read off the line seeds.
async function compareColumns(which: ColumnsPair): Promise<void> {
  const [a, b] = COLUMNS_PAIRS[which]
  const baseline = createColumnsPage(a)
  const candidate = createColumnsPage(b)
  const m = baseline.manifest
  const left = columnChanges(m.left, candidate.manifest.left, m.pitchLeft)
  const right = columnChanges(m.right, candidate.manifest.right, m.pitchRight)
  const r = await engine.compare(baseline.image, candidate.image)

  const inGutter = (x: number): boolean => x >= m.gutter.start && x <= m.gutter.end
  assert.ok(r.alignment.bandMap.some((band) => band.columns && (inGutter(band.columns.start) || inGutter(band.columns.end))), `no lane boundary in the card's gutter: ${describe(r)}`)
  // A column that grows more than its card leaves fewer rows of padding under it, and the column
  // beside it more: that band holds no content, produces no region and is marked blank, so the
  // viewer can leave it untinted and the report call it levelling instead of a block that went away.
  // Marked exactly when no region cites it, and only ever within a lane.
  r.alignment.bandMap.forEach((band, i) => {
    if (band.kind === 'matched') return
    const reported = r.regions.some((x) => x.band === i)
    assert.equal(band.blank ?? false, band.columns ? !reported : false, `band ${i} ${band.kind} ${JSON.stringify(band.columns)}: ${describe(r)}`)
  })
  // a column that grew lost nothing: a removed region is the row alignment's tangle, not the page
  assert.equal(ofKind(r, 'moved').length, 0, describe(r))
  // and nothing was deleted across the gutter either. Where the paragraphs of the two columns break on
  // different rows, a comparison that keeps them in one lane pairs one stretch at the left column's
  // offset and the next at the right column's, and the rows in between come out as a block deleted from
  // the whole card between two blocks added to it. Deleting rows of one column is legitimate (the
  // control's left column ends higher than it did); deleting rows of both at once is that tangle.
  assert.ok(
    !r.alignment.bandMap.some((band) => band.kind === 'deleted' && (!band.columns || (band.columns.start < m.gutter.start && band.columns.end > m.gutter.end))),
    describe(r),
  )

  const isLeft = (box: Box): boolean => box.x + box.w / 2 < (m.gutter.start + m.gutter.end) / 2
  const sameRows = (box: Box, target: Box): boolean => {
    const shared = Math.min(box.y + box.h, target.y + target.h) - Math.max(box.y, target.y)
    return shared / (box.h + target.h - shared) >= 0.8
  }
  // the new lines are added regions of their own column, where they stand in the candidate
  const added = ofKind(r, 'added').map((x) => x.boxCandidate!)
  // and of one column only: a stripe across the card is the row alignment giving up
  assert.ok(added.every((box) => box.w < m.card.w), describe(r))
  for (const [side, truth] of [[added.filter(isLeft), left], [added.filter((box) => !isLeft(box)), right]] as const) {
    assert.equal(side.length, truth.added.length, describe(r))
    for (const block of truth.added) assert.ok(side.some((box) => sameRows(box, block)), `${JSON.stringify(block)}: ${describe(r)}`)
  }

  // below the screenshot nothing changed but the lines edited in place: one small region
  // each, and none in the left column, whose rows all moved
  const changed = ofKind(r, 'changed').map((x) => x.boxBaseline!)
  const inColumns = changed.filter((box) => box.y >= m.gridY - 4 && box.y < m.card.y + m.card.h)
  assert.equal(inColumns.filter(isLeft).length, left.edited.length, describe(r))
  assert.equal(inColumns.length, left.edited.length + right.edited.length, describe(r))
  for (const line of right.edited) assert.ok(inColumns.some((box) => !isLeft(box) && box.h <= COLUMNS_LINE && sameRows(box, line)), `${JSON.stringify(line)}: ${describe(r)}`)
  // above them the screenshot's own change is reported in place, and only there
  const above = changed.filter((box) => box.y < m.gridY - 4)
  assert.equal(above.length > 0, b.shot === 'b', describe(r))
  assert.ok(above.every((box) => box.y >= m.shot.y && box.y + box.h <= m.shot.y + m.shot.h), describe(r))
  // and below the card only what the candidate redrew there: the second picture, inside its own box
  const under = changed.filter((box) => box.y >= m.card.y + m.card.h)
  assert.equal(under.length > 0, b.belowShot === 'b' || b.belowText === 'b', describe(r))
  if (b.belowShot === 'b') assert.ok(under.every((box) => box.y >= m.belowShot!.y && box.y + box.h <= m.belowShot!.y + m.belowShot!.h), describe(r))
  // the markers of a list move with the lines they mark: none of them is reported,
  // and the added lines of their column reach back over them
  const hits = (box: Box, target: Box): boolean => box.x < target.x + target.w && box.x + box.w > target.x && box.y < target.y + target.h && box.y + box.h > target.y
  for (const marker of m.markers) assert.ok(!changed.some((box) => hits(box, marker)), `${JSON.stringify(marker)} reported as changed: ${describe(r)}`)
  if (m.markers.length) for (const box of added.filter((x) => !isLeft(x))) assert.ok(box.x <= m.markers[0]!.x, describe(r))
}

test('a two-column card under a screenshot that changed in place: each column is compared on its own rows', () => compareColumns('grown'))

test('the same card under an unchanged screenshot, which never failed: the control', () => compareColumns('control'))

test('only the left column grows under the changed screenshot: its lines are added where they stand, not at the bottom of the card', () => compareColumns('leftOnly'))

test('paragraphs that break on different rows in the two columns: no full-width stripes of added and removed rows', () => compareColumns('stripes'))

test('columns of different line pitch under the changed screenshot: a line of one column shares its rows with two of the other', () => compareColumns('pitches'))

test('the same card with no nav rail beside it: the lanes are the columns of the card', () => compareColumns('noRail'))

test('a second picture under the card changed in place as well: the zone ends above it, not at the page foot', () => compareColumns('belowShot'))

// A limitation of the same family as the defect above, reachable and untested until now. The zone still
// reaches down to its gap: with the first line under the card redrawn in place and only blank rows between
// it and the card's foot, the insertion floats past that line, the line falls inside the zone, its rows
// cross the gutter, no tiles form and the columns stay in one lane. The released 0.1.7 reports the same
// thing, so this is not a regression; it is what the fix does not reach. A failing todo is reported as
// todo, so the tier stays green and the limitation is printed in every run.
test('known limitation: the first line under the card changed in place as well, so the insertion floats past it and the columns stay in one lane', { todo: 'the zone reaches down to its gap; same result as 0.1.7' }, () => compareColumns('belowText'))

// A card of plain text, with no screenshot to make the rows above the columns
// inexact. Here it is the card itself that holds the run of exact rows: the
// short column has ended, or both columns are blank for a stretch, and the run
// falls between the two columns' new lines. The cut then makes a stable band of
// it inside one conflict, and the parts it leaves do not add up to the conflict
// - one holds the gap with no substituted rows beside it, the other the
// substituted rows with no gap. laneAlign has to put the conflict back together
// and prove the wider answer on the pixels; without that these pages come out
// as a full-width added stripe over one false changed blob (see widenedZones).
test('a card of plain text whose short column ended: the run of exact rows between the two changes does not lose the lanes', () => compareColumns('noShot'))

test('a card of plain text with a blank stretch across both columns: the run inside the conflict does not move the lanes onto the wrong rows', () => compareColumns('blankStretch'))

test("a list's markers stay with the lines they mark: the lane cut falls in the gutter, not between marker and line", () => compareColumns('markers'))

test('a pane that is empty where the pane beside it gained a row: the row is added in its own pane', () => compareColumns('emptyPane'))

// The same pair, on the one thing the pixel count cannot arbitrate. The run of
// exact rows between the insertion and the left pane's block of text ends the
// conflict zone inside the conflict: the block below the run keeps a zone and
// finds the panes' gutter, the insertion above it is left with no zone at all,
// and the parts therefore report it as rows added across the whole page -
// across a pane whose two captures are the same bytes. exactContentCells cannot
// see that harm. An empty pane carries no content to mis-pair, so laying the
// insertion over it costs the parts nothing, while the wider answer's lane over
// it earns nothing: measured here the parts pair 227 content cells exactly and
// the wider answer 197, a vote of 30 against the right answer. What separates
// them is the shape of the band, not its pixel count, and that is what
// laneAlign's `stripes` term reads. Delete it and this test reports
// `added 74,164 812x22` over a pane where nothing changed.
test('an insertion beside a pane that is empty there is not reported across that pane', async () => {
  const [a, b] = COLUMNS_PAIRS.emptyPane
  const baseline = createColumnsPage(a)
  const candidate = createColumnsPage(b)
  const m = baseline.manifest
  // Ground truth, read off the two pages rather than frozen: every column left
  // of the gutter is the same pixel in both, and the right pane gained one row.
  const pane = { x: 0, y: 0, w: m.gutter.start, h: m.height }
  assert.ok(imagesEqual(cropImage(baseline.image, pane), cropImage(candidate.image, pane)), 'the left pane must be identical in both pages')
  assert.deepEqual(columnChanges(m.left, candidate.manifest.left, m.pitchLeft), { added: [], edited: [] })
  const grew = columnChanges(m.right, candidate.manifest.right, m.pitchRight)
  assert.equal(grew.added.length, 1)

  const r = await engine.compare(baseline.image, candidate.image)
  // No block of rows is reported added or removed across the whole width: that
  // band is the shape the lanes exist to avoid, and on this page it can only lie
  // over the pane that did not change.
  assert.deepEqual(
    r.alignment.bandMap.filter((band) => band.kind !== 'matched' && !band.columns).map((band) => `${band.kind} ${band.baseline.start}-${band.baseline.end}`),
    [],
    describe(r),
  )
  // The lanes are the two panes: a lane boundary stands in the gutter between them.
  assert.ok(
    r.alignment.bandMap.some((band) => band.columns && band.columns.start >= m.gutter.start && band.columns.start <= m.gutter.end),
    describe(r),
  )
  // and the one added region stands in the right pane, on the rows the new line occupies
  const added = ofKind(r, 'added')
  assert.equal(added.length, 1, describe(r))
  const box = added[0]!.boxCandidate!
  assert.ok(box.x >= m.gutter.start, describe(r))
  assert.ok(box.w < m.card.w, describe(r))
  assert.ok(Math.abs(box.y - grew.added[0]!.y) <= 2 && Math.abs(box.h - grew.added[0]!.h) <= 2, describe(r))
  assert.equal(ofKind(r, 'removed').length, 0, describe(r))
  assert.equal(ofKind(r, 'changed', 0.1).length, 0, describe(r))
})

test('the committed columns fixtures are what synth.ts draws now', async () => {
  // A6 compares test/fixtures/images/columns-base.png against columns-grown.png and reads its ground
  // truth from manifest.json; this tier draws COLUMNS_PAIRS.stripes live. Only `npm run fixtures` keeps
  // the two the same case, and no CI job runs it. Pixels, not bytes: a change in zlib or in the PNG
  // writer must not redden this.
  const dir = path.resolve('test/fixtures/images')
  const drawn = COLUMNS_PAIRS.stripes.map((options) => createColumnsPage(options))
  for (const [i, name] of ['columns-base', 'columns-grown'].entries())
    assert.ok(imagesEqual(await readImageFile(path.join(dir, `${name}.png`)), drawn[i]!.image), `${name}.png is stale: run npm run fixtures`)
  const expect = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).cases['columns-grown'].expect
  const m = drawn[0]!.manifest
  assert.deepEqual(expect.left, columnChanges(m.left, drawn[1]!.manifest.left, m.pitchLeft))
  assert.deepEqual(expect.right, columnChanges(m.right, drawn[1]!.manifest.right, m.pitchRight))
  assert.deepEqual(expect.gutter, m.gutter)
  assert.deepEqual(expect.shot, m.shot)
  assert.equal(expect.gridY, m.gridY)
})

test('a screenshot changed in place with a lone insertion far below it: the page is compared full width, not in lanes', async () => {
  // The rows the widened retry must turn down. From the rows alone this page is
  // the same shape as the card above: the screenshot was redrawn in place, so the
  // cut divides the rows over it into runs, and the insertion's gap is orphaned
  // between two of them. Nothing moved sideways, though, so the lanes explain
  // fewer pixels than the full-width rows and the vote keeps the rows.
  const [a] = COLUMNS_PAIRS.grown
  const baseline = createColumnsPage(a)
  const candidate = createColumnsPage({ ...a, shot: 'b' })
  const block = createImage(baseline.image.width, 120, [255, 255, 255, 255])
  fillRect(block, { x: 120, y: 16, w: 700, h: 88 }, [254, 226, 226, 255])
  const at = baseline.manifest.card.y + baseline.manifest.card.h + 120
  const r = await engine.compare(baseline.image, insertRows(candidate.image, at, block))
  assert.equal(r.alignment.bandMap.filter((b) => b.columns).length, 0, describe(r))
  assert.equal(ofKind(r, 'removed').length, 0, describe(r))
  const added = ofKind(r, 'added')
  assert.equal(added.length, 1, describe(r))
  assert.ok(Math.abs(added[0]!.anchorBaseline!.y - at) <= 40, describe(r))
  // the screenshot's own change is reported where it is, inside the screenshot
  const changed = ofKind(r, 'changed')
  assert.ok(changed.length > 0, describe(r))
  assert.ok(changed.every((x) => x.boxBaseline!.y >= baseline.manifest.shot.y && x.boxBaseline!.y + x.boxBaseline!.h <= baseline.manifest.shot.y + baseline.manifest.shot.h), describe(r))
})
