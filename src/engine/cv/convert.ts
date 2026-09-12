import { ElastishotError } from '../../core/errors.ts'
import type { RasterImage } from '../../core/types.ts'
import type { CV, Mat } from './cv-types.ts'
import type { MatScope } from './mat-scope.ts'

/** RGBA image -> CV_8UC4 Mat (copies the bytes into WASM memory). */
export function imageToMat(scope: MatScope, img: RasterImage): Mat {
  return scope.fromArray(img.height, img.width, scope.cv.CV_8UC4, img.data)
}

/** CV_8UC4 or CV_8UC1 Mat -> RGBA image (copies the bytes out of WASM memory). */
export function matToImage(cv: CV, mat: Mat): RasterImage {
  const width = mat.cols
  const height = mat.rows
  const channels = mat.channels()
  if (!mat.isContinuous()) throw new ElastishotError('E_STAGE', 'matToImage needs a continuous Mat')
  if (channels === 4) {
    return { width, height, data: new Uint8ClampedArray(mat.data) }
  }
  if (channels === 1) {
    const src = mat.data
    const data = new Uint8ClampedArray(width * height * 4)
    for (let p = 0, i = 0; p < src.length; p++, i += 4) {
      data[i] = data[i + 1] = data[i + 2] = src[p]!
      data[i + 3] = 255
    }
    return { width, height, data }
  }
  throw new ElastishotError('E_STAGE', `matToImage: unsupported channel count ${channels} (type ${mat.type()}, cv.CV_8UC4 is ${cv.CV_8UC4})`)
}

/** Row range of a Mat as a continuous view (full width, rows [y0, y1)). */
export function rowRange(scope: MatScope, mat: Mat, y0: number, y1: number): Mat {
  return scope.track(mat.roi(new scope.cv.Rect(0, y0, mat.cols, y1 - y0)))
}

/** Pixel bytes of a single-channel continuous Mat, copied out. */
export function grayBytes(mat: Mat): Uint8Array {
  return new Uint8Array(mat.data)
}
