/**
 * The colour each column shows most often over a few rows: what to paint
 * under a gap of the aligned row space. A gap has no pixels of its own; the
 * viewer's background showing through would be a bright bar on a dark page,
 * and one neighbouring row stretched over the gap is a barcode when that
 * row holds text. Over enough rows text is a minority in every column, so
 * the mode keeps the page and card backgrounds and a border that runs down
 * the lane, and drops the text.
 */

/** Rows sampled on each side of a gap. */
export const SAMPLE_ROWS = 48

/**
 * One RGBA row, one colour per column: the most common colour of that
 * column over the given RGBA rows, quantised to 32 levels per channel to
 * group antialiasing and then averaged so a flat background keeps its exact
 * value. All rows must have the same length.
 */
export function columnModes(rows: ReadonlyArray<ArrayLike<number>>): Uint8ClampedArray<ArrayBuffer> {
  const width = rows.length ? rows[0]!.length >> 2 : 0
  const out = new Uint8ClampedArray(width * 4)
  const counts = new Map<number, [number, number, number, number]>()
  for (let x = 0; x < width; x++) {
    counts.clear()
    for (const d of rows) {
      const i = x * 4
      const r = d[i]!
      const g = d[i + 1]!
      const b = d[i + 2]!
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
      const c = counts.get(key)
      if (c) {
        c[0]++
        c[1] += r
        c[2] += g
        c[3] += b
      } else counts.set(key, [1, r, g, b])
    }
    let best: [number, number, number, number] | null = null
    for (const c of counts.values()) if (!best || c[0] > best[0]) best = c
    if (best) {
      out[x * 4] = Math.round(best[1] / best[0])
      out[x * 4 + 1] = Math.round(best[2] / best[0])
      out[x * 4 + 2] = Math.round(best[3] / best[0])
      out[x * 4 + 3] = 255
    }
  }
  return out
}

/**
 * The rows around a gap, as views into an RGBA buffer of `width` columns:
 * up to SAMPLE_ROWS rows above `at` (the first row of the gap) down to
 * `top`, and up to SAMPLE_ROWS rows from `at` up to `bottom` (exclusive).
 */
export function rowsAround(data: Uint8Array | Uint8ClampedArray, width: number, top: number, bottom: number, at: number): Array<Uint8Array | Uint8ClampedArray> {
  const rows: Array<Uint8Array | Uint8ClampedArray> = []
  const stride = width * 4
  for (let k = 1; k <= SAMPLE_ROWS; k++) {
    const y = at - k
    if (y < top) break
    rows.push(data.subarray(y * stride, (y + 1) * stride))
  }
  for (let k = 0; k < SAMPLE_ROWS; k++) {
    const y = at + k
    if (y >= bottom) break
    rows.push(data.subarray(y * stride, (y + 1) * stride))
  }
  return rows
}
