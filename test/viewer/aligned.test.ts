/**
 * The viewer with an inserted section: both sides are drawn in one row space,
 * the stage grows by the inserted rows, the added region is a full box and
 * the diff tint covers the gap.
 *
 * And with side-by-side columns that grew by different amounts: each lane is
 * drawn in its own rows, the shorter lane is padded, and the page below the
 * card is one picture again instead of being torn along the lane cut.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, before, describe, test } from 'node:test'

import { loadPlaywright } from '../../src/capture/index.ts'
import { createImage, fillRect } from '../../src/core/image.ts'
import type { CompareResult, RasterImage } from '../../src/core/types.ts'
import { readImageFile, writeImageFile } from '../../src/node/io.ts'
import { laneLayouts } from '../../src/viewer/bands.ts'
import { COLUMNS_PAIRS, createColumnsPage, createPage, insertRows } from '../fixtures/synth.ts'
import { engine } from '../support/cv.ts'
import { startStaticServer } from '../support/static-server.js'

const BLOCK = 160
let dir = ''
let server: { url: string; close: () => Promise<void> }
let browser: import('playwright').Browser
let page: import('playwright').Page
let baselineHeight = 0
let insertedRows = 0
let addedBox: { y: number; h: number; anchorY: number } | null = null
const errors: string[] = []

/** The columns pair (test/fixtures/synth.ts, COLUMNS_PAIRS.grown) as the viewer is given it. */
interface ColumnsCase {
  baseline: RasterImage
  warped: RasterImage
  /** The column the engine cut the card's lanes at. */
  cut: number
  /** A row of text under the card that runs across the cut, on each side. */
  textRow: { baseline: number; candidate: number }
  /** The rows under the card that must be one picture: the block of text lines. */
  block: { baseline: number; rows: number; x0: number; x1: number }
  alignedHeight: number
  /**
   * The padding of the shorter lane: its columns and aligned rows, the lane's
   * own blank gap right above it, which is the slack its shorter growth
   * opened up and carries no tint either, and a row of the lane's real
   * insertion, which does.
   */
  padding: { x: number; from: number; to: number; blankGap: number; blankGapFrom: number; gapAbove: number }
}
let columns: ColumnsCase
/** The viewer bundle, inlined into the pages that stand for a downloaded report opened from file://. */
let bundle = ''

/** What a report hands the viewer: its regions and its alignment, as a JSON island. */
const viewerData = (result: CompareResult): string => JSON.stringify({ regions: result.regions, locators: null, alignment: result.alignment }).replace(/<\//g, '<\\/')

const host = (script: string, gaps: boolean, data: string, images = '', width = 800): string => `<!doctype html><html><head><meta charset="utf-8"><title>aligned host</title>
<style>body { margin: 0; padding: 20px; } elastishot-viewer { width: ${width}px; }</style>
${script}</head>
<body>
<elastishot-viewer id="v" baseline-src="${images}baseline.png" candidate-src="${images}candidate.png" diff-src="${images}diff.png" warped-src="${images}warped.png"${gaps ? ` gaps-src="${images}gaps.png"` : ''} mode="slider" show-regions>
<script type="application/json">${data}</script>
</elastishot-viewer>
</body></html>`

before(async () => {
  execFileSync(process.execPath, ['scripts/build-viewer.mjs'], { stdio: 'pipe' })
  dir = await mkdtemp(path.join(os.tmpdir(), 'elastishot-viewer-aligned-'))
  await copyFile('dist/viewer/elastishot-viewer.js', path.join(dir, 'elastishot-viewer.js'))
  const p = createPage({ seed: 21, sections: 3 })
  const base = p.image
  const block = createImage(base.width, BLOCK, [255, 255, 255, 255])
  fillRect(block, { x: 24, y: 12, w: base.width - 48, h: 136 }, [254, 226, 226, 255])
  fillRect(block, { x: 60, y: 40, w: 300, h: 24 }, [153, 27, 27, 255])
  for (let i = 0; i < 5; i++) fillRect(block, { x: 60 + i * 130, y: 90, w: 90, h: 40 }, [220, 38, 38, 255])
  const s0 = p.manifest.sections[0]!
  const candidate = insertRows(base, s0.box.y + s0.box.h + 12, block)
  await engine.warmup()
  const r = await engine.compare(base, candidate, { artifacts: { warpedCandidate: true } })
  baselineHeight = base.height
  insertedRows = r.summary.structural.insertedRows
  assert.ok(insertedRows >= BLOCK * 0.8, JSON.stringify(r.summary.structural))
  const added = r.regions.filter((x) => x.kind === 'added').sort((a, b) => b.score - a.score)[0]
  assert.ok(added?.boxCandidate && added.anchorBaseline, JSON.stringify(r.regions))
  addedBox = { y: added.boxCandidate.y, h: added.boxCandidate.h, anchorY: added.anchorBaseline.y }
  await writeImageFile(path.join(dir, 'baseline.png'), base)
  await writeImageFile(path.join(dir, 'candidate.png'), candidate)
  await writeImageFile(path.join(dir, 'diff.png'), r.artifacts.diffMask!)
  await writeImageFile(path.join(dir, 'warped.png'), r.artifacts.warpedCandidate!)
  assert.ok(r.artifacts.gapFills, 'gapFills')
  await writeImageFile(path.join(dir, 'gaps.png'), r.artifacts.gapFills!)
  const data = viewerData(r)
  await writeFile(path.join(dir, 'index.html'), host('<script type="module" src="elastishot-viewer.js"></script>', true, data))
  // the same page without a gaps image: the viewer reads the pixels itself
  await writeFile(path.join(dir, 'pixels.html'), host('<script type="module" src="elastishot-viewer.js"></script>', false, data))
  // and as a downloaded report is opened: from file://, with the bundle inlined (a module file would be refused there)
  bundle = (await readFile(path.join(dir, 'elastishot-viewer.js'), 'utf8')).replace(/<\/script/g, '<\\/script')
  await writeFile(path.join(dir, 'file.html'), host(`<script type="module">${bundle}</script>`, true, data))
  server = await startStaticServer(dir)
  const pw = await loadPlaywright()
  browser = await pw.chromium.launch()
  page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(`${server.url}/index.html`)
  await page.waitForSelector('elastishot-viewer[ready]', { timeout: 15_000 })
})

after(async () => {
  await browser?.close()
  await server?.close()
  await rm(dir, { recursive: true, force: true })
})

const inShadow = (sel: string) => page.locator('#v').locator(sel)

test('the stage is as tall as the baseline plus the inserted rows and both sides are drawn on canvases', async () => {
  const stageH = await inShadow('.stage').evaluate((el) => parseInt((el as HTMLElement).style.height, 10))
  assert.equal(stageH, baselineHeight + insertedRows)
  assert.equal(await inShadow('.layer.baseline canvas.aligned').isHidden(), false)
  assert.equal(await inShadow('.layer.candidate canvas.aligned').isHidden(), false)
  assert.equal(await inShadow('.layer.baseline img').isHidden(), true)
  const sizes = await inShadow('canvas.aligned').evaluateAll((els) => els.map((c) => (c as HTMLCanvasElement).height))
  assert.deepEqual(sizes, [stageH, stageH])
})

test('the added region is a full box over the inserted rows, not a line', async () => {
  const box = await inShadow('.region.k-added').first().evaluate((el) => ({ y: parseInt((el as HTMLElement).style.top, 10), h: parseInt((el as HTMLElement).style.height, 10) }))
  assert.ok(box.h >= BLOCK * 0.8, JSON.stringify({ box, addedBox }))
  // rows above the insertion keep their baseline coordinates, so the box starts at the anchor row
  assert.ok(Math.abs(box.y - addedBox!.anchorY) <= 8, JSON.stringify({ box, addedBox }))
})

const gapPixels = async (p: import('playwright').Page) =>
  p.locator('#v').locator('.layer.baseline canvas.aligned').evaluate((el, box) => {
    const c = el as HTMLCanvasElement
    const ctx = c.getContext('2d')!
    const x = Math.floor(c.width / 2)
    const at = (y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data)
    return { above: at(box.anchorY - 3), inside: at(box.anchorY + Math.floor(box.h / 2)) }
  }, addedBox!)

// The fixture page is white around the insertion: the gap must be white under a light green
// tint, neither the viewer's own background nor a stretched copy of the section above.
const assertWhiteUnderTint = (gap: { above: number[]; inside: number[] }) => {
  assert.ok(gap.above[0]! > 240 && gap.above[3] === 255, JSON.stringify(gap))
  assert.ok(gap.inside[3] === 255 && gap.inside[0]! > 200 && gap.inside[0]! < 250 && gap.inside[1]! > 230, JSON.stringify(gap))
}

test('the gap continues the page background under its tint, from the gaps image', async () => {
  assertWhiteUnderTint(await gapPixels(page))
})

test('without a gaps image the viewer reads the pixels around the gap itself', async () => {
  const p = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  await p.goto(`${server.url}/pixels.html`)
  await p.waitForSelector('elastishot-viewer[ready]', { timeout: 15_000 })
  assertWhiteUnderTint(await gapPixels(p))
  await p.close()
})

test('a report opened from file:// draws the gaps image, where pixel reads are refused', async () => {
  const p = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  const fileErrors: string[] = []
  p.on('pageerror', (e) => fileErrors.push(e.message))
  await p.goto(pathToFileURL(path.join(dir, 'file.html')).href)
  await p.waitForSelector('elastishot-viewer[ready]', { timeout: 15_000 })
  // a canvas that drew a file:// image is tainted and cannot be read back, so read what the
  // page shows: scroll the gap into the scroll container and screenshot the container
  const gapRow = addedBox!.anchorY + Math.floor(addedBox!.h / 2)
  // the whole view shows the baseline, so the slider's handle is out of the way
  await p.locator('#v').evaluate((el) => el.setAttribute('position', '100'))
  const view = await p.locator('#v').locator('.viewport').evaluate((el, row) => {
    const canvas = el.querySelector('canvas.aligned') as HTMLCanvasElement
    const stage = el.querySelector('.stage-box') as HTMLElement
    const scale = stage.getBoundingClientRect().width / canvas.width
    el.scrollTop = Math.max(0, Math.round(row * scale) - 40)
    return { scale, scrollTop: el.scrollTop, width: canvas.width }
  }, gapRow)
  const shotPath = path.join(dir, 'file-shot.png')
  await p.locator('#v').locator('.viewport').screenshot({ path: shotPath })
  const png = await readImageFile(shotPath)
  const at = (y: number) => {
    const sy = Math.round(y * view.scale) - view.scrollTop
    const i = (sy * png.width + Math.round((view.width / 2) * view.scale)) * 4
    return Array.from(png.data.subarray(i, i + 4))
  }
  assertWhiteUnderTint({ above: at(addedBox!.anchorY - 3), inside: at(gapRow) })
  assert.deepEqual(fileErrors, [])
  await p.close()
})

test('the diff tint spans the aligned height and marks the gap as changed', async () => {
  await page.locator('#v').evaluate((el) => el.setAttribute('mode', 'diff'))
  const tint = await inShadow('.diff-tint').evaluate((el) => {
    const c = el as HTMLCanvasElement
    const ctx = c.getContext('2d')!
    const mid = ctx.getImageData(Math.floor(c.width / 2), 0, 1, c.height).data
    const changed = (y: number) => mid[y * 4 + 1]! < 200 // white rows stay white; changed rows take the tint
    return { height: c.height, gapChanged: changed(0) ? 'top-changed' : 'top-clean', gapRow: changed(0) }
  })
  assert.equal(tint.height, baselineHeight + insertedRows)
  const inGap = await inShadow('.diff-tint').evaluate((el, y) => {
    const c = el as HTMLCanvasElement
    const d = c.getContext('2d')!.getImageData(Math.floor(c.width / 2), y, 1, 1).data
    return d[1]! < 200
  }, addedBox!.anchorY + Math.floor(addedBox!.h / 2))
  assert.equal(inGap, true)
  assert.equal(tint.gapRow, false)
})

// ------------------------------------------------- lanes of unequal height

// The columns pair is compared and written in this suite's own hook, not the
// file-wide one: its two setup assertions are about the engine's lane cut, and
// a lane regression must redden these four tests only, not the seven above,
// which know nothing of lanes. The outer hook has already made `dir`, started
// the server and launched the browser by the time this one runs, and the
// server serves the directory, so pages written now are still reachable.
describe('lanes of unequal height', () => {
  before(async () => {
    // The columns pair: the left lane gains 132 rows and loses the 66 rows of padding under it, the right one
    // gains 66, so the left lane takes 66 more aligned rows than the right one.
    const [v1, v2] = COLUMNS_PAIRS.grown
    const cb = createColumnsPage(v1)
    const cc = createColumnsPage(v2)
    const cr = await engine.compare(cb.image, cc.image, { artifacts: { warpedCandidate: true } })
    const warped = cr.artifacts.warpedCandidate!
    const cut = cr.alignment.bandMap.find((b) => b.columns && b.columns.start > 0)?.columns?.start
    assert.ok(cut !== undefined && cut >= cb.manifest.gutter.start - 4 && cut <= cb.manifest.gutter.end + 4, `a lane cut at the card's gutter: ${cut}`)
    const lanes = laneLayouts(cr.alignment.bandMap, cb.image.height, warped.height)
    const short = lanes.find((l) => l.layout.segments.some((s) => s.kind === 'padding'))
    const pad = short?.layout.segments.find((s) => s.kind === 'padding')
    assert.ok(short?.columns && pad, 'the band map must give lanes of unequal height, or the tests below test nothing')
    // Right above the padding is the lane's own blank gap, the rows of card padding its shorter growth
    // opened up. It holds no content, the engine marks it blank and reports no region for it, and the
    // viewer draws it like the padding: filled, untinted. The lane's real insertion, higher up, is tinted.
    const blankGap = short.layout.segments[short.layout.segments.indexOf(pad) - 1]!
    assert.equal(blankGap.kind, 'inserted')
    assert.equal(blankGap.blank, true, 'the gap above the padding is the blank lane gap the engine marks')
    const gapAbove = short.layout.segments.find((s) => s.kind === 'inserted' && !s.blank)
    assert.ok(gapAbove, 'the short lane also has a real insertion, or the tint below is not tested')
    // the block under the card starts 32 rows below it and its text lines 20 rows further down, see createColumnsPage
    const under = (m: typeof cb.manifest) => m.card.y + m.card.h + 32
    columns = {
      baseline: cb.image,
      warped,
      cut,
      textRow: { baseline: under(cb.manifest) + 24, candidate: under(cc.manifest) + 24 },
      block: { baseline: under(cb.manifest), rows: 120, x0: cb.manifest.card.x, x1: cb.manifest.card.x + cb.manifest.card.w },
      alignedHeight: Math.max(...lanes.map((l) => l.layout.height)),
      padding: {
        x: short.columns.start + 120,
        from: pad.aligned.start,
        to: pad.aligned.end,
        blankGap: Math.floor((blankGap.aligned.start + blankGap.aligned.end) / 2),
        blankGapFrom: blankGap.aligned.start,
        gapAbove: Math.floor((gapAbove.aligned.start + gapAbove.aligned.end) / 2),
      },
    }
    const sub = path.join(dir, 'columns')
    await mkdir(sub)
    await writeImageFile(path.join(sub, 'baseline.png'), cb.image)
    await writeImageFile(path.join(sub, 'candidate.png'), cc.image)
    await writeImageFile(path.join(sub, 'diff.png'), cr.artifacts.diffMask!)
    await writeImageFile(path.join(sub, 'warped.png'), warped)
    assert.ok(cr.artifacts.gapFills, 'gapFills')
    await writeImageFile(path.join(sub, 'gaps.png'), cr.artifacts.gapFills!)
    // wider than the page, so the viewer shows it at scale 1 and a screenshot holds the canvases' own pixels
    const wide = cb.image.width + 60
    const data = viewerData(cr)
    await writeFile(path.join(dir, 'columns.html'), host('<script type="module" src="elastishot-viewer.js"></script>', true, data, 'columns/', wide))
    await writeFile(path.join(dir, 'columns-pixels.html'), host('<script type="module" src="elastishot-viewer.js"></script>', false, data, 'columns/', wide))
    await writeFile(path.join(dir, 'columns-file.html'), host(`<script type="module">${bundle}</script>`, true, data, 'columns/', wide))
    // and with a gaps image whose rows alternate between two loud colours, to see which rows a fill is taken from
    const striped = createImage(cr.artifacts.gapFills!.width, cr.artifacts.gapFills!.height, [0, 0, 255, 255])
    assert.ok(striped.height >= 3, 'several gaps')
    for (let y = 1; y < striped.height; y += 2) fillRect(striped, { x: 0, y, w: striped.width, h: 1 }, [255, 255, 0, 255])
    await mkdir(path.join(dir, 'striped'))
    for (const name of ['baseline.png', 'candidate.png', 'diff.png', 'warped.png']) await copyFile(path.join(sub, name), path.join(dir, 'striped', name))
    await writeImageFile(path.join(dir, 'striped', 'gaps.png'), striped)
    await writeFile(path.join(dir, 'columns-striped.html'), host('<script type="module" src="elastishot-viewer.js"></script>', true, data, 'striped/', wide))
  })

  /**
   * What the viewer shows of one side, in stage pixels. A canvas that drew a
   * file:// image cannot be read back, so all three ways of opening the page
   * are read the same way: a screenshot of the scroll container at scale 1.
   */
  const openColumns = async (url: string) => {
    const p = await browser.newPage({ viewport: { width: 1300, height: 1400 } })
    const pageErrors: string[] = []
    p.on('pageerror', (e) => pageErrors.push(e.message))
    p.on('console', (m) => {
      if (m.type() === 'error') pageErrors.push(m.text())
    })
    await p.goto(url)
    await p.waitForSelector('elastishot-viewer[ready]', { timeout: 15_000 })
    const viewport = p.locator('#v').locator('.viewport')
    let shots = 0
    const show = async (side: 'baseline' | 'candidate') => {
      // the slider all the way over shows one side only, and the region boxes would be in the way of reading pixels
      await p.locator('#v').evaluate((el, position) => {
        el.setAttribute('position', position)
        el.setAttribute('hide-regions', '')
      }, side === 'baseline' ? '100' : '0')
      const frame = await viewport.evaluate((el) => {
        const canvas = el.querySelector('canvas.aligned') as HTMLCanvasElement
        const stage = el.querySelector('.stage-box') as HTMLElement
        return { left: el.clientLeft, top: el.clientTop, scale: stage.getBoundingClientRect().width / canvas.width, height: canvas.height }
      })
      assert.equal(frame.scale, 1)
      const file = path.join(dir, `columns-shot-${path.basename(new URL(url).pathname)}-${shots++}.png`)
      await viewport.screenshot({ path: file })
      const png = await readImageFile(file)
      /** Stage rows where the view shows row `row` of `img` over columns x0..x1. */
      const rowsShowing = (img: RasterImage, row: number, x0: number, x1: number): number[] => {
        const found: number[] = []
        for (let y = 0; y < frame.height && y + frame.top < png.height; y++) {
          let same = true
          for (let x = x0; x < x1 && same; x++) {
            const i = ((y + frame.top) * png.width + x + frame.left) * 4
            const j = (row * img.width + x) * 4
            for (let k = 0; k < 3; k++) if (Math.abs(png.data[i + k]! - img.data[j + k]!) > 3) same = false
          }
          if (same) found.push(y)
        }
        return found
      }
      const at = (x: number, y: number) => Array.from(png.data.subarray(((y + frame.top) * png.width + x + frame.left) * 4, ((y + frame.top) * png.width + x + frame.left) * 4 + 3))
      return { height: frame.height, rowsShowing, at }
    }
    return { page: p, show, errors: pageErrors }
  }

  /**
   * Under the card the page is one picture: a line of text that runs across
   * the lane cut is drawn at one height on both sides of it. Left alone, the
   * lanes end 66 rows apart here and everything below is torn along the cut.
   */
  const assertNoTear = async (url: string) => {
    const view = await openColumns(url)
    const c = columns
    const textEnd = c.block.x0 + 24 + 620 // the first text line of the block, see createColumnsPage
    assert.ok(c.cut > c.block.x0 + 24 + 100 && c.cut < textEnd - 100, 'the text line runs across the cut')

    const baseline = await view.show('baseline')
    assert.equal(baseline.height, c.alignedHeight)
    const left = baseline.rowsShowing(c.baseline, c.textRow.baseline, c.block.x0, c.cut)
    const right = baseline.rowsShowing(c.baseline, c.textRow.baseline, c.cut, textEnd)
    assert.equal(left.length, 1, `the row is unique: ${JSON.stringify({ left, right })}`)
    assert.deepEqual(right, left, 'baseline side: left and right of the lane cut show the row at one height')
    // and so does every row of the block, over the card's whole width
    const shift = left[0]! - c.textRow.baseline
    for (let r = c.block.baseline; r < c.block.baseline + c.block.rows; r++) {
      assert.ok(baseline.rowsShowing(c.baseline, r, c.block.x0, c.block.x1).includes(r + shift), `baseline row ${r} is whole at stage row ${r + shift}`)
    }
    // The padding that levels the right lane continues the card's colour and is not tinted: nothing was added
    // there. Neither is the lane's blank gap right above it, the card padding its shorter growth opened up,
    // which the engine reports no region for. The rows it really gained, higher up, are tinted green.
    const padding = baseline.at(c.padding.x, Math.floor((c.padding.from + c.padding.to) / 2))
    const blank = baseline.at(c.padding.x, c.padding.blankGap)
    const gap = baseline.at(c.padding.x, c.padding.gapAbove)
    assert.ok(Math.min(...padding) > 240 && Math.max(...padding) - Math.min(...padding) <= 4, `neutral padding: ${padding}`)
    assert.ok(Math.min(...blank) > 240 && Math.max(...blank) - Math.min(...blank) <= 4, `the blank gap is untinted too: ${blank}`)
    assert.ok(gap[1]! > gap[0]! + 8 && gap[1]! > gap[2]! + 4, `a tinted gap where the lane really grew: ${gap}`)

    const candidate = await view.show('candidate')
    const leftC = candidate.rowsShowing(c.warped, c.textRow.candidate, c.block.x0, c.cut)
    const rightC = candidate.rowsShowing(c.warped, c.textRow.candidate, c.cut, textEnd)
    assert.equal(leftC.length, 1, JSON.stringify({ leftC, rightC }))
    assert.deepEqual(rightC, leftC, 'candidate side: left and right of the lane cut show the row at one height')
    // both sides face each other: the same line of text, at the same stage row
    assert.deepEqual(leftC, left)
    const paddingC = candidate.at(c.padding.x, Math.floor((c.padding.from + c.padding.to) / 2))
    assert.ok(Math.min(...paddingC) > 240 && Math.max(...paddingC) - Math.min(...paddingC) <= 4, `neutral padding on the candidate side: ${paddingC}`)
    assert.deepEqual(view.errors, [])
    return view
  }

  test('the page under the card is not torn along the lane cut', async () => {
    const view = await assertNoTear(`${server.url}/columns.html`)
    // the stage, the tint and the boxes share the levelled rows
    const p = view.page
    const stageH = await p.locator('#v').locator('.stage').evaluate((el) => parseInt((el as HTMLElement).style.height, 10))
    assert.equal(stageH, columns.alignedHeight)
    await p.locator('#v').evaluate((el) => el.setAttribute('mode', 'diff'))
    const tint = await p.locator('#v').locator('.diff-tint').evaluate((el, pad) => {
      const c = el as HTMLCanvasElement
      const ctx = c.getContext('2d')!
      const changed = (y: number) => ctx.getImageData(pad.x, y, 1, 1).data[1]! < 200
      return { height: c.height, padding: changed(Math.floor((pad.from + pad.to) / 2)), blankGap: changed(pad.blankGap), gapAbove: changed(pad.gapAbove) }
    }, columns.padding)
    // in Diff mode the padding and the lane's blank gap are unchanged rows, like the card around them
    assert.deepEqual(tint, { height: columns.alignedHeight, padding: false, blankGap: false, gapAbove: true })
    const boxes = await p.locator('#v').locator('.region').evaluateAll((els) =>
      els.map((el) => {
        const s = (el as HTMLElement).style
        return { x: parseInt(s.left, 10), y: parseInt(s.top, 10), w: parseInt(s.width, 10), h: parseInt(s.height, 10) }
      }),
    )
    // The right column's last line is edited in place (COLUMNS_PAIRS.grown), so one of these boxes ends on
    // the very row that lane's gap begins at, with the padding right behind it. Without such a box nothing
    // here decides: a box that ends anywhere else cannot be drawn over the padding however it is mapped.
    const inShortLane = boxes.filter((b) => b.x + b.w / 2 >= columns.cut)
    assert.ok(inShortLane.length > 0, JSON.stringify(boxes))
    assert.ok(inShortLane.some((b) => b.y + b.h === columns.padding.blankGapFrom), `a box ends where the lane's gap begins (${columns.padding.blankGapFrom}): ${JSON.stringify(inShortLane)}`)
    for (const b of inShortLane) assert.ok(b.y + b.h <= columns.padding.from || b.y >= columns.padding.to, `no region box over the padding, which holds no rows: ${JSON.stringify(b)}`)
    await p.close()
  })

  test('without a gaps image: the padding is filled from the pixels around it', async () => {
    const view = await assertNoTear(`${server.url}/columns-pixels.html`)
    await view.page.close()
  })

  test('in a report opened from file://', async () => {
    const view = await assertNoTear(pathToFileURL(path.join(dir, 'columns-file.html')).href)
    await view.page.close()
  })

  test('a fill is one row of the gaps image from its first row to its last, with nothing of the rows next to it', async () => {
    const view = await openColumns(`${server.url}/columns-striped.html`)
    const baseline = await view.show('baseline')
    // The padding is untinted, so it shows its row as it is: all blue or all yellow. A smoothing filter reaches
    // into the neighbouring rows when one row is stretched, and fades their colour in from the top and the bottom.
    const loud = (c: number[]) => c.every((v) => v <= 3 || v >= 252)
    const rows = [columns.padding.from, Math.floor((columns.padding.from + columns.padding.to) / 2), columns.padding.to - 1].map((y) => baseline.at(columns.padding.x, y))
    assert.ok(rows.every(loud), JSON.stringify(rows))
    assert.deepEqual(rows[0], rows[1])
    assert.deepEqual(rows[2], rows[1])
    assert.deepEqual(view.errors, [])
    await view.page.close()
  })
})

test('no errors were logged', () => {
  assert.deepEqual(errors, [])
})
