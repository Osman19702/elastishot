import type { CV, Deletable, Mat, Scalar } from './cv-types.ts'

/**
 * Tracks every opencv.js object created during one operation so that all of
 * them are freed in one place. WASM objects are not garbage collected; a
 * forgotten delete() is a leak that survives the compare.
 */
export class MatScope {
  readonly cv: CV
  private readonly items: Deletable[] = []

  constructor(cv: CV) {
    this.cv = cv
  }

  track<T extends Deletable>(item: T): T {
    this.items.push(item)
    return item
  }

  mat(): Mat
  mat(rows: number, cols: number, type: number, fill?: Scalar): Mat
  mat(rows?: number, cols?: number, type?: number, fill?: Scalar): Mat {
    if (rows === undefined) return this.track(new this.cv.Mat())
    if (fill === undefined) return this.track(new this.cv.Mat(rows, cols!, type!))
    return this.track(new this.cv.Mat(rows, cols!, type!, fill))
  }

  zeros(rows: number, cols: number, type: number): Mat {
    return this.track(this.cv.Mat.zeros(rows, cols, type))
  }

  fromArray(rows: number, cols: number, type: number, array: ArrayLike<number>): Mat {
    return this.track(this.cv.matFromArray(rows, cols, type, array))
  }

  /** Free one item early and stop tracking it. */
  release(item: Deletable): void {
    const i = this.items.indexOf(item)
    if (i !== -1) this.items.splice(i, 1)
    safeDelete(item)
  }

  /** Free everything, newest first. Safe to call more than once. */
  dispose(): void {
    while (this.items.length) safeDelete(this.items.pop()!)
  }

  get size(): number {
    return this.items.length
  }
}

function safeDelete(item: Deletable): void {
  try {
    if (item.isDeleted?.()) return
    item.delete()
  } catch {
    // already freed by opencv.js (for example a Mat returned by roi() after its parent went away)
  }
}

/** Run `fn` with a scope that is disposed afterwards, even on error. */
export async function withMats<T>(cv: CV, fn: (scope: MatScope) => T | Promise<T>): Promise<T> {
  const scope = new MatScope(cv)
  try {
    return await fn(scope)
  } finally {
    scope.dispose()
  }
}

export function withMatsSync<T>(cv: CV, fn: (scope: MatScope) => T): T {
  const scope = new MatScope(cv)
  try {
    return fn(scope)
  } finally {
    scope.dispose()
  }
}
