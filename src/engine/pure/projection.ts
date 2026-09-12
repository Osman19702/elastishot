/**
 * 1-D projection profiles and normalised cross-correlation: the feature-free
 * fallback aligner and the sub-strip offset refinement.
 */

/** Mean value per row of a single-channel byte image. */
export function rowProfile(data: ArrayLike<number>, width: number, height: number): Float32Array {
  const out = new Float32Array(height)
  for (let y = 0; y < height; y++) {
    let sum = 0
    const base = y * width
    for (let x = 0; x < width; x++) sum += data[base + x]!
    out[y] = sum / width
  }
  return out
}

/** Mean value per column of a single-channel byte image. */
export function colProfile(data: ArrayLike<number>, width: number, height: number): Float32Array {
  const out = new Float32Array(width)
  for (let y = 0; y < height; y++) {
    const base = y * width
    for (let x = 0; x < width; x++) out[x] += data[base + x]!
  }
  for (let x = 0; x < width; x++) out[x] /= height
  return out
}

/** Zero-mean normalised cross-correlation of two equally long windows; 0 when either is flat. */
export function ncc(a: ArrayLike<number>, aStart: number, b: ArrayLike<number>, bStart: number, length: number): number {
  if (length <= 1) return 0
  let ma = 0
  let mb = 0
  for (let k = 0; k < length; k++) {
    ma += a[aStart + k]!
    mb += b[bStart + k]!
  }
  ma /= length
  mb /= length
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let k = 0; k < length; k++) {
    const da = a[aStart + k]! - ma
    const db = b[bStart + k]! - mb
    sab += da * db
    saa += da * da
    sbb += db * db
  }
  if (saa < 1e-9 || sbb < 1e-9) return 0
  return sab / Math.sqrt(saa * sbb)
}

export interface ShiftResult {
  /** Offset to add to b's coordinates so it lands in a's frame: a[i] ~ b[i - shift]. */
  shift: number
  ncc: number
}

/**
 * Find the shift of `b` relative to `a` with the best correlation, searching
 * [-maxShift, maxShift] and requiring the overlap to cover at least
 * `minOverlap` of the shorter profile.
 */
export function bestShift(a: Float32Array, b: Float32Array, maxShift: number, minOverlap = 0.5): ShiftResult {
  const shorter = Math.min(a.length, b.length)
  const need = Math.max(2, Math.floor(shorter * minOverlap))
  let best: ShiftResult = { shift: 0, ncc: -1 }
  for (let d = -maxShift; d <= maxShift; d++) {
    const start = Math.max(0, d)
    const end = Math.min(a.length, b.length + d)
    const len = end - start
    if (len < need) continue
    const c = ncc(a, start, b, start - d, len)
    if (c > best.ncc) best = { shift: d, ncc: c }
  }
  return best
}
