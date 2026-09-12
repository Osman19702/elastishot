import type { Box } from '../../core/types.ts'
import type { CV, Mat } from './cv-types.ts'
import type { MatScope } from './mat-scope.ts'

export interface CvScope {
  cv: CV
  mats: MatScope
}

/** 8UC1 edge strength: 0.5·|Sobel x| + 0.5·|Sobel y|. */
export function edgeMagnitude({ cv, mats }: CvScope, gray: Mat): Mat {
  const gx = mats.mat()
  const gy = mats.mat()
  const ax = mats.mat()
  const ay = mats.mat()
  cv.Sobel(gray, gx, cv.CV_16S, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT)
  cv.Sobel(gray, gy, cv.CV_16S, 0, 1, 3, 1, 0, cv.BORDER_DEFAULT)
  cv.convertScaleAbs(gx, ax, 1, 0)
  cv.convertScaleAbs(gy, ay, 1, 0)
  const out = mats.mat()
  cv.addWeighted(ax, 0.5, ay, 0.5, 0, out, -1)
  for (const m of [gx, gy, ax, ay]) mats.release(m)
  return out
}

/** Clip a box to a Mat; null when nothing remains. */
export function clipToMat(box: Box, mat: Mat): Box | null {
  const x = Math.max(0, Math.floor(box.x))
  const y = Math.max(0, Math.floor(box.y))
  const right = Math.min(mat.cols, Math.ceil(box.x + box.w))
  const bottom = Math.min(mat.rows, Math.ceil(box.y + box.h))
  if (right <= x || bottom <= y) return null
  return { x, y, w: right - x, h: bottom - y }
}

/** ROI view of a Mat for an integer box (tracked). */
export function roi({ cv, mats }: CvScope, mat: Mat, box: Box): Mat {
  return mats.track(mat.roi(new cv.Rect(box.x, box.y, box.w, box.h)))
}

/** Mean edge strength per row of an 8UC1 Mat over rows [y0, y1). */
export function rowEnergy(mat: Mat, y0: number, y1: number): Float32Array {
  const data = mat.data
  const w = mat.cols
  const out = new Float32Array(y1 - y0)
  for (let y = y0; y < y1; y++) {
    let sum = 0
    const base = y * w
    for (let x = 0; x < w; x++) sum += data[base + x]!
    out[y - y0] = sum / w
  }
  return out
}

/** Mean edge strength per column of an 8UC1 Mat over rows [y0, y1). */
export function colEnergy(mat: Mat, y0: number, y1: number): Float32Array {
  const data = mat.data
  const w = mat.cols
  const out = new Float32Array(w)
  for (let y = y0; y < y1; y++) {
    const base = y * w
    for (let x = 0; x < w; x++) out[x] += data[base + x]!
  }
  const h = Math.max(1, y1 - y0)
  for (let x = 0; x < w; x++) out[x] /= h
  return out
}
