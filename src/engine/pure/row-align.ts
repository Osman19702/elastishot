/**
 * Exact row alignment for same-scale captures.
 *
 * When both sides were analysed at the same scale and the global transform
 * is a whole-pixel shift, an unchanged row of the page is the same bytes on
 * both sides. Hashing every row and aligning the two hash sequences the way
 * a text diff aligns lines settles, at one-pixel granularity, which rows
 * face which: an opened FAQ answer is an insertion of exactly its height,
 * the rows below it keep their pixels, and a table row that was appended is
 * never paired with the look-alike row above it. The strip signatures used
 * for resampled pairs cannot do this once an insertion that is not a whole
 * number of strips sits above a block.
 *
 * The alignment is a patience diff: common prefix and suffix first, then
 * rows whose hash occurs exactly once on each side become anchors (longest
 * increasing subsequence), and the ranges between anchors recurse. A range
 * with no anchor left is a substitution: the rows on both sides replaced
 * each other, which the differ then compares pixel by pixel.
 */
import { mergeAdjacentMatched, repairSubstitutions, type Run } from './sequence-align.ts'

/** Hash of a row that can never match (no candidate pixels behind it). */
export const NO_ROW = -1

/**
 * Two independent 32-bit FNV-1a hashes folded into one 53-bit number, so a
 * chance collision between two of a few thousand rows is not a concern.
 */
export function hashRow(data: ArrayLike<number>, start: number, end: number): number {
  let h1 = 0x811c9dc5
  let h2 = 0x050c5d1f
  for (let i = start; i < end; i++) {
    const v = data[i]!
    h1 = Math.imul(h1 ^ v, 0x01000193)
    h2 = Math.imul(h2 ^ v, 0x01000193) ^ (h2 >>> 13)
  }
  return (h1 >>> 0) * 2097152 + ((h2 >>> 0) >>> 11)
}

export interface RowAlignInput {
  a: ArrayLike<number>
  b: ArrayLike<number>
  /** 1 for rows that are flat; they still match, but never anchor the alignment. */
  blankA?: ArrayLike<number>
  blankB?: ArrayLike<number>
}

type Op = { kind: Run['kind']; a: number; b: number }

/** Longest increasing subsequence of pairs sorted by `a`, by their `b` values; returns the chosen pairs. */
function longestIncreasing(pairs: ReadonlyArray<[number, number]>): Array<[number, number]> {
  const tails: number[] = []
  const tailIndex: number[] = []
  const prev = new Int32Array(pairs.length).fill(-1)
  for (let k = 0; k < pairs.length; k++) {
    const v = pairs[k]![1]
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (tails[mid]! < v) lo = mid + 1
      else hi = mid
    }
    tails[lo] = v
    tailIndex[lo] = k
    prev[k] = lo > 0 ? tailIndex[lo - 1]! : -1
  }
  const out: Array<[number, number]> = []
  let k = tails.length ? tailIndex[tails.length - 1]! : -1
  while (k >= 0) {
    out.push(pairs[k]!)
    k = prev[k]!
  }
  return out.reverse()
}

export function alignRows(input: RowAlignInput): Run[] {
  const { a, b } = input
  const blankA = input.blankA
  const blankB = input.blankB
  const eq = (x: number, y: number) => x !== NO_ROW && x === y
  const ops: Op[] = []

  const anchorsIn = (a0: number, a1: number, b0: number, b1: number): Array<[number, number]> => {
    const countA = new Map<number, number>()
    const posA = new Map<number, number>()
    for (let i = a0; i < a1; i++) {
      const h = a[i]!
      if (h === NO_ROW || blankA?.[i]) continue
      countA.set(h, (countA.get(h) ?? 0) + 1)
      posA.set(h, i)
    }
    const countB = new Map<number, number>()
    const posB = new Map<number, number>()
    for (let j = b0; j < b1; j++) {
      const h = b[j]!
      if (h === NO_ROW || blankB?.[j]) continue
      countB.set(h, (countB.get(h) ?? 0) + 1)
      posB.set(h, j)
    }
    const pairs: Array<[number, number]> = []
    for (const [h, n] of countA) if (n === 1 && countB.get(h) === 1) pairs.push([posA.get(h)!, posB.get(h)!])
    pairs.sort((p, q) => p[0] - q[0])
    return longestIncreasing(pairs)
  }

  const recurse = (a0: number, a1: number, b0: number, b1: number): void => {
    while (a0 < a1 && b0 < b1 && eq(a[a0]!, b[b0]!)) {
      ops.push({ kind: 'matched', a: a0, b: b0 })
      a0++
      b0++
    }
    const suffix: Op[] = []
    while (a1 > a0 && b1 > b0 && eq(a[a1 - 1]!, b[b1 - 1]!)) {
      a1--
      b1--
      suffix.push({ kind: 'matched', a: a1, b: b1 })
    }
    if (a0 < a1 || b0 < b1) {
      if (a0 === a1) for (let j = b0; j < b1; j++) ops.push({ kind: 'inserted', a: a0, b: j })
      else if (b0 === b1) for (let i = a0; i < a1; i++) ops.push({ kind: 'deleted', a: i, b: b0 })
      else {
        const anchors = anchorsIn(a0, a1, b0, b1)
        if (anchors.length) {
          let pa = a0
          let pb = b0
          for (const [i, j] of anchors) {
            recurse(pa, i, pb, j)
            ops.push({ kind: 'matched', a: i, b: j })
            pa = i + 1
            pb = j + 1
          }
          recurse(pa, a1, pb, b1)
        } else {
          // Nothing on either side is distinctive: the rows replaced each other.
          for (let i = a0; i < a1; i++) ops.push({ kind: 'deleted', a: i, b: b0 })
          for (let j = b0; j < b1; j++) ops.push({ kind: 'inserted', a: a1, b: j })
        }
      }
    }
    for (let k = suffix.length - 1; k >= 0; k--) ops.push(suffix[k]!)
  }
  recurse(0, a.length, 0, b.length)

  const runs: Run[] = []
  for (const op of ops) {
    const last = runs[runs.length - 1]
    if (op.kind === 'matched') {
      if (last && last.kind === 'matched' && last.b1 === op.a && last.c1 === op.b) {
        last.b1++
        last.c1++
      } else runs.push({ kind: 'matched', b0: op.a, b1: op.a + 1, c0: op.b, c1: op.b + 1 })
    } else if (op.kind === 'deleted') {
      if (last && last.kind === 'deleted' && last.b1 === op.a) last.b1++
      else runs.push({ kind: 'deleted', b0: op.a, b1: op.a + 1, c0: op.b, c1: op.b })
    } else if (last && last.kind === 'inserted' && last.c1 === op.b) last.c1++
    else runs.push({ kind: 'inserted', b0: op.a, b1: op.a, c0: op.b, c1: op.b + 1 })
  }
  return mergeAdjacentMatched(repairSubstitutions(runs))
}
