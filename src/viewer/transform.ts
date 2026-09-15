/** A 3x3 row-major homogeneous matrix as a CSS transform. */
export function matrixToCss(m: readonly number[]): string {
  if (m.length < 9) return 'none'
  const w = m[8]! || 1
  const n = m.map((v) => v / w)
  const [a, b, tx, c, d, ty, p, q] = n as [number, number, number, number, number, number, number, number]
  if (Math.abs(p) < 1e-9 && Math.abs(q) < 1e-9) {
    // CSS matrix(a, b, c, d, e, f): x' = a·x + c·y + e, y' = b·x + d·y + f
    return `matrix(${a}, ${c}, ${b}, ${d}, ${tx}, ${ty})`
  }
  // A 2-D projective transform fits in matrix3d (column-major) with the
  // perspective terms in the fourth row.
  return `matrix3d(${a}, ${c}, 0, ${p}, ${b}, ${d}, 0, ${q}, 0, 0, 1, 0, ${tx}, ${ty}, 0, 1)`
}

/** A point through a 3x3 row-major homogeneous matrix. */
export function applyToPoint(m: readonly number[], x: number, y: number): { x: number; y: number } {
  if (m.length < 9) return { x, y }
  const w = m[6]! * x + m[7]! * y + m[8]! || 1
  return { x: (m[0]! * x + m[1]! * y + m[2]!) / w, y: (m[3]! * x + m[4]! * y + m[5]!) / w }
}

/** The axis-aligned box that holds a box's four corners after the transform. */
export function applyToBox(m: readonly number[], b: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const pts = [applyToPoint(m, b.x, b.y), applyToPoint(m, b.x + b.w, b.y), applyToPoint(m, b.x, b.y + b.h), applyToPoint(m, b.x + b.w, b.y + b.h)]
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}
