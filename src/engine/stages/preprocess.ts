import { flattenAlpha, isOpaque } from '../../core/image.ts'
import type { RasterImage } from '../../core/types.ts'
import { imageToMat } from '../cv/convert.ts'
import type { PreprocessInput, PreprocessOutput, Prepped } from '../model.ts'
import type { Stage, StageContext } from '../stage.ts'

/** Below this working size feature alignment is pointless. */
export const MIN_WORKING_SIDE = 32

/** Pairs of one width up to this are compared at their own size, so unchanged rows stay the same bytes. */
export const SAME_WIDTH_FULL = 1920

/**
 * Both images are brought to the same working width: the smaller of the two
 * widths and the configured workingWidth. Nothing is ever upscaled, and equal
 * widths mean the aligner only has to recover a residual scale near 1. A pair
 * of the same width, as two captures of one viewport are, is not downscaled
 * at all up to SAME_WIDTH_FULL: resampling would turn every whole-pixel
 * shift below an inserted block into a fraction of a pixel.
 */
export function workingScales(baselineWidth: number, candidateWidth: number, workingWidth: number): { baseline: number; candidate: number } {
  if (workingWidth === 0) return { baseline: 1, candidate: 1 }
  if (baselineWidth === candidateWidth && baselineWidth <= SAME_WIDTH_FULL) return { baseline: 1, candidate: 1 }
  const w = Math.min(baselineWidth, candidateWidth, workingWidth)
  return { baseline: w / baselineWidth, candidate: w / candidateWidth }
}

function prep(ctx: StageContext, img: RasterImage, scale: number, side: 'baseline' | 'candidate'): Prepped {
  const { cv, mats } = ctx
  let source = img
  if (!isOpaque(img)) {
    source = flattenAlpha(img)
    ctx.warn('ALPHA_FLATTENED', `${side} has transparent pixels; they were composited over white`, { side })
  }
  const full = imageToMat(mats, source)
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))
  let rgba = full
  if (width !== img.width || height !== img.height) {
    rgba = mats.mat()
    cv.resize(full, rgba, new cv.Size(width, height), 0, 0, cv.INTER_AREA)
    mats.release(full)
  }
  const gray = mats.mat()
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY, 0)
  const grayBlur = mats.mat()
  cv.GaussianBlur(gray, grayBlur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT)
  return { rgba, gray, grayBlur, width, height, scale: width / img.width, original: img }
}

export const preprocessStage: Stage<PreprocessInput, PreprocessOutput> = {
  name: 'preprocess',
  run(input, ctx) {
    const scales = workingScales(input.baseline.width, input.candidate.width, ctx.options.workingWidth)
    for (const side of ['baseline', 'candidate'] as const) {
      if (scales[side] < 0.5) {
        ctx.warn('IMAGE_DOWNSCALED', `${side} analysed at ${Math.round(scales[side] * 100)}% of its size`, { side, scale: scales[side] })
      }
    }
    return {
      baseline: prep(ctx, input.baseline, scales.baseline, 'baseline'),
      candidate: prep(ctx, input.candidate, scales.candidate, 'candidate'),
    }
  },
}
