/**
 * Group A — Comparing two images or two pages.
 * Scenarios: acceptance/features/A-compare.feature. Run: npm run test:acceptance
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { after, before, test } from 'node:test'

import { elastishot, image, workspace } from './support/cli.js'
import { startSite } from './support/site.js'

let ws
let site
before(async () => {
  ws = await workspace()
  site = await startSite()
})
after(async () => {
  await site.close()
  await ws.remove()
})

const run = (args) => elastishot([...args, '--json'], { cwd: ws.dir })
const report = (r) => JSON.parse(r.stdout)

test('A1 — Two identical images pass', async () => {
  const r = await run(['compare', image('base.png'), image('base.png')])
  assert.equal(r.code, 0, r.stderr)
  const pair = report(r).pairs[0]
  assert.equal(pair.status, 'passed')
  assert.equal(pair.regions.length, 0)
})

test('A2 — A collapsed section is reported as removed', async () => {
  const r = await run(['compare', image('base.png'), image('collapsed.png')])
  assert.equal(r.code, 1, r.stderr)
  const pair = report(r).pairs[0]
  const removed = pair.regions.filter((x) => x.kind === 'removed' && x.score >= 0.5)
  assert.ok(removed.length >= 1, JSON.stringify(pair.regions))
  assert.ok(Math.max(...removed.map((x) => x.boxBaseline.h)) >= 100, JSON.stringify(removed))
  assert.equal(pair.regions.filter((x) => x.kind === 'changed' && x.score >= 0.1).length, 0, JSON.stringify(pair.regions))
})

test('A3 — Images of different sizes are aligned before comparing', async () => {
  const r = await run(['compare', image('base.png'), image('padded.png')])
  assert.notEqual(r.code, 2, r.stderr)
  const pair = report(r).pairs[0]
  assert.ok(Math.abs(pair.alignment.scale - 2.5) < 0.1, `scale ${pair.alignment.scale}`)
  const visible = 320 / 0.4
  const spurious = pair.regions.filter((x) => x.kind === 'changed' && x.score >= 0.2 && x.boxBaseline.y + x.boxBaseline.h <= visible - 8)
  assert.equal(spurious.length, 0, JSON.stringify(pair.regions))
})

test('A4 — Two versions of a page are captured and compared by URL', async () => {
  const r = await run(['compare', site.v1, site.v2, '--full-page'])
  assert.equal(r.code, 1, r.stderr)
  const pair = report(r).pairs[0]
  assert.equal(pair.status, 'failed')
  const locators = pair.locators.changedLocators.map((l) => l.locator)
  assert.ok(locators.some((l) => l.startsWith('#faq')), locators.join(', '))
  assert.ok(locators.includes('role=img[name="Illustration"]'), locators.join(', '))
  assert.ok(locators.includes('[data-testid="cta"]'), locators.join(', '))
  assert.ok(locators.includes('[data-testid="badge"]'), locators.join(', '))
})

test('A5 — A one-digit change in small text is reported', async () => {
  const r = await run(['compare', image('base.png'), image('digit.png')])
  assert.equal(r.code, 1, r.stderr)
  const pair = report(r).pairs[0]
  const changed = pair.regions.filter((x) => x.kind === 'changed' && x.score >= 0.05)
  assert.equal(changed.length, 1, JSON.stringify(pair.regions))
  const expected = JSON.parse(fs.readFileSync(image('manifest.json'), 'utf8')).cases.digit.expect.box
  const b = changed[0].boxBaseline
  assert.ok(b.x <= expected.x && b.y <= expected.y && b.x + b.w >= expected.x + expected.w && b.y + b.h >= expected.y + expected.h, JSON.stringify({ b, expected }))
  assert.ok(b.w <= 40 && b.h <= 40, JSON.stringify(b))
})

// The picture is the condition: with it unchanged, 0.1.7 passed this pair too.
// Its change made the rows above the columns look unsettled as a whole, the
// columns were never separated, and the growth was reported as full-width
// stripes of added and removed rows across the card, with both columns
// "changed" above them. The two columns break their paragraphs on different
// rows, which is what lets the stripes alternate; see COLUMNS_PAIRS.stripes in
// test/fixtures/synth.ts, the pair these images are drawn from.
test('A6 — Two columns of a card grew by different amounts under a picture that changed in place', async () => {
  const r = await run(['compare', image('columns-base.png'), image('columns-grown.png')])
  assert.equal(r.code, 1, r.stderr)
  const pair = report(r).pairs[0]
  const expected = JSON.parse(fs.readFileSync(image('manifest.json'), 'utf8')).cases['columns-grown'].expect
  const seen = JSON.stringify(pair.regions.map((x) => [x.kind, x.boxBaseline, x.boxCandidate]))
  const why = (what) => `${what}\n${seen}`
  const LINE = 22 // the columns' line pitch, COLUMNS_LINE in test/fixtures/synth.ts
  const isLeft = (box) => box.x + box.w / 2 < (expected.gutter.start + expected.gutter.end) / 2
  const sameRows = (box, target) => {
    const shared = Math.min(box.y + box.h, target.y + target.h) - Math.max(box.y, target.y)
    return shared / (box.h + target.h - shared) >= 0.8
  }

  const added = pair.regions.filter((x) => x.kind === 'added').map((x) => x.boxCandidate)
  for (const [name, side, truth] of [['left', added.filter(isLeft), expected.left], ['right', added.filter((box) => !isLeft(box)), expected.right]]) {
    assert.equal(side.length, truth.added.length, why(`${name} column: ${side.length} added blocks, expected ${truth.added.length}`))
    for (const block of truth.added) assert.ok(side.some((box) => sameRows(box, block)), why(`${name} column: no added block on the rows of ${JSON.stringify(block)}`))
  }

  const gone = pair.regions.filter((x) => x.kind === 'removed' || x.kind === 'moved')
  assert.equal(gone.length, expected.removed, why(`${gone.length} removed or moved regions, expected ${expected.removed}: ${JSON.stringify(gone.map((x) => [x.kind, x.boxBaseline ?? x.boxCandidate]))}`))

  const changed = pair.regions.filter((x) => x.kind === 'changed').map((x) => x.boxBaseline)
  const inColumns = changed.filter((box) => box.y >= expected.gridY)
  assert.equal(inColumns.length, expected.left.edited.length + expected.right.edited.length, why(`${inColumns.length} changed regions in the columns, expected ${expected.left.edited.length + expected.right.edited.length}`))
  for (const [name, side, truth] of [['left', inColumns.filter(isLeft), expected.left], ['right', inColumns.filter((box) => !isLeft(box)), expected.right]]) {
    assert.equal(side.length, truth.edited.length, why(`${name} column: ${side.length} changed lines, expected ${truth.edited.length}`))
    // `box.h <= LINE` states the step's own words. It cannot decide on its own: a row
    // overlap of 0.8 against a 10-row line already bounds the box to 12 rows.
    for (const line of truth.edited) assert.ok(side.some((box) => box.h <= LINE && sameRows(box, line)), why(`${name} column: no change of one line's height on ${JSON.stringify(line)}`))
  }

  const shot = expected.shot
  const above = changed.filter((box) => box.y < expected.gridY)
  assert.ok(above.length >= 1, why('the picture changed in place and nothing is reported inside it'))
  assert.ok(above.every((box) => box.x >= shot.x && box.y >= shot.y && box.x + box.w <= shot.x + shot.w && box.y + box.h <= shot.y + shot.h), why(`a change above the columns outside the picture ${JSON.stringify(shot)}`))

  // The two columns ended on the same row and now the left one is three lines
  // taller, so the right column's blank padding grows by the difference: rows
  // on one side only, and inside one column. A block that spans the gutter is
  // the whole card taken as one, which is the failure this scenario is about.
  const blocks = pair.alignment.bandMap.filter((band) => band.kind !== 'matched')
  assert.ok(blocks.length >= 3, why(`${blocks.length} one-sided blocks of rows, expected at least 3`))
  const across = blocks.filter((band) => !band.columns || (band.columns.start < expected.gutter.start && band.columns.end > expected.gutter.end))
  assert.deepEqual(across.map((band) => [band.kind, band.columns ?? 'the whole width']), [], why(`a block of rows across the card's gutter ${JSON.stringify(expected.gutter)}`))
})
