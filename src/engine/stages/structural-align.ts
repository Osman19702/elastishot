/**
 * Structural alignment: after the global transform, sections that collapsed
 * or expanded still shift everything below them. Both images are cut into
 * horizontal strips, each strip gets a small signature, and a sequence
 * alignment with affine gap costs maps baseline rows to candidate rows with
 * inserted and deleted runs. Deleted runs become removed regions, inserted
 * runs become added regions, matched runs go to the pixel differ.
 *
 * Candidate rows are expressed in baseline space (warped rows); the canvas
 * Mats are padded at the top by `warped.padTop`, see model.ts.
 */
import type { Band, Box } from '../../core/types.ts'
import type { Mat } from '../cv/cv-types.ts'
import { colEnergy, edgeMagnitude, rowEnergy } from '../cv/ops.ts'
import type { GlobalAlignOutput, StructuralAlignOutput, Warped, WorkingRegion } from '../model.ts'
import { gapScore } from '../pure/scoring.ts'
import { alignSequences, MAX_CELLS, opsToRuns, repairSubstitutions, type Run } from '../pure/sequence-align.ts'
import type { Stage, StageContext } from '../stage.ts'

const BINS = 64
/** Row means kept per strip (at most one per row). */
const VBINS = 8
const BLANK_ENERGY = 0.06
const BLANK_SPREAD = 0.06
const SIM_GAIN = 1.5
const BLANK_ROW_ENERGY = 2
const MIN_BLANK_RUN = 16
const CONTENT_PAD = 4
const MIN_COVERAGE = 0.5
/** Grey levels within this distance of the page background count as background. */
const BG_TOLERANCE = 4
/** Width of the outer frame sampled for the page background. */
const FRAME_PX = 4
/** Gap parts shorter than this are slivers of a neighbouring edge, not content. */
const MIN_PART_ROWS = 6
/** Edge gaps count as crops below this coverage. */
const CROP_COVERAGE = 0.9
/** Edge gaps smaller than this share of the baseline height are jitter. */
const CROP_SMALL_FRACTION = 0.03
const CROP_MIN_ROWS = 16
/** Strips this similar are interchangeable when sliding a gap. */
const SLIDE_SAME = 0.9
/** How many strips a gap may slide in either direction. */
const SLIDE_MAX = 12
/** Gaps up to this many strips are folded into the neighbouring matched band. */
const TINY_GAP_STRIPS = 1
/** Only bands at least this tall get their offset refined to the pixel. */
const MIN_REFINE_ROWS = 32
/** A refined offset must cut the band's pixel difference to this fraction. */
const REFINE_GAIN = 0.9
/** Sub-sampling step for the refinement's pixel difference. */
const REFINE_STEP = 2

/** Mean absolute grey difference between baseline rows [b0, b0+len) and canvas rows [c0, c0+len), sub-sampled. */
function bandDifference(a: Uint8Array, b: Uint8Array, width: number, b0: number, c0: number, len: number): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < len; y += REFINE_STEP) {
    const ra = (b0 + y) * width
    const rb = (c0 + y) * width
    for (let x = 0; x < width; x += REFINE_STEP) {
      sum += Math.abs(a[ra + x]! - b[rb + x]!)
      n++
    }
  }
  return n ? sum / n : Infinity
}

interface Signatures {
  n: number
  gray: Float32Array
  edge: Float32Array
  /** Row means inside each strip: the vertical layout of the strip. */
  vertical: Float32Array
  vbins: number
  energy: Float32Array
  spread: Float32Array
  mean: Float32Array
  coverage: Float32Array
}

/** Optional diagnostics sink: set globalThis.ELASTISHOT_DEBUG to a logger. */
const debugSink = (): ((...args: unknown[]) => void) | undefined => (globalThis as { ELASTISHOT_DEBUG?: (...args: unknown[]) => void }).ELASTISHOT_DEBUG

/** Signatures of the whole strips of exactly `stripPx` rows (a partial last strip is left out). */
function signatures(ctx: StageContext, gray: Mat, edge: Mat, coverage: Mat | null, stripPx: number): Signatures {
  const { cv, mats } = ctx
  const n = Math.floor(gray.rows / stripPx)
  const whole = new cv.Rect(0, 0, gray.cols, n * stripPx)
  const size = new cv.Size(BINS, n)
  const g = mats.mat()
  const gRoi = mats.track(gray.roi(whole))
  cv.resize(gRoi, g, size, 0, 0, cv.INTER_AREA)
  const grayArr = Float32Array.from(g.data, (v) => v / 255)
  mats.release(g)
  mats.release(gRoi)
  const e = mats.mat()
  const eRoi = mats.track(edge.roi(whole))
  cv.resize(eRoi, e, size, 0, 0, cv.INTER_AREA)
  const edgeRaw = Float32Array.from(e.data, (v) => v / 255)
  mats.release(e)
  mats.release(eRoi)
  const vbins = Math.min(VBINS, stripPx)
  const v = mats.mat()
  const vRoi = mats.track(gray.roi(whole))
  cv.resize(vRoi, v, new cv.Size(1, n * vbins), 0, 0, cv.INTER_AREA)
  const vertical = Float32Array.from(v.data, (x) => x / 255)
  mats.release(v)
  mats.release(vRoi)

  const energy = new Float32Array(n)
  const spread = new Float32Array(n)
  const mean = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    let gsum = 0
    let lo = 1
    let hi = 0
    for (let k = 0; k < BINS; k++) {
      sum += edgeRaw[i * BINS + k]!
      const v = grayArr[i * BINS + k]!
      gsum += v
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    energy[i] = sum / BINS
    spread[i] = hi - lo
    mean[i] = gsum / BINS
  }
  const sorted = Float32Array.from(edgeRaw).sort()
  const p98 = sorted[Math.floor(0.98 * (sorted.length - 1))] ?? 0
  const norm = Math.max(p98, 0.02)
  const edgeArr = edgeRaw.map((v) => Math.min(1, v / norm))

  const cov = new Float32Array(n).fill(1)
  if (coverage) {
    const c = mats.mat()
    const cRoi = mats.track(coverage.roi(whole))
    cv.resize(cRoi, c, new cv.Size(1, n), 0, 0, cv.INTER_AREA)
    const data = c.data
    for (let i = 0; i < n; i++) cov[i] = data[i]! / 255
    mats.release(c)
    mats.release(cRoi)
  }
  return { n, gray: grayArr, edge: edgeArr, vertical, vbins, energy, spread, mean, coverage: cov }
}

const isBlank = (s: Signatures, i: number): boolean => s.energy[i]! < BLANK_ENERGY && s.spread[i]! < BLANK_SPREAD

function similarity(a: Signatures, i: number, b: Signatures, j: number): number {
  const blankA = isBlank(a, i)
  const blankB = isBlank(b, j)
  // Two flat strips match weakly, and only when they are the same colour: a dark
  // header bar and a light banner must not tie.
  if (blankA && blankB) return Math.max(0, 0.7 - 1.5 * Math.abs(a.mean[i]! - b.mean[j]!))
  let lg = 0
  let le = 0
  let lv = 0
  const ai = i * BINS
  const bj = j * BINS
  for (let k = 0; k < BINS; k++) {
    lg += Math.abs(a.gray[ai + k]! - b.gray[bj + k]!)
    le += Math.abs(a.edge[ai + k]! - b.edge[bj + k]!)
  }
  const vb = Math.min(a.vbins, b.vbins)
  for (let k = 0; k < vb; k++) lv += Math.abs(a.vertical[i * a.vbins + k]! - b.vertical[j * b.vbins + k]!)
  lg /= BINS
  le /= BINS
  lv /= Math.max(1, vb)
  const sim = Math.max(0, 1 - Math.min(1, (0.25 * lg + 0.5 * le + 0.25 * lv * 2) * SIM_GAIN))
  // One flat strip against one with content: never a match, but a strip that
  // barely crossed the blank threshold should not be punished as a mismatch.
  return blankA || blankB ? Math.min(0.45, sim) : sim
}

/**
 * A gap between identical strips is ambiguous: deleting rows 224-408 or
 * 264-448 removes the same content when the rows in between repeat. Slide
 * each gap, as far as every surrounding match stays valid, to where it starts
 * after whitespace and ends with whitespace, which is how a person reads it.
 */
function slideGaps(runs: Run[], sigB: Signatures, sigC: Signatures, bStart: number, cStart: number): Run[] {
  const out = runs.map((r) => ({ ...r }))
  for (let k = 1; k < out.length - 1; k++) {
    const r = out[k]!
    if (r.kind === 'matched') continue
    const prev = out[k - 1]!
    const next = out[k + 1]!
    if (prev.kind !== 'matched' || next.kind !== 'matched') continue
    const deleted = r.kind === 'deleted'
    const sig = deleted ? sigB : sigC
    const base = deleted ? bStart : cStart
    const g0 = deleted ? r.b0 : r.c0
    const len = deleted ? r.b1 - r.b0 : r.c1 - r.c0
    const prevLen = deleted ? prev.b1 - prev.b0 : prev.c1 - prev.c0
    const nextLen = deleted ? next.b1 - next.b0 : next.c1 - next.c0
    const same = (a: number, b: number) => similarity(sig, base + a, sig, base + b) >= SLIDE_SAME
    const score = (start: number) => (start > 0 && isBlank(sig, base + start - 1) ? 1 : 0) + (isBlank(sig, base + start + len - 1) ? 1 : 0)
    let best = 0
    let bestScore = score(g0)
    for (let s = 1; s <= SLIDE_MAX && s < nextLen; s++) {
      if (!same(g0 + s - 1, g0 + len + s - 1)) break
      const sc = score(g0 + s)
      if (sc > bestScore) {
        bestScore = sc
        best = s
      }
    }
    for (let s = 1; s <= SLIDE_MAX && s < prevLen; s++) {
      if (!same(g0 - s, g0 + len - s)) break
      const sc = score(g0 - s)
      if (sc > bestScore) {
        bestScore = sc
        best = -s
      }
    }
    if (best === 0) continue
    prev.b1 += best
    prev.c1 += best
    next.b0 += best
    next.c0 += best
    if (deleted) {
      r.b0 += best
      r.b1 += best
      r.c0 = r.c1 = prev.c1
    } else {
      r.c0 += best
      r.c1 += best
      r.b0 = r.b1 = prev.b1
    }
  }
  return out
}

function singleBand(height: number): Band[] {
  return [{ kind: 'matched', axis: 'y', baseline: { start: 0, end: height }, candidate: { start: 0, end: height }, similarity: 1, offset: 0 }]
}

/**
 * A gap at the very edge of the sequence is a crop, not a change, when the
 * candidate shows only part of the baseline (or the baseline only part of the
 * candidate), or when the gap is tiny (capture jitter). Rows like that are
 * unknown: they are dropped from the bands and mentioned in a warning.
 * Larger edge gaps with good coverage are real removals or additions, for
 * example a banner added at the top of a page.
 */
function dropCroppedEdges(ctx: StageContext, bands: Band[], baselineHeight: number, warped: Warped): Band[] {
  if (bands.length < 2) return bands
  const extentRows = Math.max(1, warped.extent.bottom - warped.extent.top)
  const candidateCovered = (Math.min(warped.extent.bottom, baselineHeight) - Math.max(warped.extent.top, 0)) / extentRows
  const out = [...bands]
  const consider = (index: number): void => {
    const band = out[index]
    if (!band || band.kind === 'matched') return
    const deleted = band.kind === 'deleted'
    const rows = deleted ? band.baseline.end - band.baseline.start : band.candidate.end - band.candidate.start
    const small = rows < Math.max(CROP_MIN_ROWS, CROP_SMALL_FRACTION * baselineHeight)
    const partial = deleted ? warped.coverageFraction < CROP_COVERAGE : candidateCovered < CROP_COVERAGE
    if (!small && !partial) return
    out.splice(index, 1)
    const where = index === 0 ? 'top' : 'bottom'
    ctx.warn(
      'PARTIAL_COVERAGE',
      deleted
        ? `${rows} baseline rows at the ${where} have no counterpart in the candidate and were not compared`
        : `${rows} candidate rows at the ${where} have no counterpart in the baseline and were not compared`,
      { rows, edge: where, kind: band.kind },
    )
  }
  consider(out.length - 1)
  consider(0)
  return out
}

/**
 * Fold gaps of at most `maxLen` rows that sit between two matched bands with
 * the same offset into the preceding band: such a gap is alignment noise, not
 * structure. Gaps between bands with different offsets, or at the edges, are
 * real and stay.
 */
function absorbTinyGaps(bands: Band[], maxLen: number): Band[] {
  const out: Band[] = []
  for (let k = 0; k < bands.length; k++) {
    const band = bands[k]!
    const len = band.kind === 'inserted' ? band.candidate.end - band.candidate.start : band.baseline.end - band.baseline.start
    const prev = out[out.length - 1]
    const next = bands[k + 1]
    const spurious = band.kind !== 'matched' && len <= maxLen && prev?.kind === 'matched' && next?.kind === 'matched' && next.offset === prev.offset
    if (spurious && prev) {
      prev.baseline = { start: prev.baseline.start, end: prev.baseline.end + len }
      prev.candidate = { start: prev.candidate.start, end: prev.candidate.end + len }
      continue
    }
    out.push({ ...band })
  }
  return out
}

/**
 * The page background: the most common grey level along the baseline's outer
 * frame (its margins). The histogram mode of the whole page would often be a
 * card or panel colour instead.
 */
function pageBackground(gray: Mat): number {
  const hist = new Uint32Array(256)
  const d = gray.data
  const w = gray.cols
  const h = gray.rows
  const f = Math.min(FRAME_PX, Math.floor(w / 2), Math.floor(h / 2))
  for (let y = 0; y < h; y++) {
    const edgeRow = y < f || y >= h - f
    for (let x = 0; x < w; x++) {
      if (edgeRow || x < f || x >= w - f) hist[d[y * w + x]!]++
    }
  }
  let best = 0
  for (let v = 1; v < 256; v++) if (hist[v]! > hist[best]!) best = v
  return best
}

/** 1 for rows that are flat and background-coloured; a flat coloured banner is content. */
function blankRows(edge: Mat, gray: Mat, y0: number, y1: number, bg: number): Uint8Array {
  const energy = rowEnergy(edge, y0, y1)
  const means = rowEnergy(gray, y0, y1)
  const out = new Uint8Array(y1 - y0)
  for (let k = 0; k < out.length; k++) out[k] = energy[k]! < BLANK_ROW_ENERGY && Math.abs(means[k]! - bg) < BG_TOLERANCE ? 1 : 0
  return out
}

/** Split rows [y0, y1) at long blank runs and trim blank rows off each part. */
function splitByBlankRows(blank: Uint8Array, y0: number, y1: number): Array<{ y0: number; y1: number; blank: boolean }> {
  const parts: Array<{ y0: number; y1: number; blank: boolean }> = []
  let contentStart = -1
  let blankStart = -1
  for (let y = y0; y < y1; y++) {
    if (blank[y - y0] === 1) {
      if (blankStart === -1) blankStart = y
      if (contentStart !== -1 && y - blankStart + 1 >= MIN_BLANK_RUN) {
        parts.push({ y0: contentStart, y1: blankStart, blank: false })
        contentStart = -1
      }
    } else {
      if (contentStart === -1) contentStart = y
      blankStart = -1
    }
  }
  if (contentStart !== -1) parts.push({ y0: contentStart, y1: blankStart === -1 ? y1 : blankStart, blank: false })
  return parts.length ? parts : [{ y0, y1, blank: true }]
}

function contentColumns(edge: Mat, gray: Mat, y0: number, y1: number, bg: number): { x0: number; x1: number } | null {
  const cols = colEnergy(edge, y0, y1)
  const means = colEnergy(gray, y0, y1)
  let x0 = -1
  let x1 = -1
  for (let x = 0; x < cols.length; x++) {
    if (cols[x]! >= BLANK_ROW_ENERGY || Math.abs(means[x]! - bg) >= BG_TOLERANCE) {
      if (x0 === -1) x0 = x
      x1 = x + 1
    }
  }
  if (x0 === -1) return null
  return { x0: Math.max(0, x0 - CONTENT_PAD), x1: Math.min(cols.length, x1 + CONTENT_PAD) }
}

function gapRegions(input: GlobalAlignOutput, bands: Band[], edges: { baseline: Mat; warped: Mat }): WorkingRegion[] {
  const B = input.baseline
  const pad = input.warped.padTop
  const pageArea = B.width * B.height
  const confidence = 0.6 + 0.4 * input.confidence
  const bg = pageBackground(B.grayBlur)
  const out: WorkingRegion[] = []
  bands.forEach((band, index) => {
    if (band.kind === 'matched') return
    const inserted = band.kind === 'inserted'
    const edge = inserted ? edges.warped : edges.baseline
    const gray = inserted ? input.warped.grayBlur : B.grayBlur
    const shift = inserted ? pad : 0
    const range = inserted ? band.candidate : band.baseline
    const y0 = Math.max(0, range.start + shift)
    const y1 = Math.min(edge.rows, range.end + shift)
    if (y1 <= y0) return
    const blank = blankRows(edge, gray, y0, y1, bg)
    const parts = splitByBlankRows(blank, y0, y1)
    // A gap boundary sits on a strip edge, so it can swallow the edge rows of a
    // neighbouring border line; drop such slivers when the band has real parts.
    const kept = parts.length > 1 ? parts.filter((p) => p.y1 - p.y0 >= MIN_PART_ROWS) : parts
    for (const part of kept.length ? kept : parts) {
      const cols = part.blank ? null : contentColumns(edge, gray, part.y0, part.y1, bg)
      const whitespace = cols === null
      const box: Box = whitespace
        ? { x: 0, y: part.y0 - shift, w: edge.cols, h: part.y1 - part.y0 }
        : { x: cols.x0, y: part.y0 - shift, w: cols.x1 - cols.x0, h: part.y1 - part.y0 }
      const area = box.w * box.h
      const tags = [inserted ? 'inserted-rows' : 'deleted-rows']
      if (whitespace) tags.push('whitespace-only')
      out.push({
        kind: inserted ? 'added' : 'removed',
        boxBaseline: inserted ? null : box,
        boxWarped: inserted ? box : null,
        ...(inserted ? { anchorBaseline: { x: box.x, y: band.baseline.start } } : { anchorWarped: { x: box.x, y: band.candidate.start } }),
        pixelsChanged: area,
        areaFraction: 1,
        meanDelta: whitespace ? 0 : 1,
        score: gapScore(area, pageArea, whitespace),
        confidence: whitespace ? 0.4 : confidence,
        band: index,
        tags,
      })
    }
  })
  return out
}

export const structuralAlignStage: Stage<GlobalAlignOutput, StructuralAlignOutput> = {
  name: 'structuralAlign',
  run(input, ctx) {
    const { options } = ctx
    const st = options.structural
    const B = input.baseline
    const W = input.warped
    const pad = W.padTop
    const edges = { baseline: edgeMagnitude(ctx, B.grayBlur), warped: edgeMagnitude(ctx, W.grayBlur) }
    const finish = (bands: Band[], stripPx: number, matchedFraction: number): StructuralAlignOutput => ({
      ...input,
      bands,
      stripPx,
      matchedFraction,
      edges,
      gapRegions: gapRegions(input, bands, edges),
    })

    const shared = Math.min(B.height, W.height - pad)
    if (!st.enabled) return finish(singleBand(shared), st.stripPx, 1)
    if (st.axis === 'both') {
      ctx.warn('STRUCT_WEAK_MATCH', 'structural.axis "both" is not implemented in this version; only rows are aligned', { axis: st.axis })
    }
    if (B.height < 4 * st.stripPx || W.height < 4 * st.stripPx) {
      ctx.warn('STRUCT_DISABLED_TOO_SMALL', 'images are too short for structural alignment; compared as one block')
      return finish(singleBand(shared), st.stripPx, 1)
    }

    let stripPx = st.stripPx
    while ((Math.ceil(B.height / stripPx) + 1) * (Math.ceil(W.height / stripPx) + 1) > MAX_CELLS) stripPx *= 2
    if (stripPx !== st.stripPx) {
      ctx.warn('STRUCT_STRIP_ENLARGED', `strips enlarged from ${st.stripPx} to ${stripPx} px to bound the alignment cost`, { stripPx })
    }
    const sigB = ctx.time('signatures', () => signatures(ctx, B.grayBlur, edges.baseline, null, stripPx))
    const sigC = ctx.time('signatures', () => signatures(ctx, W.grayBlur, edges.warped, W.coverage, stripPx))
    const nB = sigB.n
    const nC = sigC.n
    // Only canvas strips with candidate pixels behind them take part; they
    // form one contiguous range because the warped candidate is convex.
    const cIndex: number[] = []
    for (let j = 0; j < nC; j++) if (sigC.coverage[j]! >= MIN_COVERAGE) cIndex.push(j)
    if (!cIndex.length) {
      ctx.warn('STRUCT_WEAK_MATCH', 'the candidate and the baseline do not overlap after alignment', { matchedFraction: 0 })
      return finish(singleBand(shared), stripPx, 0)
    }
    const bStart = 0
    const cStart = cIndex[0]!
    const bEnd = nB
    const cEnd = cIndex[cIndex.length - 1]! + 1

    const ops = ctx.time('sequenceAlign', () =>
      alignSequences(nB, cIndex.length, (ii, jj) => similarity(sigB, bStart + ii, sigC, cStart + jj), {
        gapOpen: st.gapOpen,
        gapExtend: st.gapExtend,
        matchThreshold: st.matchThreshold,
        // Crops and shifts are end effects: a gap at either end only pays per strip.
        endGapOpen: 0,
        endGapExtend: st.gapExtend,
      }),
    )
    const runs = slideGaps(repairSubstitutions(opsToRuns(ops)), sigB, sigC, bStart, cStart)
    const debug = debugSink()
    if (debug) {
      const diag = Array.from({ length: Math.min(nB, cIndex.length) }, (_, i) => similarity(sigB, bStart + i, sigC, cStart + i).toFixed(2))
      const strip = (s: Signatures, i: number) => `E${s.energy[i]!.toFixed(3)} S${s.spread[i]!.toFixed(3)} M${s.mean[i]!.toFixed(2)}${isBlank(s, i) ? ' blank' : ''}`
      debug('structural', { nB, nC, cStart, covered: cIndex.length, diag, runs, stripsB: Array.from({ length: nB }, (_, i) => strip(sigB, i)), stripsC: cIndex.map((j) => strip(sigC, j)) })
    }

    // Run positions are relative to the covered ranges.
    const rowB = (pos: number) => Math.min(B.height, (bStart + pos) * stripPx)
    const rowC = (pos: number) => Math.min(W.height, (cStart + pos) * stripPx) - pad
    const toBand = (r: Run): Band => {
      const baseline = { start: rowB(r.b0), end: rowB(r.b1) }
      const candidate = { start: rowC(r.c0), end: rowC(r.c1) }
      let sim = 0
      if (r.kind === 'matched') {
        let sum = 0
        for (let k = 0; k < r.b1 - r.b0; k++) sum += similarity(sigB, bStart + r.b0 + k, sigC, cStart + r.c0 + k)
        sim = sum / Math.max(1, r.b1 - r.b0)
      }
      return { kind: r.kind, axis: 'y', baseline, candidate, similarity: sim, offset: candidate.start - baseline.start }
    }
    const bandsRaw = runs.map(toBand)
    // The partial last strip was left out of the alignment; give its rows to
    // the last band when the covered range reaches the end of the image.
    const tail = bandsRaw[bandsRaw.length - 1]
    if (tail && bEnd === nB && cEnd === nC) {
      if (tail.kind === 'matched') {
        const len = B.height - tail.baseline.start
        tail.baseline = { start: tail.baseline.start, end: B.height }
        tail.candidate = { start: tail.candidate.start, end: tail.candidate.start + len }
      } else if (tail.kind === 'deleted') tail.baseline = { start: tail.baseline.start, end: B.height }
      else tail.candidate = { start: tail.candidate.start, end: W.height - pad }
    }
    let bands = dropCroppedEdges(ctx, absorbTinyGaps(bandsRaw, TINY_GAP_STRIPS * stripPx), B.height, W)

    // Refine the offset of matched bands that follow a structural gap to the
    // pixel: the strips quantise the shift to stripPx, so try every offset
    // within a strip and keep the one with the smallest pixel difference.
    // Bands that continue the global alignment are left alone: it is already
    // sub-pixel accurate.
    let previousOffset = 0
    let afterGap = false
    for (const band of bands) {
      if (band.kind !== 'matched') {
        afterGap = true
        continue
      }
      const shifted = afterGap || band.offset !== previousOffset
      previousOffset = band.offset
      afterGap = false
      const len = Math.min(band.baseline.end - band.baseline.start, B.height - band.baseline.start)
      if (!shifted || len < MIN_REFINE_ROWS) continue
      const c0 = band.candidate.start + pad
      const dataB = B.grayBlur.data
      const dataW = W.grayBlur.data
      const at = (d: number): number => {
        const cd = c0 + d
        if (cd < 0 || cd + len > W.height) return Infinity
        return bandDifference(dataB, dataW, B.width, band.baseline.start, cd, len)
      }
      const base = at(0)
      if (!Number.isFinite(base)) continue
      let bestD = 0
      let best = base
      for (let d = -stripPx; d <= stripPx; d++) {
        if (d === 0) continue
        const v = at(d)
        if (v < best) {
          best = v
          bestD = d
        }
      }
      if (bestD !== 0 && best < base * REFINE_GAIN) {
        band.candidate = { start: band.candidate.start + bestD, end: band.candidate.end + bestD }
        band.offset += bestD
      }
    }
    // Merge matched neighbours that ended up with the same offset.
    const merged: Band[] = []
    for (const band of bands) {
      const last = merged[merged.length - 1]
      if (last && last.kind === 'matched' && band.kind === 'matched' && last.offset === band.offset && last.baseline.end >= band.baseline.start) {
        const n1 = last.baseline.end - last.baseline.start
        const n2 = band.baseline.end - band.baseline.start
        last.similarity = (last.similarity * n1 + band.similarity * n2) / Math.max(1, n1 + n2)
        last.baseline = { start: last.baseline.start, end: Math.max(last.baseline.end, band.baseline.end) }
        last.candidate = { start: last.candidate.start, end: Math.max(last.candidate.end, band.candidate.end) }
      } else merged.push({ ...band })
    }
    bands = merged

    let matchedRows = 0
    let consideredRows = 0
    for (const band of bands) {
      if (band.kind === 'matched') matchedRows += band.baseline.end - band.baseline.start
      if (band.kind !== 'inserted') consideredRows += band.baseline.end - band.baseline.start
    }
    const matchedFraction = Math.min(1, matchedRows / Math.max(1, consideredRows))
    if (matchedFraction < 0.2) {
      ctx.warn('STRUCT_WEAK_MATCH', `only ${Math.round(matchedFraction * 100)}% of the baseline rows found a counterpart in the candidate`, { matchedFraction })
      if (input.confidence < 0.3) return finish(singleBand(shared), stripPx, matchedFraction)
    }
    return finish(bands, stripPx, matchedFraction)
  },
}
