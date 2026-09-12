import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { isElastishotError } from '../../src/core/errors.ts'
import { iou } from '../../src/core/geometry.ts'
import { cloneImage, createImage, fillRect } from '../../src/core/image.ts'
import type { Box, CompareResult, DiffRegion, RegionKind } from '../../src/core/types.ts'
import { addNoise, collapseRows, createPage, insertRows, moveBlock, padTo, recolor, scaleImage, shiftImage } from '../fixtures/synth.ts'
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
