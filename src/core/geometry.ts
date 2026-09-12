import type { Box, Point, Size, Transform2D, TransformKind } from './types.ts'

/** 3x3 row-major homogeneous matrix [a, b, tx, c, d, ty, p, q, w]. */
export type Mat3 = number[]

const SNAP = 1e-6

// ------------------------------------------------------------------- boxes

export function area(b: Box): number {
  return Math.max(0, b.w) * Math.max(0, b.h)
}

export function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.w, b.x + b.w)
  const bottom = Math.min(a.y + a.h, b.y + b.h)
  if (right <= x || bottom <= y) return null
  return { x, y, w: right - x, h: bottom - y }
}

export function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.w, b.x + b.w)
  const bottom = Math.max(a.y + a.h, b.y + b.h)
  return { x, y, w: right - x, h: bottom - y }
}

export function iou(a: Box, b: Box): number {
  const i = intersect(a, b)
  if (!i) return 0
  const shared = area(i)
  const total = area(a) + area(b) - shared
  return total <= 0 ? 0 : shared / total
}

/** Fraction of `region` that lies inside `by`. */
export function coverage(region: Box, by: Box): number {
  const i = intersect(region, by)
  if (!i) return 0
  const total = area(region)
  return total <= 0 ? 0 : area(i) / total
}

export function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

export function expand(b: Box, px: number): Box {
  return { x: b.x - px, y: b.y - px, w: b.w + 2 * px, h: b.h + 2 * px }
}

/** True when the boxes overlap or lie within `gap` pixels of each other (inclusive). */
export function touches(a: Box, b: Box, gap = 0): boolean {
  return !(b.x > a.x + a.w + gap || a.x > b.x + b.w + gap || b.y > a.y + a.h + gap || a.y > b.y + b.h + gap)
}

export function centre(b: Box): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

export function boxesEqual(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

function snap(v: number): number {
  const r = Math.round(v)
  return Math.abs(v - r) < SNAP ? r : v
}

/** Smallest integer box that contains a fractional one. */
export function roundOutward(b: Box): Box {
  const x = Math.floor(snap(b.x))
  const y = Math.floor(snap(b.y))
  return { x, y, w: Math.ceil(snap(b.x + b.w)) - x, h: Math.ceil(snap(b.y + b.h)) - y }
}

/** Clip a box to an image; null when nothing remains. */
export function clampBox(b: Box, size: Size): Box | null {
  return intersect(b, { x: 0, y: 0, w: size.width, h: size.height })
}

// ---------------------------------------------------------------- matrices

export function identity(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1]
}

export function translation(tx: number, ty: number): Mat3 {
  return [1, 0, tx, 0, 1, ty, 0, 0, 1]
}

export function scaling(sx: number, sy = sx): Mat3 {
  return [sx, 0, 0, 0, sy, 0, 0, 0, 1]
}

/** From an OpenCV-style 2x3 [a, b, tx, c, d, ty]: x' = a·x + b·y + tx, y' = c·x + d·y + ty. */
export function fromAffine(m6: ArrayLike<number>): Mat3 {
  return [m6[0]!, m6[1]!, m6[2]!, m6[3]!, m6[4]!, m6[5]!, 0, 0, 1]
}

export function toAffine(m: Mat3): number[] {
  const n = normalize(m)
  return [n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!]
}

/** Scale so the bottom-right element is 1 (no-op for affine matrices). */
export function normalize(m: Mat3): Mat3 {
  const w = m[8]!
  if (w === 1 || w === 0 || !Number.isFinite(w)) return m.slice()
  return m.map((v) => v / w)
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!
    }
  }
  return out
}

export function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number]
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new RangeError('matrix is singular')
  const D = -(b * i - c * h)
  const E = a * i - c * g
  const F = -(a * h - b * g)
  const G = b * f - c * e
  const H = -(a * f - c * d)
  const I = a * e - b * d
  return normalize([A / det, D / det, G / det, B / det, E / det, H / det, C / det, F / det, I / det])
}

export function applyToPoint(m: Mat3, p: Point): Point {
  const w = m[6]! * p.x + m[7]! * p.y + m[8]!
  return {
    x: (m[0]! * p.x + m[1]! * p.y + m[2]!) / w,
    y: (m[3]! * p.x + m[4]! * p.y + m[5]!) / w,
  }
}

/** Integer bounding box of the transformed corners. */
export function applyToBox(m: Mat3, b: Box): Box {
  const corners = [
    applyToPoint(m, { x: b.x, y: b.y }),
    applyToPoint(m, { x: b.x + b.w, y: b.y }),
    applyToPoint(m, { x: b.x, y: b.y + b.h }),
    applyToPoint(m, { x: b.x + b.w, y: b.y + b.h }),
  ]
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of corners) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return roundOutward({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
}

export interface Decomposition {
  scaleX: number
  scaleY: number
  /** Geometric mean scale, sqrt(|det|). */
  scale: number
  rotationDeg: number
  /** 0 for similarity transforms. */
  shear: number
  tx: number
  ty: number
  /** Largest perspective coefficient, 0 for affine matrices. */
  perspective: number
}

export function decompose(m: Mat3): Decomposition {
  const n = normalize(m)
  const [a, b, tx, c, d, ty, p, q] = n as [number, number, number, number, number, number, number, number]
  const scaleX = Math.hypot(a, c)
  const det = a * d - b * c
  const scaleY = scaleX === 0 ? 0 : det / scaleX
  const shear = scaleX === 0 ? 0 : (a * b + c * d) / (scaleX * scaleX)
  return {
    scaleX,
    scaleY,
    scale: Math.sqrt(Math.abs(det)),
    rotationDeg: (Math.atan2(c, a) * 180) / Math.PI,
    shear,
    tx,
    ty,
    perspective: Math.max(Math.abs(p), Math.abs(q)),
  }
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol

export function transformKindOf(m: Mat3, tol = 1e-6): TransformKind {
  const n = normalize(m)
  if (Math.abs(n[6]!) > tol || Math.abs(n[7]!) > tol) return 'homography'
  const [a, b, tx, c, d, ty] = n as [number, number, number, number, number, number]
  if (near(a, 1, tol) && near(b, 0, tol) && near(c, 0, tol) && near(d, 1, tol)) {
    return near(tx, 0, tol) && near(ty, 0, tol) ? 'identity' : 'translation'
  }
  if (near(a, d, tol) && near(b, -c, tol)) return 'similarity'
  return 'affine'
}

const KIND_RANK: Record<TransformKind, number> = { identity: 0, translation: 1, similarity: 2, affine: 3, homography: 4 }

export function makeTransform(m: Mat3, kind?: TransformKind): Transform2D {
  return { kind: kind ?? transformKindOf(m), m: normalize(m) }
}

export function identityTransform(): Transform2D {
  return { kind: 'identity', m: identity() }
}

/** Transform that maps a `from`-sized image onto a `to`-sized one. */
export function resizeTransform(from: Size, to: Size): Transform2D {
  return makeTransform(scaling(to.width / from.width, to.height / from.height))
}

export function invertTransform(t: Transform2D): Transform2D {
  return { kind: t.kind, m: invert(t.m) }
}

/** outer ∘ inner: apply `inner` first, then `outer`. */
export function composeTransforms(outer: Transform2D, inner: Transform2D): Transform2D {
  const kind = KIND_RANK[outer.kind] >= KIND_RANK[inner.kind] ? outer.kind : inner.kind
  return { kind, m: normalize(multiply(outer.m, inner.m)) }
}
