import { ElastishotError } from './errors.ts'
import { clampBox, roundOutward } from './geometry.ts'
import type { Box, ImageDescriptor, RasterImage } from './types.ts'

export type RGBA = [number, number, number, number]

export const MAX_PIXELS = 40_000_000

export const WHITE: RGBA = [255, 255, 255, 255]
export const TRANSPARENT: RGBA = [0, 0, 0, 0]

function assertSize(width: number, height: number, what: string): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new ElastishotError('E_IMAGE_INVALID', `${what}: invalid size ${width}x${height}`)
  }
  if (width * height > MAX_PIXELS) {
    throw new ElastishotError('E_IMAGE_INVALID', `${what}: ${width}x${height} exceeds ${MAX_PIXELS} pixels`)
  }
}

/** Wrap RGBA bytes as an image without copying them. */
export function fromRGBA(
  width: number,
  height: number,
  data: Uint8ClampedArray | Uint8Array | ArrayBuffer,
  source?: ImageDescriptor,
): RasterImage {
  assertSize(width, height, 'image')
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8ClampedArray(data)
      : data instanceof Uint8ClampedArray
        ? data
        : new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
  const expected = width * height * 4
  if (bytes.length !== expected) {
    throw new ElastishotError('E_IMAGE_INVALID', `expected ${expected} bytes of RGBA for ${width}x${height}, got ${bytes.length}`)
  }
  return source ? { width, height, data: bytes, source } : { width, height, data: bytes }
}

export function createImage(width: number, height: number, fill: RGBA = WHITE, source?: ImageDescriptor): RasterImage {
  assertSize(width, height, 'image')
  const data = new Uint8ClampedArray(width * height * 4)
  if (fill[0] || fill[1] || fill[2] || fill[3]) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0]
      data[i + 1] = fill[1]
      data[i + 2] = fill[2]
      data[i + 3] = fill[3]
    }
  }
  return source ? { width, height, data, source } : { width, height, data }
}

export function cloneImage(img: RasterImage): RasterImage {
  return { ...img, data: new Uint8ClampedArray(img.data) }
}

export function getPixel(img: RasterImage, x: number, y: number): RGBA {
  const i = (y * img.width + x) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!]
}

export function setPixel(img: RasterImage, x: number, y: number, rgba: RGBA): void {
  const i = (y * img.width + x) * 4
  img.data[i] = rgba[0]
  img.data[i + 1] = rgba[1]
  img.data[i + 2] = rgba[2]
  img.data[i + 3] = rgba[3]
}

/** Fill a box in place; the box is clipped to the image. */
export function fillRect(img: RasterImage, box: Box, rgba: RGBA): void {
  const c = clampBox(roundOutward(box), img)
  if (!c) return
  for (let y = c.y; y < c.y + c.h; y++) {
    let i = (y * img.width + c.x) * 4
    for (let x = 0; x < c.w; x++, i += 4) {
      img.data[i] = rgba[0]
      img.data[i + 1] = rgba[1]
      img.data[i + 2] = rgba[2]
      img.data[i + 3] = rgba[3]
    }
  }
}

/** Draw a rectangle outline in place, `thickness` pixels wide, clipped to the image. */
export function strokeRect(img: RasterImage, box: Box, rgba: RGBA, thickness = 2): void {
  const b = roundOutward(box)
  fillRect(img, { x: b.x, y: b.y, w: b.w, h: thickness }, rgba)
  fillRect(img, { x: b.x, y: b.y + b.h - thickness, w: b.w, h: thickness }, rgba)
  fillRect(img, { x: b.x, y: b.y, w: thickness, h: b.h }, rgba)
  fillRect(img, { x: b.x + b.w - thickness, y: b.y, w: thickness, h: b.h }, rgba)
}

/** Copy `src` onto `dst` at (x, y) without blending; clipped to `dst`. */
export function blit(dst: RasterImage, src: RasterImage, x: number, y: number): void {
  const x0 = Math.max(0, x)
  const y0 = Math.max(0, y)
  const x1 = Math.min(dst.width, x + src.width)
  const y1 = Math.min(dst.height, y + src.height)
  if (x1 <= x0 || y1 <= y0) return
  const rowBytes = (x1 - x0) * 4
  for (let yy = y0; yy < y1; yy++) {
    const s = ((yy - y) * src.width + (x0 - x)) * 4
    const d = (yy * dst.width + x0) * 4
    dst.data.set(src.data.subarray(s, s + rowBytes), d)
  }
}

export function cropImage(img: RasterImage, box: Box): RasterImage {
  const c = clampBox(roundOutward(box), img)
  if (!c) throw new ElastishotError('E_IMAGE_INVALID', 'crop box lies outside the image')
  const out = createImage(c.w, c.h, TRANSPARENT)
  const rowBytes = c.w * 4
  for (let y = 0; y < c.h; y++) {
    const s = ((c.y + y) * img.width + c.x) * 4
    out.data.set(img.data.subarray(s, s + rowBytes), y * rowBytes)
  }
  return out
}

/** Area-average when shrinking, bilinear when enlarging. */
export function resizeImage(img: RasterImage, width: number, height: number): RasterImage {
  assertSize(width, height, 'resize target')
  if (width === img.width && height === img.height) return cloneImage(img)
  const out = new Uint8ClampedArray(width * height * 4)
  if (width <= img.width && height <= img.height) areaAverage(img, out, width, height)
  else bilinear(img, out, width, height)
  return img.source ? { width, height, data: out, source: img.source } : { width, height, data: out }
}

function areaAverage(src: RasterImage, out: Uint8ClampedArray, width: number, height: number): void {
  const sx = src.width / width
  const sy = src.height / height
  const d = src.data
  for (let oy = 0; oy < height; oy++) {
    const y0 = oy * sy
    const y1 = (oy + 1) * sy
    const iy0 = Math.floor(y0)
    const iy1 = Math.min(src.height, Math.ceil(y1))
    for (let ox = 0; ox < width; ox++) {
      const x0 = ox * sx
      const x1 = (ox + 1) * sx
      const ix0 = Math.floor(x0)
      const ix1 = Math.min(src.width, Math.ceil(x1))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let wsum = 0
      for (let iy = iy0; iy < iy1; iy++) {
        const wy = Math.min(iy + 1, y1) - Math.max(iy, y0)
        if (wy <= 0) continue
        for (let ix = ix0; ix < ix1; ix++) {
          const wx = Math.min(ix + 1, x1) - Math.max(ix, x0)
          if (wx <= 0) continue
          const w = wx * wy
          const i = (iy * src.width + ix) * 4
          r += d[i]! * w
          g += d[i + 1]! * w
          b += d[i + 2]! * w
          a += d[i + 3]! * w
          wsum += w
        }
      }
      const o = (oy * width + ox) * 4
      if (wsum > 0) {
        out[o] = r / wsum
        out[o + 1] = g / wsum
        out[o + 2] = b / wsum
        out[o + 3] = a / wsum
      }
    }
  }
}

function bilinear(src: RasterImage, out: Uint8ClampedArray, width: number, height: number): void {
  const sx = src.width / width
  const sy = src.height / height
  const d = src.data
  const maxX = src.width - 1
  const maxY = src.height - 1
  for (let oy = 0; oy < height; oy++) {
    const fy = Math.min(Math.max((oy + 0.5) * sy - 0.5, 0), maxY)
    const y0 = Math.floor(fy)
    const y1 = Math.min(y0 + 1, maxY)
    const ty = fy - y0
    for (let ox = 0; ox < width; ox++) {
      const fx = Math.min(Math.max((ox + 0.5) * sx - 0.5, 0), maxX)
      const x0 = Math.floor(fx)
      const x1 = Math.min(x0 + 1, maxX)
      const tx = fx - x0
      const i00 = (y0 * src.width + x0) * 4
      const i10 = (y0 * src.width + x1) * 4
      const i01 = (y1 * src.width + x0) * 4
      const i11 = (y1 * src.width + x1) * 4
      const o = (oy * width + ox) * 4
      for (let c = 0; c < 4; c++) {
        const top = d[i00 + c]! * (1 - tx) + d[i10 + c]! * tx
        const bottom = d[i01 + c]! * (1 - tx) + d[i11 + c]! * tx
        out[o + c] = top * (1 - ty) + bottom * ty
      }
    }
  }
}

export function isOpaque(img: RasterImage): boolean {
  const d = img.data
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return false
  return true
}

/** Composite over an opaque background; returns the input when already opaque. */
export function flattenAlpha(img: RasterImage, background: [number, number, number] = [255, 255, 255]): RasterImage {
  if (isOpaque(img)) return img
  const out = cloneImage(img)
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]!
    if (a === 255) continue
    const inv = 255 - a
    d[i] = (d[i]! * a + background[0] * inv) / 255
    d[i + 1] = (d[i + 1]! * a + background[1] * inv) / 255
    d[i + 2] = (d[i + 2]! * a + background[2] * inv) / 255
    d[i + 3] = 255
  }
  return out
}

/** BT.601 luma, one byte per pixel. */
export function toGrayscale(img: RasterImage): Uint8ClampedArray {
  const out = new Uint8ClampedArray(img.width * img.height)
  const d = img.data
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    out[p] = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!
  }
  return out
}

export function imagesEqual(a: RasterImage, b: RasterImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false
  const da = a.data
  const db = b.data
  for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) return false
  return true
}
