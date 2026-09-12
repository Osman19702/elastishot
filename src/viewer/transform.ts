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
