import { touches, union } from '../../core/geometry.ts'
import type { Box } from '../../core/types.ts'

export interface BoxGroup<T> {
  box: Box
  members: T[]
}

/**
 * Group items whose boxes overlap or lie within `gap` pixels of each other,
 * transitively (union-find). Returns one group per connected cluster with the
 * union box of its members, in order of first appearance.
 */
export function mergeBoxes<T>(items: readonly T[], boxOf: (item: T) => Box, gap: number): BoxGroup<T>[] {
  const n = items.length
  if (n === 0) return []
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  const unite = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => boxOf(items[i]!).x - boxOf(items[j]!).x)
  const boxes = order.map((i) => boxOf(items[i]!))
  for (let p = 0; p < n; p++) {
    const bp = boxes[p]!
    const limit = bp.x + bp.w + gap
    for (let q = p + 1; q < n && boxes[q]!.x <= limit; q++) {
      if (touches(bp, boxes[q]!, gap)) unite(order[p]!, order[q]!)
    }
  }

  const groups = new Map<number, BoxGroup<T>>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const item = items[i]!
    const box = boxOf(item)
    const g = groups.get(root)
    if (g) {
      g.box = union(g.box, box)
      g.members.push(item)
    } else {
      groups.set(root, { box: { ...box }, members: [item] })
    }
  }
  return [...groups.values()]
}
