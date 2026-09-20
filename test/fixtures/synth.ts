/**
 * Deterministic synthetic pages for engine tests and fixture generation.
 *
 * A page is a header bar, N section cards with a title block and rows of
 * text-like blocks, and a footer. The blocks have plenty of corners for ORB
 * and look like text to the strip signatures, so the engine sees something
 * close to a real screenshot without any binary fixtures.
 */
import { blit, cloneImage, createImage, cropImage, fillRect, resizeImage, type RGBA, WHITE } from '../../src/core/image.ts'
import type { Box, Point, Range, RasterImage } from '../../src/core/types.ts'

export const HEADER: RGBA = [31, 41, 55, 255]
export const ACCENT: RGBA = [37, 99, 235, 255]
export const TITLE: RGBA = [17, 24, 39, 255]
export const TEXT: RGBA = [75, 85, 99, 255]
export const BORDER: RGBA = [209, 213, 219, 255]
export const CARD: RGBA = [249, 250, 251, 255]
export const LIGHT: RGBA = [229, 231, 235, 255]

export function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface PageOptions {
  width?: number
  seed?: number
  sections?: number
  sectionHeight?: number
  margin?: number
  lineHeight?: number
}

export interface SectionManifest {
  index: number
  box: Box
  title: Box
  lines: Box[]
}

export interface PageManifest {
  width: number
  height: number
  header: Box
  sections: SectionManifest[]
  footer: Box
}

export interface SyntheticPage {
  image: RasterImage
  manifest: PageManifest
}

export function createPage(options: PageOptions = {}): SyntheticPage {
  const width = options.width ?? 800
  const sections = options.sections ?? 4
  const sectionHeight = options.sectionHeight ?? 160
  const margin = options.margin ?? 24
  const lineHeight = options.lineHeight ?? 14
  const rand = mulberry32(options.seed ?? 1)
  const headerH = 56
  const footerH = 48
  const height = headerH + margin + sections * (sectionHeight + margin) + footerH
  const image = createImage(width, height, WHITE)

  const header = { x: 0, y: 0, w: width, h: headerH }
  fillRect(image, header, HEADER)
  fillRect(image, { x: margin, y: 16, w: 96, h: 24 }, ACCENT)
  for (let i = 0; i < 4; i++) {
    fillRect(image, { x: width - margin - (i + 1) * 72 + 12, y: 22, w: 48, h: 12 }, LIGHT)
  }

  const list: SectionManifest[] = []
  let y = headerH + margin
  for (let s = 0; s < sections; s++) {
    const box = { x: margin, y, w: width - 2 * margin, h: sectionHeight }
    fillRect(image, box, BORDER)
    fillRect(image, { x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 2 }, CARD)
    const title = { x: box.x + 16, y: box.y + 16, w: Math.round(box.w * (0.3 + rand() * 0.3)), h: 18 }
    fillRect(image, title, TITLE)
    const bodyTop = title.y + title.h + 14
    const lines = drawTextLines(image, rand, { x: box.x + 16, y: bodyTop, w: box.w - 32, h: box.y + box.h - 12 - bodyTop }, lineHeight)
    list.push({ index: s, box, title, lines })
    y += sectionHeight + margin
  }

  const footer = { x: 0, y: height - footerH, w: width, h: footerH }
  fillRect(image, footer, LIGHT)
  for (let i = 0; i < 3; i++) fillRect(image, { x: margin + i * 120, y: footer.y + 18, w: 80, h: 10 }, TEXT)

  return { image, manifest: { width, height, header, sections: list, footer } }
}

function drawTextLines(img: RasterImage, rand: () => number, area: Box, lineHeight: number): Box[] {
  const lines: Box[] = []
  const wordH = 9
  for (let ly = area.y; ly + wordH <= area.y + area.h; ly += lineHeight) {
    const lineWidth = area.w * (0.55 + rand() * 0.45)
    let x = area.x
    while (x < area.x + lineWidth) {
      const w = Math.min(12 + Math.floor(rand() * 48), area.x + area.w - x)
      if (w < 4) break
      fillRect(img, { x, y: ly, w, h: wordH }, rand() < 0.15 ? ACCENT : TEXT)
      x += w + 6 + Math.floor(rand() * 6)
    }
    lines.push({ x: area.x, y: ly, w: Math.round(lineWidth), h: wordH })
  }
  return lines
}

// ---------------------------------------------------------------- variants

export function scaleImage(img: RasterImage, factor: number): RasterImage {
  return resizeImage(img, Math.max(1, Math.round(img.width * factor)), Math.max(1, Math.round(img.height * factor)))
}

/** Place the image on a canvas of the given size (cropping when smaller). */
export function padTo(img: RasterImage, width: number, height: number, fill: RGBA = WHITE): RasterImage {
  const out = createImage(width, height, fill)
  blit(out, img, 0, 0)
  return out
}

/** Delete rows [y0, y1). */
export function collapseRows(img: RasterImage, y0: number, y1: number): RasterImage {
  const removed = Math.max(0, Math.min(img.height, y1) - Math.max(0, y0))
  if (removed === 0) return cloneImage(img)
  const out = createImage(img.width, img.height - removed, [0, 0, 0, 0])
  const row = img.width * 4
  out.data.set(img.data.subarray(0, y0 * row), 0)
  out.data.set(img.data.subarray(y1 * row), y0 * row)
  return out
}

/** Insert an image block (any width) as new rows at y. */
export function insertRows(img: RasterImage, y: number, block: RasterImage, fill: RGBA = WHITE): RasterImage {
  const out = createImage(img.width, img.height + block.height, fill)
  const row = img.width * 4
  out.data.set(img.data.subarray(0, y * row), 0)
  blit(out, block, 0, y)
  out.data.set(img.data.subarray(y * row), (y + block.height) * row)
  return out
}

export function insertBlankRows(img: RasterImage, y: number, count: number, fill: RGBA = WHITE): RasterImage {
  return insertRows(img, y, createImage(img.width, count, fill), fill)
}

export function shiftImage(img: RasterImage, dx: number, dy: number, fill: RGBA = WHITE): RasterImage {
  const out = createImage(img.width, img.height, fill)
  blit(out, img, dx, dy)
  return out
}

export function recolor(img: RasterImage, box: Box, rgba: RGBA): RasterImage {
  const out = cloneImage(img)
  fillRect(out, box, rgba)
  return out
}

/** Cut a block out and paste it at another position. */
export function moveBlock(img: RasterImage, from: Box, to: Point, fill: RGBA = WHITE): RasterImage {
  const out = cloneImage(img)
  const block = cropImage(img, from)
  fillRect(out, from, fill)
  blit(out, block, to.x, to.y)
  return out
}

/** Add uniform noise of +/- amplitude to every colour channel. */
export function addNoise(img: RasterImage, amplitude: number, seed = 7): RasterImage {
  const out = cloneImage(img)
  const rand = mulberry32(seed)
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i]! + (rand() * 2 - 1) * amplitude
    d[i + 1] = d[i + 1]! + (rand() * 2 - 1) * amplitude
    d[i + 2] = d[i + 2]! + (rand() * 2 - 1) * amplitude
  }
  return out
}

export function translateBox(b: Box, dx: number, dy: number): Box {
  return { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h }
}

export function scaleBox(b: Box, factor: number): Box {
  return { x: Math.round(b.x * factor), y: Math.round(b.y * factor), w: Math.round(b.w * factor), h: Math.round(b.h * factor) }
}

/**
 * The smallest change a release check must catch: one glyph whose strokes
 * are one pixel wide, like a digit that changed in a version label. Draws an
 * "8"-like mark (three 7 px bars and two 9 px stems, about 33 pixels) at `at`.
 */
/** A spot inside a section card that is always background: below the last text line, above the border. */
export function glyphSpot(section: SectionManifest): Point {
  return { x: section.box.x + 16, y: section.box.y + section.box.h - 11 }
}

export function strokeChange(img: RasterImage, at: Point, rgba: RGBA = TEXT): RasterImage {
  const out = cloneImage(img)
  for (const dy of [0, 4, 8]) fillRect(out, { x: at.x, y: at.y + dy, w: 7, h: 1 }, rgba)
  for (const dx of [0, 6]) fillRect(out, { x: at.x + dx, y: at.y, w: 1, h: 9 }, rgba)
  return out
}

// ------------------------------------------ a two-column card under a screenshot

const INK: RGBA = [55, 65, 81, 255]
const SHOT_TITLE: RGBA = [226, 232, 240, 255]
const SHOT_TEXT: RGBA = [203, 213, 225, 255]
const RAIL: RGBA = [100, 116, 139, 255]
const RAIL_ACTIVE: RGBA = [59, 130, 246, 255]
const MUTED: RGBA = [107, 114, 128, 255]

/**
 * A line of "text": 3 px cells inked at random in each of its ten rows, so
 * that no two rows of a page hash alike, as no two rows of real glyphs do.
 * A plain bar repeats one row ten times: nothing can anchor the row
 * alignment inside a lane then, and a lane test fails (or passes) for the
 * wrong reason. The seed is the line's identity: same seed, same pixels.
 */
export function textLine(img: RasterImage, x: number, y: number, w: number, seed: number, ink: RGBA = INK): void {
  const rand = mulberry32(seed * 7919 + 17)
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < w; c += 3) if (rand() < 0.55) fillRect(img, { x: x + c, y: y + r, w: 3, h: 1 }, ink)
  }
}

export interface ColumnsPageOptions {
  /** Line seeds of the two columns, top to bottom; `null` is a line slot left blank, so that a column can hold two blocks with a stretch of nothing between them. */
  left: readonly (number | null)[]
  right: readonly (number | null)[]
  /** What the screenshot block on top of the card shows: 'b' is 'a' re-rendered in place, same size, other pixels; 'none' is a card of plain text, where a column that ends early leaves the page a gap of its own. */
  shot?: 'a' | 'b' | 'none'
  /** A second screenshot block below the block of text under the card; 'b' is 'a' re-rendered in place, same size, other pixels. The band below a conflict is cut the same way the band above it is, and this is that cut at pixel level. */
  belowShot?: 'a' | 'b'
  /** The first line of the block of text under the card, re-rendered in place: 'b' is the same line, other pixels. It is the first row below the card anything can anchor at, which is a known limitation: see the `belowText` pair below. */
  belowText?: 'a' | 'b'
  /** Squares down the right edge, standing in for a fixed nav rail: they give the page a gutter of its own. */
  rail?: boolean
  /** Line pitch of each column: different pitches make rows of one column fall into the other's line gaps. */
  pitchLeft?: number
  pitchRight?: number
  /** One ink width for every left line instead of one per seed: a hard right edge to the left column, as justified text has. */
  leftWidth?: number
  /** The same for the right column. */
  rightWidth?: number
  /** An 8 px marker beside every right line, at this x: the bullets or icons of a list, which belong to the right column wherever they stand. */
  markerX?: number
}

/** A line of a column: its ink box, and the seed that is its identity. */
export interface ColumnLine extends Box {
  seed: number
}

export interface ColumnsPageManifest {
  width: number
  height: number
  card: Box
  /** The screenshot block: full card width, its text lines cross the columns' gutter. Zero rows high when the card has none. */
  shot: Box
  /** The second screenshot block, below the text under the card, where the page has one. */
  belowShot?: Box
  /** The blank columns between the two text columns (the markers, where there are any, stand right of it). */
  gutter: Range
  /** Where the columns start. */
  gridY: number
  pitchLeft: number
  pitchRight: number
  left: ColumnLine[]
  right: ColumnLine[]
  /** The marker beside each right line, where the page has them. */
  markers: Box[]
}

export interface ColumnsPage {
  image: RasterImage
  manifest: ColumnsPageManifest
}

const COLUMNS_WIDTH = 1040
const COLUMNS_CARD = { x: 80, y: 96, w: 800 }
const COLUMNS_SHOT_H = 300
const COLUMNS_LEFT_X = 104
const COLUMNS_RIGHT_X = 500
/** Line pitch of the columns card, and the height no in-place edit of one line can exceed. */
export const COLUMNS_LINE = 22

/**
 * A project card as a portfolio shows it: a header bar, a card with an app
 * screenshot across its whole width and two text columns below it, a nav
 * rail, and a block of text under the card. A line of the left column ends
 * before x 456 and the right column starts at x 500, so the card has a
 * gutter; the screenshot's lines run across it, as the lines of a real
 * screenshot do. Everything is fillRect: no fonts, no browser.
 */
export function createColumnsPage(options: ColumnsPageOptions): ColumnsPage {
  const pitchLeft = options.pitchLeft ?? COLUMNS_LINE
  const pitchRight = options.pitchRight ?? COLUMNS_LINE
  const shotH = options.shot === 'none' ? 0 : COLUMNS_SHOT_H
  const card = { ...COLUMNS_CARD, h: shotH + 24 + Math.max(options.left.length * pitchLeft, options.right.length * pitchRight) + 24 }
  const gridY = card.y + shotH + 24
  const belowY = card.y + card.h + 32
  const belowShotY = belowY + 120 + 32
  const height = options.belowShot ? belowShotY + COLUMNS_SHOT_H + 40 : belowY + 160 + 40
  const image = createImage(COLUMNS_WIDTH, height, WHITE)
  fillRect(image, { x: 0, y: 0, w: COLUMNS_WIDTH, h: 56 }, HEADER)
  fillRect(image, { x: 24, y: 16, w: 120, h: 24 }, ACCENT)
  fillRect(image, card, CARD)
  const shot = { x: card.x, y: card.y, w: card.w, h: shotH }
  if (shotH) {
    fillRect(image, shot, TITLE)
    fillRect(image, { x: shot.x + 16, y: shot.y + 14, w: 140, h: 12 }, SHOT_TITLE)
    // 'b' re-renders lines 3..10: three quarters of the block's rows change, none of them moves
    for (let i = 0; i < 11; i++) textLine(image, shot.x + 16, shot.y + 40 + i * 23, 600 + ((i * 53) % 160), 9000 + i + (options.shot === 'b' && i >= 3 ? 500 : 0), SHOT_TEXT)
  }
  const column = (seeds: readonly (number | null)[], x: number, pitch: number, width?: number): ColumnLine[] =>
    seeds.flatMap((seed, i) => {
      if (seed === null) return []
      const line = { x, y: gridY + i * pitch, w: width ?? 200 + (seed % 150), h: 10, seed }
      textLine(image, line.x, line.y, line.w, seed)
      return [line]
    })
  const left = column(options.left, COLUMNS_LEFT_X, pitchLeft, options.leftWidth)
  const right = column(options.right, COLUMNS_RIGHT_X, pitchRight, options.rightWidth)
  const markers: Box[] = []
  if (options.markerX !== undefined) {
    for (const line of right) {
      const marker = { x: options.markerX, y: line.y + 1, w: 8, h: 8 }
      fillRect(image, marker, ACCENT)
      markers.push(marker)
    }
  }
  if (options.rail ?? true) {
    for (let i = 0; i < 5; i++) fillRect(image, { x: 936, y: 80 + i * 78, w: 56, h: 56 }, i === 3 ? RAIL_ACTIVE : RAIL)
  }
  fillRect(image, { x: card.x, y: belowY, w: card.w, h: 120 }, LIGHT)
  // 'b' re-renders the first line only: it is the first row below the card anything can anchor at
  for (let i = 0; i < 4; i++) textLine(image, card.x + 24, belowY + 20 + i * COLUMNS_LINE, 620 - i * 60, 7000 + i + (options.belowText === 'b' && i === 0 ? 500 : 0), MUTED)
  const belowShot = options.belowShot ? { x: card.x, y: belowShotY, w: card.w, h: COLUMNS_SHOT_H } : undefined
  if (belowShot) {
    fillRect(image, belowShot, TITLE)
    // as the shot on top of the card: 'b' re-renders lines 3..10, none of them moves
    for (let i = 0; i < 11; i++) textLine(image, belowShot.x + 16, belowShot.y + 40 + i * 23, 600 + ((i * 47) % 160), 8000 + i + (options.belowShot === 'b' && i >= 3 ? 500 : 0), SHOT_TEXT)
  }
  const gutter = { start: COLUMNS_LEFT_X + (options.leftWidth ?? 352), end: options.markerX ?? COLUMNS_RIGHT_X }
  return { image, manifest: { width: COLUMNS_WIDTH, height, card, shot, ...(belowShot ? { belowShot } : {}), gutter, gridY, pitchLeft, pitchRight, left, right, markers } }
}

export interface ColumnChanges {
  /** Each run of new lines, in candidate pixels: as many rows as the column grew by there, line gaps included. */
  added: Box[]
  /** Lines whose content was replaced in place, in baseline pixels. */
  edited: Box[]
}

/**
 * What a candidate column changed, read off the line seeds: the ground
 * truth a comparison of the two pages is held against. A baseline line
 * that is gone where a new one stands was edited in place; any other new
 * line was added. (An edit right beside an addition could be read either
 * way, and no line is ever removed: the pairs below keep to that.)
 */
export function columnChanges(baseline: readonly ColumnLine[], candidate: readonly ColumnLine[], pitch: number): ColumnChanges {
  const kept = new Set(candidate.map((l) => l.seed))
  const changes: ColumnChanges = { added: [], edited: [] }
  let i = 0
  let growing = false
  for (const line of candidate) {
    const old = baseline[i]
    const added = old?.seed !== line.seed && (old === undefined || kept.has(old.seed))
    if (added) {
      const block = changes.added[changes.added.length - 1]
      if (growing && block) {
        block.w = Math.max(block.w, line.w)
        block.h += pitch
      } else changes.added.push({ x: line.x, y: line.y, w: line.w, h: pitch })
    } else {
      if (old!.seed !== line.seed) changes.edited.push({ x: old!.x, y: old!.y, w: Math.max(old!.w, line.w), h: old!.h })
      i++
    }
    growing = added
  }
  return changes
}

// Baseline: the right column is the taller one. Candidate: the left column gains four lines after its seventh
// and two after its tenth and becomes the taller one, so the card grows by three lines; the right column gains
// one line after its third and has four lines edited in place. The last of those four is the column's last
// line, so a changed region ends on the very row that lane's gap begins at: the row a region box must not be
// drawn past, or it covers the gap and the padding that levels the lane (see mapBox in src/viewer/bands.ts).
const LEFT_LINES = [300, 260, 320, 240, 290, 310, 205, 275, 330, 250, 225, 295]
const RIGHT_LINES = [280, 330, 250, 300, 270, 340, 215, 305, 235, 325, 255, 285, 245, 315, 265]
const LEFT_GROWN = [...LEFT_LINES.slice(0, 7), 345, 185, 335, 195, ...LEFT_LINES.slice(7, 10), 165, 355, ...LEFT_LINES.slice(10)]
const RIGHT_EDITED = RIGHT_LINES.map((seed, i) => (i === 1 ? 318 : i === 5 ? 352 : i === 8 ? 221 : i === 14 ? 219 : seed))
const RIGHT_GROWN = [...RIGHT_EDITED.slice(0, 3), 175, ...RIGHT_EDITED.slice(3)]

// A card of plain text, with no screenshot over it. The short column ends
// where the tall one still has lines, so the rows between the two columns'
// changes pair exactly at one offset over the whole width: that run is a
// stable band of its own, and it divides one conflict into parts that have to
// stand on their own (see splitSubstitutedEdges and widenedZones).
const SHORT_LEFT = [300, 260, 320, 240, 290, 310, 205, 275]
const LONG_RIGHT = [280, 330, 250, 300, 270, 340, 215, 305, 235, 325, 255, 285, 245, 315, 265, 235]
const SHORT_LEFT_GROWN = [...SHORT_LEFT.slice(0, 2), 345, ...SHORT_LEFT.slice(2)]
const LONG_RIGHT_GROWN = [...LONG_RIGHT.slice(0, 15), 175, ...LONG_RIGHT.slice(15)]
// The same conflict with the exact run inside a card whose columns are both
// blank there: the left column holds two blocks with six blank line slots
// between them, and the change below the stretch is in the right column.
const BLANK_STRETCH = [...SHORT_LEFT, null, null, null, null, null, null, 225, 295, 165, 355]
const BLANK_STRETCH_GROWN = [...SHORT_LEFT.slice(0, 1), 345, ...SHORT_LEFT.slice(1), null, null, null, null, null, null, 225, 295, 165, 355]
const STRETCH_RIGHT = [280, 330, 250, 300, 270, 340, 215, 305, 235, 325, 255, 285, 245, 315, 265, 235, 195, 375]
const STRETCH_RIGHT_GROWN = [...STRETCH_RIGHT.slice(0, 14), 175, ...STRETCH_RIGHT.slice(14)]
// Markers of the right column that stand nearer the left column's text (22 px)
// than their own (30 px); every left line is the same width, so the left
// column ends in a hard edge at 440 and the two gutters are of a size.
const MARKER_X = 462
const MARKER_LEFT_WIDTH = 336
const MARKER_LEFT_GROWN = [...LEFT_LINES.slice(0, 7), 345, 185, 335, 195, ...LEFT_LINES.slice(7)]
const MARKER_RIGHT_GROWN = [...RIGHT_LINES.slice(0, 3), 175, ...RIGHT_LINES.slice(3)]

// A card whose two columns break their paragraphs on different rows: over one
// stretch only the left column has ink, over the next only the right. Rows of
// the first stretch pair at the left column's offset and rows of the second at
// the right column's, so the row alignment alternates between them - a run of
// inserted rows, then a run of deleted rows, each across the whole card. That
// is the symptom the defect showed on the real page, and no other pair here
// can produce it: everywhere else both columns have ink on every line row, so
// the two offsets are never further apart than the growth. Every left line is
// drawn to one width, so a stretch where the left column is blank still leaves
// the card's own gutter and nothing wider.
const STAGGERED_WIDTH = 352
const STAGGERED_LEFT = [300, 260, null, 320, 240, 290, null, null, null, 310, 205, 275, null, null, null, 330, 250, 225, 295]
const STAGGERED_RIGHT = [280, 330, null, null, null, null, 250, 300, 270, null, null, null, 340, 215, 305, null, 235, 325, 255]
const STAGGERED_RIGHT_EDITED = STAGGERED_RIGHT.map((seed, i) => (i === 1 ? 318 : i === 8 ? 352 : i === 17 ? 221 : seed))
const STAGGERED_RIGHT_GROWN = [...STAGGERED_RIGHT_EDITED.slice(0, 7), 175, ...STAGGERED_RIGHT_EDITED.slice(7)]
// The left column gains one line inside one paragraph and two at the end of
// another. Neither new line touches a paragraph gap: a block that begins or
// ends on blank rows can be read a line higher or lower, and the ground truth
// then says one thing and the report another for no fault of the alignment.
const STAGGERED_LEFT_GROWN = [...STAGGERED_LEFT.slice(0, 11), 335, ...STAGGERED_LEFT.slice(11, 16), 345, 185, ...STAGGERED_LEFT.slice(16)]

// Two panes, one of them nearly empty: an editor beside a list, a preview
// beside a form. The left pane holds one block of text low down and nothing
// else; the narrow right pane is a column of rows with a blank slot reserved at
// its foot. The candidate inserts one row near the top of the right pane and
// takes the reserved slot up, so the card, and with it the page, is exactly as
// tall as before: the rows under the insertion pair one line lower, the rows
// under the reserved slot pair where they always did, and the left pane's
// block, which never moved, lies across the boundary between the two.
//
// Between the insertion and that block the left pane is blank and the right
// pane only moved, so 110 rows pair exactly there. That run ends the conflict
// zone in the middle of the conflict (see splitSubstitutedEdges): the block
// below it keeps a zone of its own and finds the two panes' gutter, while the
// insertion above it is left with no zone at all and is reported as a block of
// rows added across the whole page - over a pane in which not one pixel
// changed. The pixels cannot see that harm, because an empty pane holds no
// content to mis-pair: they vote for the parts, and only the full-width
// one-sided band tells the two answers apart (see laneAlign's `stripes`).
const PANE_LEFT = [null, null, null, null, null, null, null, null, 410, 420, 430, 440, 450, null, null, null]
const PANE_RIGHT = [280, 330, 250, 300, 270, 340, 215, 305, 235, 325, 255, 285, 245, 315, 265, null]
const PANE_RIGHT_GROWN = [280, 330, 175, 250, 300, 270, 340, 215, 305, 235, 325, 255, 285, 245, 315, 265]
/** Both panes are drawn to one width, so the gutter between them is the page's only one and neither pane's lane depends on which line happens to be the longest. */
const PANE_LEFT_WIDTH = 352
const PANE_RIGHT_WIDTH = 100

export type ColumnsPair = 'grown' | 'control' | 'leftOnly' | 'stripes' | 'pitches' | 'noRail' | 'noShot' | 'blankStretch' | 'markers' | 'belowShot' | 'belowText' | 'emptyPane'

/**
 * Pairs of the columns page, as [baseline, candidate]. Where the card has a
 * screenshot and the candidate redraws it in place, the rows above the
 * columns come out less than 90% exact: that, and nothing about the columns,
 * is what used to let the conflict zone climb to the top of the page and
 * miss the card's gutter. The pairs of plain text (`shot: 'none'`) put a
 * zone of the same wrong height there by another road.
 */
export const COLUMNS_PAIRS: Record<ColumnsPair, [ColumnsPageOptions, ColumnsPageOptions]> = {
  /** Both columns move, by different amounts. */
  grown: [{ left: LEFT_LINES, right: RIGHT_LINES }, { left: LEFT_GROWN, right: RIGHT_GROWN, shot: 'b' }],
  /** The same with the screenshot left alone: this always worked, so the pair above fails for the screenshot's sake only. */
  control: [{ left: LEFT_LINES, right: RIGHT_LINES }, { left: LEFT_GROWN, right: RIGHT_GROWN }],
  /** Only the left column grows: full-width rows find no anchor, and the growth used to land at the card's bottom. */
  leftOnly: [{ left: LEFT_LINES, right: RIGHT_LINES }, { left: LEFT_GROWN, right: RIGHT_LINES, shot: 'b' }],
  /** Paragraphs that break on different rows in the two columns, so the rows of the card anchor at two offsets in turn: this is the pair that gives full-width stripes of added AND removed rows when the columns are not separated. The committed A6 fixture is drawn from it. */
  stripes: [
    { left: STAGGERED_LEFT, right: STAGGERED_RIGHT, leftWidth: STAGGERED_WIDTH },
    { left: STAGGERED_LEFT_GROWN, right: STAGGERED_RIGHT_GROWN, shot: 'b', leftWidth: STAGGERED_WIDTH },
  ],
  /** Line pitch 24 left and 19 right: the two columns' lines interleave, and a line of one column shares its rows with two of the other. */
  pitches: [
    { left: LEFT_LINES, right: [...RIGHT_LINES, 301, 333], pitchLeft: 24, pitchRight: 19 },
    { left: LEFT_GROWN, right: [...RIGHT_GROWN, 301, 333], shot: 'b', pitchLeft: 24, pitchRight: 19 },
  ],
  /** No nav rail, so no page-level gutter either: there used to be no lanes at all. */
  noRail: [{ left: LEFT_LINES, right: RIGHT_LINES, rail: false }, { left: LEFT_GROWN, right: RIGHT_GROWN, shot: 'b', rail: false }],
  /** No screenshot: the short left column ends 8 lines above the tall right one, so a run of exact rows sits between the two columns' new lines and cuts the conflict in two. */
  noShot: [{ left: SHORT_LEFT, right: LONG_RIGHT, shot: 'none' }, { left: SHORT_LEFT_GROWN, right: LONG_RIGHT_GROWN, shot: 'none' }],
  /** The same, with the run of exact rows inside the card: both columns are blank over six line slots, and each column changed on one side of them. */
  blankStretch: [{ left: BLANK_STRETCH, right: STRETCH_RIGHT, shot: 'none' }, { left: BLANK_STRETCH_GROWN, right: STRETCH_RIGHT_GROWN, shot: 'none' }],
  /** A second picture under the card, redrawn in place: the band below the conflict is as unsettled as the band above it, and the zone must end above it rather than run to the foot of the page. */
  belowShot: [
    { left: LEFT_LINES, right: RIGHT_LINES, belowShot: 'a' },
    { left: LEFT_GROWN, right: RIGHT_GROWN, shot: 'b', belowShot: 'b' },
  ],
  /** The control, with the first line of the text under the card redrawn in place as well. A known limitation: nothing anchors between the card's foot and that line, the insertion floats past it, and the columns stay in one lane. */
  belowText: [
    { left: LEFT_LINES, right: RIGHT_LINES },
    { left: LEFT_GROWN, right: RIGHT_GROWN, belowText: 'b' },
  ],
  /** A list's markers, nearer the left column's text than their own: the lane cut belongs in the gutter, not between a marker and its line. */
  markers: [
    { left: LEFT_LINES, right: RIGHT_LINES, shot: 'none', leftWidth: MARKER_LEFT_WIDTH, markerX: MARKER_X },
    { left: MARKER_LEFT_GROWN, right: MARKER_RIGHT_GROWN, shot: 'none', leftWidth: MARKER_LEFT_WIDTH, markerX: MARKER_X },
  ],
  /** A pane that is empty where the growth beside it is reported: the cut orphans the insertion, and the pixels prefer the answer that lays it across the empty pane. */
  emptyPane: [
    { left: PANE_LEFT, right: PANE_RIGHT, shot: 'none', rail: false, leftWidth: PANE_LEFT_WIDTH, rightWidth: PANE_RIGHT_WIDTH },
    { left: PANE_LEFT, right: PANE_RIGHT_GROWN, shot: 'none', rail: false, leftWidth: PANE_LEFT_WIDTH, rightWidth: PANE_RIGHT_WIDTH },
  ],
}
