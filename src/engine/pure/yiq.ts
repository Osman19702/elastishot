/**
 * pixelmatch's perceptual colour distance (YIQ space, Kotsarenko & Ramos).
 * Pure JS over RGBA byte arrays so the same code runs on Mat data and on
 * plain images.
 */

export const YIQ_MAX_DELTA = 35215

function rgb2y(r: number, g: number, b: number): number {
  return r * 0.29889531 + g * 0.58662247 + b * 0.11448223
}
function rgb2i(r: number, g: number, b: number): number {
  return r * 0.59597799 - g * 0.2741761 - b * 0.32180189
}
function rgb2q(r: number, g: number, b: number): number {
  return r * 0.21147017 - g * 0.52261711 + b * 0.31114694
}
function blend(c: number, a: number): number {
  return 255 + (c - 255) * a
}

/** Distance 0..35215 between pixel at byte offset `ai` of `a` and `bi` of `b`. */
export function colorDelta(a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number): number {
  let r1 = a[ai]!
  let g1 = a[ai + 1]!
  let b1 = a[ai + 2]!
  let a1 = a[ai + 3]!
  let r2 = b[bi]!
  let g2 = b[bi + 1]!
  let b2 = b[bi + 2]!
  let a2 = b[bi + 3]!
  if (a1 === a2 && r1 === r2 && g1 === g2 && b1 === b2) return 0
  if (a1 < 255) {
    a1 /= 255
    r1 = blend(r1, a1)
    g1 = blend(g1, a1)
    b1 = blend(b1, a1)
  }
  if (a2 < 255) {
    a2 /= 255
    r2 = blend(r2, a2)
    g2 = blend(g2, a2)
    b2 = blend(b2, a2)
  }
  const y = rgb2y(r1, g1, b1) - rgb2y(r2, g2, b2)
  const i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2)
  const q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2)
  return 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q
}

/** True when some pixel of `other` within `radius` of (x, y) is close to pixel `si` of `src`. */
function nearMatch(
  src: ArrayLike<number>,
  si: number,
  other: ArrayLike<number>,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  max: number,
): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    const yy = y + dy
    if (yy < 0 || yy >= height) continue
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue
      const xx = x + dx
      if (xx < 0 || xx >= width) continue
      if (colorDelta(src, si, other, (yy * width + xx) * 4) <= max) return true
    }
  }
  return false
}

const OPPOSITE: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
]
const BLEND_STEPS = [0.25, 0.5, 0.75]
const mix = new Float64Array(4)

/**
 * True when pixel `si` of `src` looks like a resampling blend of two
 * opposite neighbours of (x, y) in `other`, which is what an edge that moved
 * by a fraction of a pixel produces.
 */
function blendMatch(src: ArrayLike<number>, si: number, other: ArrayLike<number>, x: number, y: number, width: number, height: number, max: number): boolean {
  for (const [dx, dy] of OPPOSITE) {
    const x1 = x + dx
    const y1 = y + dy
    const x2 = x - dx
    const y2 = y - dy
    if (x1 < 0 || x2 < 0 || y1 < 0 || y2 < 0 || x1 >= width || x2 >= width || y1 >= height || y2 >= height) continue
    const i1 = (y1 * width + x1) * 4
    const i2 = (y2 * width + x2) * 4
    for (const t of BLEND_STEPS) {
      for (let c = 0; c < 4; c++) mix[c] = other[i1 + c]! * t + other[i2 + c]! * (1 - t)
      if (colorDelta(src, si, mix, 0) <= max) return true
    }
  }
  return false
}

export interface PixelDiff {
  /** 255 where the pixel changed. */
  mask: Uint8Array
  /** Normalised distance 0..1, only filled where the mask is set. */
  delta: Float32Array
  changed: number
}

/**
 * Per-pixel change mask for two same-sized RGBA buffers. `threshold` is the
 * pixelmatch threshold (0..1); pixels where `coverage` is below 255 are
 * skipped. With `radius` > 0 a pixel is tolerated when, in both directions,
 * it matches a pixel within that many pixels in the other image or a blend
 * of two opposite neighbours there; this absorbs antialiasing and the
 * sub-pixel shifts that resampling produces.
 */
export function pixelDiff(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  width: number,
  height: number,
  threshold: number,
  coverage?: ArrayLike<number> | null,
  radius = 0,
): PixelDiff {
  const n = width * height
  const mask = new Uint8Array(n)
  const delta = new Float32Array(n)
  const max = YIQ_MAX_DELTA * threshold * threshold
  let changed = 0
  for (let y = 0, p = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, p++, i += 4) {
      if (coverage && coverage[p]! < 255) continue
      const d = colorDelta(a, i, b, i)
      if (d <= max) continue
      if (
        radius > 0 &&
        (nearMatch(a, i, b, x, y, width, height, radius, max) || blendMatch(a, i, b, x, y, width, height, max)) &&
        (nearMatch(b, i, a, x, y, width, height, radius, max) || blendMatch(b, i, a, x, y, width, height, max))
      ) {
        continue
      }
      mask[p] = 255
      delta[p] = Math.min(1, d / YIQ_MAX_DELTA)
      changed++
    }
  }
  return { mask, delta, changed }
}
