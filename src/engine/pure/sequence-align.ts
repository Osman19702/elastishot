/**
 * Global sequence alignment with affine gap penalties (Needleman-Wunsch /
 * Gotoh) over two sequences of strip signatures. A "deleted" run means
 * baseline strips with no counterpart (content removed); an "inserted" run
 * means candidate strips with no counterpart (content added).
 */

export interface SequenceAlignParams {
  gapOpen: number
  gapExtend: number
  /** Similarities above this score positively, below negatively. */
  matchThreshold: number
  /** Cost of opening a gap that touches the start or end of a sequence (default: gapOpen). Cheaper end gaps make crops and shifts natural. */
  endGapOpen?: number
  /** Cost per strip of an end gap (default: gapExtend). */
  endGapExtend?: number
}

export const OP_MATCH = 0
export const OP_INSERT = 1
export const OP_DELETE = 2
export type AlignOp = typeof OP_MATCH | typeof OP_INSERT | typeof OP_DELETE

export type RunKind = 'matched' | 'inserted' | 'deleted'

/** Half-open strip index ranges; b for baseline, c for candidate. */
export interface Run {
  kind: RunKind
  b0: number
  b1: number
  c0: number
  c1: number
}

const NEG = -1e30

/** Maximum DP cells before the caller should enlarge the strips. */
export const MAX_CELLS = 4_000_000

export function alignSequences(
  nB: number,
  nC: number,
  similarity: (i: number, j: number) => number,
  params: SequenceAlignParams,
): AlignOp[] {
  if (nB === 0 && nC === 0) return []
  if (nB === 0) return new Array<AlignOp>(nC).fill(OP_INSERT)
  if (nC === 0) return new Array<AlignOp>(nB).fill(OP_DELETE)
  const { gapOpen, gapExtend, matchThreshold } = params
  const endOpen = params.endGapOpen ?? gapOpen
  const endExtend = params.endGapExtend ?? gapExtend
  const denom = Math.max(1e-6, 1 - matchThreshold)
  const W = nC + 1
  const cells = (nB + 1) * W
  const M = new Float32Array(cells).fill(NEG)
  const X = new Float32Array(cells).fill(NEG) // gap in baseline: candidate strip inserted
  const Y = new Float32Array(cells).fill(NEG) // gap in candidate: baseline strip deleted
  const tM = new Uint8Array(cells)
  const tX = new Uint8Array(cells)
  const tY = new Uint8Array(cells)

  // Leading gaps.
  M[0] = 0
  for (let j = 1; j <= nC; j++) {
    X[j] = -endOpen - (j - 1) * endExtend
    tX[j] = j === 1 ? 0 : 1
  }
  for (let i = 1; i <= nB; i++) {
    Y[i * W] = -endOpen - (i - 1) * endExtend
    tY[i * W] = i === 1 ? 0 : 2
  }

  for (let i = 1; i <= nB; i++) {
    for (let j = 1; j <= nC; j++) {
      const idx = i * W + j
      const diag = idx - W - 1
      const up = idx - W
      const left = idx - 1

      const s = (similarity(i - 1, j - 1) - matchThreshold) / denom
      let best = M[diag]!
      let from = 0
      if (X[diag]! > best) {
        best = X[diag]!
        from = 1
      }
      if (Y[diag]! > best) {
        best = Y[diag]!
        from = 2
      }
      M[idx] = s + best
      tM[idx] = from

      // A gap in the last row consumes candidate strips after the baseline ended: a trailing gap.
      const xOpen = i === nB ? endOpen : gapOpen
      const xExtend = i === nB ? endExtend : gapExtend
      let bx = M[left]! - xOpen
      let fx = 0
      if (X[left]! - xExtend > bx) {
        bx = X[left]! - xExtend
        fx = 1
      }
      if (Y[left]! - xOpen > bx) {
        bx = Y[left]! - xOpen
        fx = 2
      }
      X[idx] = bx
      tX[idx] = fx

      // A gap in the last column consumes baseline strips after the candidate ended.
      const yOpen = j === nC ? endOpen : gapOpen
      const yExtend = j === nC ? endExtend : gapExtend
      let by = M[up]! - yOpen
      let fy = 0
      if (Y[up]! - yExtend > by) {
        by = Y[up]! - yExtend
        fy = 2
      }
      if (X[up]! - yOpen > by) {
        by = X[up]! - yOpen
        fy = 1
      }
      Y[idx] = by
      tY[idx] = fy
    }
  }

  const ops: AlignOp[] = []
  let i = nB
  let j = nC
  let idx = i * W + j
  let matrix = 0
  if (X[idx]! > M[idx]!) matrix = 1
  if (Y[idx]! > (matrix === 1 ? X[idx]! : M[idx]!)) matrix = 2
  while (i > 0 || j > 0) {
    idx = i * W + j
    if (matrix === 0) {
      ops.push(OP_MATCH)
      matrix = tM[idx]!
      i--
      j--
    } else if (matrix === 1) {
      ops.push(OP_INSERT)
      matrix = tX[idx]!
      j--
    } else {
      ops.push(OP_DELETE)
      matrix = tY[idx]!
      i--
    }
  }
  ops.reverse()
  return ops
}

/** Run-length encode an op list into strip index ranges. */
export function opsToRuns(ops: readonly AlignOp[]): Run[] {
  const runs: Run[] = []
  let i = 0
  let j = 0
  for (const op of ops) {
    const kind: RunKind = op === OP_MATCH ? 'matched' : op === OP_INSERT ? 'inserted' : 'deleted'
    const last = runs[runs.length - 1]
    if (last && last.kind === kind) {
      if (op !== OP_INSERT) last.b1++
      if (op !== OP_DELETE) last.c1++
    } else {
      runs.push({
        kind,
        b0: i,
        b1: op === OP_INSERT ? i : i + 1,
        c0: j,
        c1: op === OP_DELETE ? j : j + 1,
      })
    }
    if (op !== OP_INSERT) i++
    if (op !== OP_DELETE) j++
  }
  return runs
}

/**
 * An adjacent deleted run and inserted run describe strips that replaced
 * each other. Pair as many as possible into a matched run (the differ then
 * reports them as changed) and keep the remainder as a gap.
 */
export function repairSubstitutions(runs: readonly Run[]): Run[] {
  const out: Run[] = []
  for (let k = 0; k < runs.length; k++) {
    const a = runs[k]!
    const b = runs[k + 1]
    const pair = b && ((a.kind === 'deleted' && b.kind === 'inserted') || (a.kind === 'inserted' && b.kind === 'deleted'))
    if (!pair) {
      out.push({ ...a })
      continue
    }
    const del = a.kind === 'deleted' ? a : b!
    const ins = a.kind === 'inserted' ? a : b!
    const lenD = del.b1 - del.b0
    const lenI = ins.c1 - ins.c0
    const n = Math.min(lenD, lenI)
    out.push({ kind: 'matched', b0: del.b0, b1: del.b0 + n, c0: ins.c0, c1: ins.c0 + n })
    if (lenD > n) out.push({ kind: 'deleted', b0: del.b0 + n, b1: del.b1, c0: ins.c1, c1: ins.c1 })
    if (lenI > n) out.push({ kind: 'inserted', b0: del.b1, b1: del.b1, c0: ins.c0 + n, c1: ins.c1 })
    k++
  }
  return mergeAdjacentMatched(out)
}

/** Merge consecutive matched runs that continue with the same offset. */
export function mergeAdjacentMatched(runs: readonly Run[]): Run[] {
  const out: Run[] = []
  for (const r of runs) {
    const last = out[out.length - 1]
    if (last && last.kind === 'matched' && r.kind === 'matched' && last.b1 === r.b0 && last.c1 === r.c0 && last.c0 - last.b0 === r.c0 - r.b0) {
      last.b1 = r.b1
      last.c1 = r.c1
    } else {
      out.push({ ...r })
    }
  }
  return out
}
