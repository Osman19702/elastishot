/**
 * What to paint under a gap in the aligned row space. A gap has no pixels
 * of its own: the viewer's background showing through is a bright bar on a
 * dark page, and the row next to the gap stretched over it is a barcode
 * when that row holds text. So each column of the gap takes the colour
 * that column shows most often in the rows around the gap, see
 * core/column-modes.ts. This is the fallback for a page without a gaps
 * image (artifacts.gapFills); it reads the image's pixels, which a report
 * opened from file:// is not allowed to.
 */

import { columnModes, SAMPLE_ROWS } from '../core/column-modes.ts'

export { columnModes, SAMPLE_ROWS }

export type GapFill = { kind: 'colours'; data: Uint8ClampedArray<ArrayBuffer> } | { kind: 'row'; y: number } | { kind: 'none' }

/**
 * `readRow(y)` returns the RGBA pixels of image row y over the lane, or null
 * when the row is outside the image or cannot be read. `above` is the last
 * row before the gap, `below` the first after it, -1 when there is none.
 */
export function pickGapFill(readRow: (y: number) => ArrayLike<number> | null, imageHeight: number, above: number, below: number): GapFill {
  const rows: ArrayLike<number>[] = []
  for (let k = 0; k < SAMPLE_ROWS; k++) {
    const y = above - k
    if (above < 0 || y < 0) break
    const d = readRow(y)
    if (d?.length) rows.push(d)
  }
  for (let k = 0; k < SAMPLE_ROWS; k++) {
    const y = below + k
    if (below < 0 || y >= imageHeight) break
    const d = readRow(y)
    if (d?.length) rows.push(d)
  }
  if (rows.length) return { kind: 'colours', data: columnModes(rows) }
  // the pixels cannot be read (a cross-origin image): the row itself, stretched
  const y = above >= 0 ? above : below
  return y >= 0 && y < imageHeight ? { kind: 'row', y } : { kind: 'none' }
}
