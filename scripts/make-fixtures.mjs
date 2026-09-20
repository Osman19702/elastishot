#!/usr/bin/env node
/**
 * Regenerate the committed synthetic fixture images in test/fixtures/images
 * from test/fixtures/synth.ts, plus manifest.json describing what changed in
 * each variant. Deterministic: the same seed produces the same bytes.
 *
 *   node scripts/make-fixtures.mjs
 *
 * Needs Node >= 22.18 (imports TypeScript directly).
 */

import fs from 'node:fs'
import path from 'node:path'

import { writeImageFile } from '../src/node/io.ts'
import { COLUMNS_PAIRS, collapseRows, columnChanges, createColumnsPage, createPage, insertBlankRows, moveBlock, padTo, recolor, scaleImage, shiftImage, strokeChange, glyphSpot } from '../test/fixtures/synth.ts'

const OUT = 'test/fixtures/images'
const page = createPage({ seed: 11, sections: 4 })
const base = page.image
const section = page.manifest.sections[1]
const gap = 24
// Inside section 1's card, below its last text line: always background.
const digitAt = glyphSpot(section)
// A pair of its own, not a variant of the page above: a card with a screenshot
// on top and two text columns below it. The screenshot changes in place and
// the columns grow by different amounts, so each needs a lane of its own.
// COLUMNS_PAIRS.stripes is the one whose paragraphs break on different rows in
// the two columns, so a comparison that keeps them in one lane reports
// full-width stripes of added AND removed rows: the symptom A6 is about.
const [columnsBase, columnsGrown] = COLUMNS_PAIRS.stripes.map((options) => createColumnsPage(options))
const columns = columnsBase.manifest

const cases = {
  base: { image: base, expect: { regions: 0 } },
  shifted: { image: shiftImage(base, 17, -9), expect: { regions: 0, translation: [-17, 9] } },
  scaled: { image: scaleImage(base, 1.25), expect: { regions: 0, scale: 1 / 1.25 } },
  recolored: { image: recolor(base, section.title, [220, 38, 38, 255]), expect: { changed: 1, box: section.title } },
  collapsed: { image: collapseRows(base, section.box.y, section.box.y + section.box.h + gap), expect: { removed: 1, rows: [section.box.y, section.box.y + section.box.h + gap] } },
  expanded: { image: insertBlankRows(base, section.box.y + section.box.h + gap, 120), expect: { added: 1, at: section.box.y + section.box.h + gap, rows: 120 } },
  moved: { image: moveBlock(base, section.title, { x: section.title.x + 80, y: section.title.y }), expect: { moved: 1, from: section.title, dx: 80 } },
  padded: { image: padTo(scaleImage(base, 0.4), 320, 320), expect: { note: 'baseline shrunk to 40% and cropped to 320x320' } },
  digit: { image: strokeChange(base, digitAt), expect: { changed: 1, box: { x: digitAt.x, y: digitAt.y, w: 7, h: 9 }, note: 'one glyph of 1 px strokes (about 33 pixels), like a changed digit' } },
  'columns-base': { image: columnsBase.image, expect: { regions: 0, note: 'the baseline of columns-grown, not a variant of base' } },
  'columns-grown': {
    image: columnsGrown.image,
    expect: {
      baseline: 'columns-base.png',
      removed: 0,
      shot: columns.shot,
      gutter: columns.gutter,
      gridY: columns.gridY,
      left: columnChanges(columns.left, columnsGrown.manifest.left, columns.pitchLeft),
      right: columnChanges(columns.right, columnsGrown.manifest.right, columns.pitchRight),
      note: 'against columns-base: the screenshot (shot) changed in place; each column has its added blocks (candidate pixels) and its lines edited in place (baseline pixels); a lane boundary belongs inside gutter, and nothing was removed',
    },
  },
}

fs.mkdirSync(OUT, { recursive: true })
const manifest = { seed: 11, page: page.manifest, cases: {} }
for (const [name, c] of Object.entries(cases)) {
  const file = path.join(OUT, `${name}.png`)
  await writeImageFile(file, c.image)
  manifest.cases[name] = { file: `${name}.png`, width: c.image.width, height: c.image.height, expect: c.expect }
  console.log(`${file} ${c.image.width}x${c.image.height}`)
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`${Object.keys(cases).length} fixtures written to ${OUT}`)
