import { applyToBox, applyToPoint, invert, multiply, scaling, type Mat3 } from '../../core/geometry.ts'
import type { Box, Point } from '../../core/types.ts'

/**
 * Converts between the coordinate spaces the engine uses: baseline original,
 * baseline working, candidate original, candidate working, and "warped" (the
 * candidate after the global transform, which lives in baseline working
 * space).
 */
export class CoordinateMapper {
  /** baseline working / baseline original */
  readonly scaleB: number
  /** candidate working / candidate original */
  readonly scaleC: number
  /** candidate working -> baseline working */
  readonly transformW: Mat3
  private readonly warpedToCandidateOriginalM: Mat3
  private readonly candidateOriginalToWarpedM: Mat3
  private readonly originalM: Mat3

  constructor(scaleB: number, scaleC: number, transformW: Mat3) {
    this.scaleB = scaleB
    this.scaleC = scaleC
    this.transformW = transformW
    this.warpedToCandidateOriginalM = multiply(scaling(1 / scaleC), invert(transformW))
    this.candidateOriginalToWarpedM = multiply(transformW, scaling(scaleC))
    this.originalM = multiply(scaling(1 / scaleB), multiply(transformW, scaling(scaleC)))
  }

  baselineWorkingToOriginal(b: Box): Box {
    return applyToBox(scaling(1 / this.scaleB), b)
  }

  baselineOriginalToWorking(b: Box): Box {
    return applyToBox(scaling(this.scaleB), b)
  }

  candidateWorkingToOriginal(b: Box): Box {
    return applyToBox(scaling(1 / this.scaleC), b)
  }

  warpedToCandidateOriginal(b: Box): Box {
    return applyToBox(this.warpedToCandidateOriginalM, b)
  }

  candidateOriginalToWarped(b: Box): Box {
    return applyToBox(this.candidateOriginalToWarpedM, b)
  }

  pointBaselineWorkingToOriginal(p: Point): Point {
    return { x: p.x / this.scaleB, y: p.y / this.scaleB }
  }

  pointWarpedToCandidateOriginal(p: Point): Point {
    return applyToPoint(this.warpedToCandidateOriginalM, p)
  }

  /** Candidate original -> baseline original. */
  originalTransform(): Mat3 {
    return this.originalM.slice()
  }
}
