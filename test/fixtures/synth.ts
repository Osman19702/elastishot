/**
 * Deterministic synthetic pages for engine tests and fixture generation.
 *
 * A page is a header bar, N section cards with a title block and rows of
 * text-like blocks, and a footer. The blocks have plenty of corners for ORB
 * and look like text to the strip signatures, so the engine sees something
 * close to a real screenshot without any binary fixtures.
 */
import { blit, cloneImage, createImage, cropImage, fillRect, resizeImage, type RGBA, WHITE } from '../../src/core/image.ts'
import type { Box, Point, RasterImage } from '../../src/core/types.ts'

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
