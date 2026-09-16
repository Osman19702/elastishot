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
import { colEnergy, edgeMagnitude, roi, rowEnergy } from '../cv/ops.ts'
import type { GlobalAlignOutput, StructuralAlignOutput, Warped, WorkingRegion } from '../model.ts'
import { conflictZones, foldWobble, GUTTER_EDGE_SHARE, laneTiles, mergeContiguous, splitSubstitutedEdges } from '../pure/lanes.ts'
import { alignRows, hashRow, NO_ROW } from '../pure/row-align.ts'
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
const MIN_BLANK_RUN = 24
const CONTENT_PAD = 4
const MIN_COVERAGE = 0.5
/** Grey levels within this distance of the page background count as background. */
const BG_TOLERANCE = 4
/** Width of the outer frame sampled for the page background. */
const FRAME_PX = 4
/** Gap parts shorter than this are slivers of a neighbouring edge, not content. */
const MIN_PART_ROWS = 6
/**
 * Edge gaps count as crops below these coverages. Baseline rows the candidate
 * does not reach are usually a capture that ended early (a viewport, lazy
 * content that never loaded), so they are treated as not compared unless the
 * candidate shows nearly all of the baseline; candidate rows beyond the
 * baseline's edge are usually content (a banner) unless the baseline shows
 * clearly less than the candidate.
 */
const CROP_COVERAGE_DELETED = 0.95
const CROP_COVERAGE_INSERTED = 0.9
/** Edge gaps smaller than this share of the baseline height are jitter, up to CROP_SMALL_MAX rows. */
const CROP_SMALL_FRACTION = 0.03
const CROP_MIN_ROWS = 16
/** A 40 px banner on a 2400 px page is content, not jitter: the share rule stops here. */
const CROP_SMALL_MAX = 32
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
/** Below this matched share the strip alignment is checked against the plain global alignment. */
const WEAK_MATCH = 0.3
/** Whitespace-only gap parts shorter than this many rows are padding jitter, not content. */
const SLIVER_ROWS = 16
/** A row whose mean grey difference is below this is the same row in both images. */
const EXACT_ROW_MAD = 2
/** Column blocks the exactness check scores separately, so a half-width change still leaves the other half counting. */
const EXACT_BLOCKS = 4
/** A cell whose grey levels spread less than this is blank and does not count as evidence. */
const CONTENT_SPREAD = 8
/** The band map is discarded when the plain global alignment pairs this many times more content cells exactly. */
const EXACT_MARGIN = 1.1

/** Mean absolute grey difference between baseline rows [b0, b0+len) and canvas rows [c0, c0+len), sub-sampled, over columns [x0, x1). */
function bandDifference(a: Uint8Array, b: Uint8Array, width: number, b0: number, c0: number, len: number, x0 = 0, x1 = width): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < len; y += REFINE_STEP) {
    const ra = (b0 + y) * width
    const rb = (c0 + y) * width
    for (let x = x0; x < x1; x += REFINE_STEP) {
      sum += Math.abs(a[ra + x]! - b[rb + x]!)
      n++
    }
  }
  return n ? sum / n : Infinity
}

/**
 * Pixel evidence for a band map: the number of (row, column block) cells
 * with content in the baseline that the map pairs with the same pixels on
 * the other side. Blank cells are left out because white matches white
 * under any alignment; blocks keep a hero counting when only its
 * neighbouring panel changed.
 */
function exactContentCells(bands: Band[], grayB: Uint8Array, grayW: Uint8Array, width: number, baselineHeight: number, canvasHeight: number, pad: number): number {
  let cells = 0
  for (const band of bands) {
    if (band.kind !== 'matched') continue
    const cx0 = band.columns?.start ?? 0
    const cx1 = band.columns?.end ?? width
    const blockW = Math.max(1, Math.floor((cx1 - cx0) / EXACT_BLOCKS))
    const y0 = Math.max(0, band.baseline.start)
    const y1 = Math.min(baselineHeight, band.baseline.end)
    for (let y = y0; y < y1; y += REFINE_STEP) {
      const c = y + band.offset + pad
      if (c < 0 || c >= canvasHeight) continue
      for (let k = 0; k < EXACT_BLOCKS; k++) {
        const x0 = cx0 + k * blockW
        const x1 = k === EXACT_BLOCKS - 1 ? cx1 : x0 + blockW
        let lo = 255
        let hi = 0
        let sum = 0
        let n = 0
        for (let x = x0; x < x1; x += REFINE_STEP) {
          const v = grayB[y * width + x]!
          if (v < lo) lo = v
          if (v > hi) hi = v
          sum += Math.abs(v - grayW[c * width + x]!)
          n++
        }
        if (n && hi - lo >= CONTENT_SPREAD && sum / n < EXACT_ROW_MAD) cells++
      }
    }
  }
  return cells
}

/**
 * Unchanged rows are the same bytes on both sides only when nothing was
 * resampled: both sides analysed at their own size, and a global transform
 * that is a whole-pixel shift. Then every row can be hashed and aligned
 * exactly, see pure/row-align.ts.
 */
function exactCapable(input: GlobalAlignOutput): boolean {
  return (
    Math.abs(input.baseline.scale - 1) < 1e-9 &&
    Math.abs(input.candidate.scale - 1) < 1e-9 &&
    (input.method.startsWith('features') || input.method === 'identity') &&
    Math.abs(input.scale - 1) < 1e-6 &&
    Math.abs(input.rotationDeg) < 1e-6 &&
    Number.isInteger(input.translation.x) &&
    Number.isInteger(input.translation.y)
  )
}

/** 1 when the grey levels of the row segment spread less than CONTENT_SPREAD: a flat row. */
function flatRow(gray: Uint8Array, start: number, end: number): number {
  let lo = 255
  let hi = 0
  for (let i = start; i < end; i++) {
    const v = gray[i]!
    if (v < lo) lo = v
    if (v > hi) hi = v
    if (hi - lo >= CONTENT_SPREAD) return 0
  }
  return 1
}

/**
 * Bands from the exact row alignment: every baseline row and every covered
 * canvas row is hashed over the columns the candidate covers, and the two
 * hash sequences are aligned like lines of text. Null when the candidate
 * covers too little of the canvas to say anything.
 */
/** Whether baseline row y pairs exactly with the candidate row at an offset, by the row hashes. */
type RowExact = (baselineRow: number, offset: number) => boolean

function exactRowBands(input: GlobalAlignOutput): { bands: Band[]; exact: RowExact } | null {
  const B = input.baseline
  const W = input.warped
  const pad = W.padTop
  const width = B.width
  const cov = W.coverage.data
  // The candidate's rows on the canvas come from the warp's extent, not from
  // the coverage mask: its edge rows are softened, and starting two rows in
  // would pair every row with the wrong neighbour. Rows the mask does not
  // fully cover are hashed as NO_ROW below and match nothing.
  const cTop = Math.max(0, Math.min(W.height, Math.round(W.extent.top) + pad))
  const cBottom = Math.max(cTop, Math.min(W.height, Math.round(W.extent.bottom) + pad))
  if (cBottom - cTop < 2) return null
  const mid = ((cTop + cBottom) >> 1) * width
  let cx0 = 0
  while (cx0 < width && cov[mid + cx0] !== 255) cx0++
  let cx1 = width
  while (cx1 > cx0 && cov[mid + cx1 - 1] !== 255) cx1--
  if (cx1 - cx0 < MIN_COVERAGE * width) return null

  const rgbaB = B.rgba.data
  const rgbaW = W.rgba.data
  const grayB = B.gray.data
  const grayW = W.gray.data
  const hashA = new Float64Array(B.height)
  const blankA = new Uint8Array(B.height)
  for (let y = 0; y < B.height; y++) {
    const row = y * width
    hashA[y] = hashRow(rgbaB, (row + cx0) * 4, (row + cx1) * 4)
    blankA[y] = flatRow(grayB, row + cx0, row + cx1)
  }
  const nC = cBottom - cTop
  const hashB = new Float64Array(nC)
  const blankB = new Uint8Array(nC)
  for (let k = 0; k < nC; k++) {
    const row = (cTop + k) * width
    let covered = true
    for (let x = cx0; x < cx1; x++) {
      if (cov[row + x] !== 255) {
        covered = false
        break
      }
    }
    hashB[k] = covered ? hashRow(rgbaW, (row + cx0) * 4, (row + cx1) * 4) : NO_ROW
    blankB[k] = flatRow(grayW, row + cx0, row + cx1)
  }
  const runs = alignRows({ a: hashA, b: hashB, blankA, blankB })
  // A matched run of flat rows at either edge (padding both captures end
  // in) is no evidence of where the content above it belongs; without it
  // the gap next to it is an edge gap and the crop rules decide.
  const flatRun = (r: Run) => {
    if (r.kind !== 'matched') return false
    for (let i = r.b0; i < r.b1; i++) if (!blankA[i]) return false
    return true
  }
  while (runs.length > 1 && flatRun(runs[0]!)) runs.shift()
  while (runs.length > 1 && flatRun(runs[runs.length - 1]!)) runs.pop()
  const bands = runs.map((r): Band => {
    const baseline = { start: r.b0, end: r.b1 }
    const candidate = { start: cTop + r.c0 - pad, end: cTop + r.c1 - pad }
    let similarity = 0
    if (r.kind === 'matched') {
      let same = 0
      for (let k = 0; k < r.b1 - r.b0; k++) if (hashA[r.b0 + k] === hashB[r.c0 + k]) same++
      similarity = same / Math.max(1, r.b1 - r.b0)
    }
    return { kind: r.kind, axis: 'y', baseline, candidate, similarity, offset: candidate.start - baseline.start }
  })
  const exact: RowExact = (y, offset) => {
    const k = y + offset + pad - cTop
    return y >= 0 && y < B.height && k >= 0 && k < nC && hashA[y] === hashB[k]
  }
  return { bands, exact }
}

/** The columns the candidate covers on a canvas row, from the coverage mask: [x0, x1). */
function coveredColumns(cov: Uint8Array, width: number, row: number): [number, number] {
  const base = Math.max(0, row) * width
  let x0 = 0
  while (x0 < width && cov[base + x0] !== 255) x0++
  let x1 = width
  while (x1 > x0 && cov[base + x1 - 1] !== 255) x1--
  return [x0, x1]
}

/** Hash rows [y0, y1) of one side over columns [x0, x1); canvas rows not fully covered hash as NO_ROW. */
function laneHashes(rgba: Uint8Array, gray: Uint8Array, width: number, y0: number, y1: number, x0: number, x1: number, cov: Uint8Array | null): { hashes: Float64Array; blank: Uint8Array } {
  const n = Math.max(0, y1 - y0)
  const hashes = new Float64Array(n)
  const blank = new Uint8Array(n)
  for (let k = 0; k < n; k++) {
    const row = (y0 + k) * width
    let covered = true
    if (cov) {
      for (let x = x0; x < x1; x++) {
        if (cov[row + x] !== 255) {
          covered = false
          break
        }
      }
    }
    hashes[k] = covered ? hashRow(rgba, (row + x0) * 4, (row + x1) * 4) : NO_ROW
    blank[k] = flatRow(gray, row + x0, row + x1)
  }
  return { hashes, blank }
}

/**
 * Re-align each conflict zone of a row-aligned band map lane by lane, see
 * pure/lanes.ts. A zone's rows are cut at the gutters that are blank on both
 * sides for the whole zone; each lane's rows are hashed over its own columns
 * and aligned on their own, and the lane bands replace the zone's bands when
 * they pair at least as many content cells exactly. Everything outside the
 * zones keeps its full-width bands.
 */
const bandTag = (b: Band): string => `${b.kind[0]}${b.baseline.start}-${b.baseline.end}@${b.offset}~${b.similarity.toFixed(2)}${b.columns ? `[${b.columns.start}-${b.columns.end}]` : ''}`

function laneAlign(input: GlobalAlignOutput, rowBands: Band[], exact: RowExact, edges: { baseline: Mat; warped: Mat }, stripPx: number, debug?: (...args: unknown[]) => void): Band[] {
  if (!rowBands.some((b) => b.kind !== 'matched')) return rowBands
  const B = input.baseline
  const W = input.warped
  const pad = W.padTop
  const width = B.width
  const grayB = B.gray.data
  const grayW = W.gray.data
  const rgbaB = B.rgba.data
  const rgbaW = W.rgba.data
  const cov = W.coverage.data
  const blurB = B.grayBlur.data
  const blurW = W.grayBlur.data
  // The rows beside a gap that paired inexactly belong to the zone; the
  // row alignment's own hashes say which rows those are.
  const bands = splitSubstitutedEdges(rowBands, exact)
  const zones = conflictZones(bands)
  if (debug && bands.length !== rowBands.length) debug('split', { before: rowBands.map(bandTag), after: bands.map(bandTag), zones })
  if (!zones.length) return rowBands
  const out: Band[] = []
  let cursor = 0
  for (const zone of zones) {
    out.push(...bands.slice(cursor, zone.from))
    cursor = zone.to
    const zoneBands = bands.slice(zone.from, zone.to)
    const z0 = Math.max(0, Math.min(...zoneBands.map((b) => b.baseline.start)))
    const z1 = Math.min(B.height, Math.max(...zoneBands.map((b) => b.baseline.end)))
    // The candidate's rows and columns on the canvas come from the warp's
    // extent, not from the coverage mask: the mask is eroded, and a lane
    // whose last rows hash as uncovered never trims its blank suffix, so an
    // insertion above it slides to the lane's bottom.
    const c0 = Math.max(Math.ceil(W.extent.top), Math.min(...zoneBands.map((b) => b.candidate.start)))
    const c1 = Math.min(Math.floor(W.extent.bottom), W.height - pad, Math.max(...zoneBands.map((b) => b.candidate.end)))
    const [cx0, cx1] = coveredColumns(cov, width, ((c0 + c1) >> 1) + pad)
    if (z1 - z0 < 2 || c1 - c0 < 2 || cx1 - cx0 < 2) {
      out.push(...zoneBands)
      continue
    }
    // Gutters: columns with no edge in (nearly) every row of the zone on both
    // sides. A card background differs from the page background, so colour
    // is no criterion; a border line crossing the column is allowed for.
    const edgeB = edges.baseline.data
    const edgeW = edges.warped.data
    const edgeRows = new Uint32Array(width)
    for (let y = z0; y < z1; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) if (edgeB[row + x]! >= BLANK_ROW_ENERGY) edgeRows[x]++
    }
    for (let y = c0 + pad; y < c1 + pad; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) if (cov[row + x] === 255 && edgeW[row + x]! >= BLANK_ROW_ENERGY) edgeRows[x]++
    }
    const allowed = Math.max(2, Math.floor(GUTTER_EDGE_SHARE * (z1 - z0 + c1 - c0)))
    const blank = new Uint8Array(width)
    for (let x = 0; x < width; x++) blank[x] = edgeRows[x]! <= allowed ? 1 : 0
    const tiles = laneTiles(blank, width)
    if (tiles.length < 2) {
      out.push(...zoneBands)
      continue
    }
    const laneBands: Band[] = []
    for (const tile of tiles) {
      // Hash only the columns the candidate covers; the tile keeps its full width.
      const x0 = Math.max(tile.start, cx0)
      const x1 = Math.max(x0, Math.min(tile.end, cx1))
      const a = laneHashes(rgbaB, grayB, width, z0, z1, x0, x1, null)
      const b = laneHashes(rgbaW, grayW, width, c0 + pad, c1 + pad, x0, x1, null)
      const runs = alignRows({ a: a.hashes, b: b.hashes, blankA: a.blank, blankB: b.blank })
      const tileBands: Band[] = []
      for (const r of runs) {
        let similarity = 0
        if (r.kind === 'matched') {
          let same = 0
          for (let k = 0; k < r.b1 - r.b0; k++) if (a.hashes[r.b0 + k] === b.hashes[r.c0 + k]) same++
          similarity = same / Math.max(1, r.b1 - r.b0)
        }
        const baseline = { start: z0 + r.b0, end: z0 + r.b1 }
        const candidate = { start: c0 + r.c0, end: c0 + r.c1 }
        tileBands.push({ kind: r.kind, axis: 'y', baseline, candidate, similarity, offset: candidate.start - baseline.start, columns: { ...tile } })
      }
      // Rows that replaced each other in a lane (an illustration re-rendered
      // half a pixel lower) still get their offset refined to the pixel.
      laneBands.push(...refineOffsets(tileBands, B, W, stripPx, true))
    }
    const viaLanes = exactContentCells(laneBands, blurB, blurW, width, B.height, W.height, pad)
    const viaRows = exactContentCells(zoneBands, blurB, blurW, width, B.height, W.height, pad)
    if (debug) debug('lanes', { zone: [z0, z1, c0, c1], tiles, viaLanes, viaRows, bands: laneBands.map((b) => `${b.kind[0]}${b.baseline.start}-${b.baseline.end}@${b.offset}[${b.columns!.start}-${b.columns!.end}]`) })
    if (viaLanes >= viaRows) out.push(...laneBands)
    else out.push(...zoneBands)
  }
  out.push(...bands.slice(cursor))
  return mergeContiguous(out)
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
type Warn = StageContext['warn']

function dropCroppedEdges(warn: Warn, bands: Band[], baselineHeight: number, warped: Warped): Band[] {
  if (bands.length < 2) return bands
  const extentRows = Math.max(1, warped.extent.bottom - warped.extent.top)
  const candidateCovered = (Math.min(warped.extent.bottom, baselineHeight) - Math.max(warped.extent.top, 0)) / extentRows
  const out = [...bands]
  const consider = (index: number): void => {
    const band = out[index]
    if (!band || band.kind === 'matched') return
    const deleted = band.kind === 'deleted'
    const rows = deleted ? band.baseline.end - band.baseline.start : band.candidate.end - band.candidate.start
    const small = rows < Math.max(CROP_MIN_ROWS, Math.min(CROP_SMALL_MAX, CROP_SMALL_FRACTION * baselineHeight))
    const partial = deleted ? warped.coverageFraction < CROP_COVERAGE_DELETED : candidateCovered < CROP_COVERAGE_INSERTED
    if (!small && !partial) return
    out.splice(index, 1)
    if (rows < MIN_PART_ROWS) return
    const where = index === 0 ? 'top' : 'bottom'
    warn(
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

/**
 * Rows with no edge at all whose colour matches the nearest flat rows just
 * outside them are padding that grew (a card's inner margin), whatever the
 * colour. A flat banner of its own colour has neighbours of another colour
 * and stays content.
 */
function isPadding(edge: Mat, gray: Mat, y0: number, y1: number): boolean {
  const energy = rowEnergy(edge, y0, y1)
  // The blurred edge of a text line bleeds a row or two into the padding under it.
  let edged = 0
  for (let k = 0; k < energy.length; k++) if (energy[k]! >= BLANK_ROW_ENERGY) edged++
  if (edged > 2) return false
  const means = rowEnergy(gray, y0, y1)
  let sum = 0
  for (let k = 0; k < means.length; k++) sum += means[k]!
  const mean = sum / Math.max(1, means.length)
  const reach = 8
  const flatNeighbour = (from: number, step: number): number | null => {
    for (let y = from, n = 0; n < reach && y >= 0 && y < edge.rows; y += step, n++) {
      if (rowEnergy(edge, y, y + 1)[0]! < BLANK_ROW_ENERGY) return rowEnergy(gray, y, y + 1)[0]!
    }
    return null
  }
  const above = flatNeighbour(y0 - 1, -1)
  const below = flatNeighbour(y1, 1)
  if (above === null && below === null) return false
  return (above === null || Math.abs(above - mean) < BG_TOLERANCE) && (below === null || Math.abs(below - mean) < BG_TOLERANCE)
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

function gapRegions(ctx: StageContext, input: GlobalAlignOutput, bands: Band[], edges: { baseline: Mat; warped: Mat }): WorkingRegion[] {
  const B = input.baseline
  const pad = input.warped.padTop
  const pageArea = B.width * B.height
  const confidence = 0.6 + 0.4 * input.confidence
  const bg = pageBackground(B.grayBlur)
  const out: WorkingRegion[] = []
  // A lane band is judged on its own columns: a continuous copy of that strip.
  const laneMat = (mat: Mat, columns: Band['columns']): Mat => {
    if (!columns) return mat
    const view = roi(ctx, mat, { x: columns.start, y: 0, w: columns.end - columns.start, h: mat.rows })
    const copy = ctx.mats.mat()
    view.copyTo(copy)
    ctx.mats.release(view)
    return copy
  }
  bands.forEach((band, index) => {
    if (band.kind === 'matched') return
    const inserted = band.kind === 'inserted'
    const edge = laneMat(inserted ? edges.warped : edges.baseline, band.columns)
    const gray = laneMat(inserted ? input.warped.grayBlur : B.grayBlur, band.columns)
    const laneX = band.columns?.start ?? 0
    const shift = inserted ? pad : 0
    const range = inserted ? band.candidate : band.baseline
    const y0 = Math.max(0, range.start + shift)
    const y1 = Math.min(edge.rows, range.end + shift)
    if (y1 <= y0) return
    const blank = blankRows(edge, gray, y0, y1, bg)
    const parts = splitByBlankRows(blank, y0, y1).map((part) => (part.blank || !isPadding(edge, gray, part.y0, part.y1) ? part : { ...part, blank: true }))
    // Padding of a lane that did not grow is never a region: the lane that
    // grew reports the rows that carry content.
    const own = band.columns ? parts.filter((p) => !p.blank) : parts
    // The edge energy of a border line bleeds a row or two into the padding
    // next to it, and a gap boundary on a strip edge can swallow the edge
    // rows of a neighbouring line: content parts that short are slivers, and
    // a gap made only of slivers is padding.
    const kept = own.filter((p) => p.blank || p.y1 - p.y0 >= MIN_PART_ROWS)
    if (band.columns && !kept.length) return
    for (const part of kept.length ? kept : [{ y0, y1, blank: true }]) {
      const cols = part.blank ? null : contentColumns(edge, gray, part.y0, part.y1, bg)
      const whitespace = cols === null
      const box: Box = whitespace
        ? { x: laneX, y: part.y0 - shift, w: edge.cols, h: part.y1 - part.y0 }
        : { x: laneX + cols.x0, y: part.y0 - shift, w: cols.x1 - cols.x0, h: part.y1 - part.y0 }
      const area = box.w * box.h
      const tags = [inserted ? 'inserted-rows' : 'deleted-rows']
      if (whitespace) tags.push('whitespace-only')
      // A few rows of padding that grew or shrank stay in the band map but are
      // not worth a region: nobody wants a full-width sliver in the list.
      if (whitespace && box.h <= SLIVER_ROWS) continue
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
    if (band.columns) {
      ctx.mats.release(edge)
      ctx.mats.release(gray)
    }
  })
  return out
}

/**
 * Refine the offset of matched bands that follow a structural gap to the
 * pixel: strips quantise a shift to stripPx, and a block whose rows were
 * replaced may also have moved a little, so every offset within a strip is
 * tried and the one with the smallest pixel difference kept. Bands that
 * continue the previous offset are left alone: it is already accurate.
 * Matched neighbours that end up with the same offset are merged.
 */
function refineOffsets(bands: Band[], B: GlobalAlignOutput['baseline'], W: Warped, stripPx: number, exactRows = false): Band[] {
  const pad = W.padTop
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
    // Rows that are the same bytes on both sides have nothing to refine.
    if (!shifted || len < MIN_REFINE_ROWS || (exactRows && band.similarity >= 1)) continue
    const c0 = band.candidate.start + pad
    const dataB = B.grayBlur.data
    const dataW = W.grayBlur.data
    const at = (d: number): number => {
      const cd = c0 + d
      if (cd < 0 || cd + len > W.height) return Infinity
      return bandDifference(dataB, dataW, B.width, band.baseline.start, cd, len, band.columns?.start ?? 0, band.columns?.end ?? B.width)
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
  const merged: Band[] = []
  for (const band of bands) {
    const last = merged[merged.length - 1]
    const sameLane = last?.columns?.start === band.columns?.start && last?.columns?.end === band.columns?.end
    if (last && sameLane && last.kind === 'matched' && band.kind === 'matched' && last.offset === band.offset && last.baseline.end >= band.baseline.start) {
      const n1 = last.baseline.end - last.baseline.start
      const n2 = band.baseline.end - band.baseline.start
      last.similarity = (last.similarity * n1 + band.similarity * n2) / Math.max(1, n1 + n2)
      last.baseline = { start: last.baseline.start, end: Math.max(last.baseline.end, band.baseline.end) }
      last.candidate = { start: last.candidate.start, end: Math.max(last.candidate.end, band.candidate.end) }
    } else merged.push({ ...band })
  }
  return merged
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
    // The map is scored against its rivals as aligned; only the winner is
    // folded, so a one-row wobble never costs it the vote.
    const finish = (aligned: Band[], stripPx: number, matchedFraction: number): StructuralAlignOutput => {
      const bands = foldWobble(aligned)
      return {
        ...input,
        bands,
        stripPx,
        matchedFraction,
        edges,
        gapRegions: gapRegions(ctx, input, bands, edges),
      }
    }

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
    // Warnings are buffered per band map: only the map that wins the
    // arbitration below reports its cropped edges.
    const later: Array<() => void> = []
    const stripWarnings: Array<() => void> = []
    const buffered = (into: Array<() => void>): Warn => (...args) => {
      into.push(() => ctx.warn(...args))
    }
    let bands = refineOffsets(dropCroppedEdges(buffered(stripWarnings), absorbTinyGaps(bandsRaw, TINY_GAP_STRIPS * stripPx), B.height, W), B, W, stripPx)
    later.push(...stripWarnings)

    // Same-scale captures: the pixels can settle the row pairing exactly,
    // where strips (8 px) cannot once an insertion of some other height sits
    // above a block. The exact-cell count arbitrates, so a row alignment
    // that explains fewer pixels than the strips never replaces them.
    if (exactCapable(input)) {
      const rowAlign = ctx.time('rowAlign', () => exactRowBands(input))
      if (rowAlign && rowAlign.bands.length) {
        const rowWarnings: Array<() => void> = []
        const dbg = debugSink()
        // Side-by-side columns that moved on their own leave the row bands in
        // a tangle the strips may beat; the lanes untangle it first, so the
        // arbitration sees the row alignment at its best.
        const refined = laneAlign(input, refineOffsets(dropCroppedEdges(buffered(rowWarnings), rowAlign.bands, B.height, W), B, W, stripPx, true), rowAlign.exact, edges, stripPx, dbg)
        const grayB = B.grayBlur.data
        const grayW = W.grayBlur.data
        const viaRows = exactContentCells(refined, grayB, grayW, B.width, B.height, W.height, pad)
        const viaStrips = exactContentCells(bands, grayB, grayW, B.width, B.height, W.height, pad)
        if (dbg) dbg('rowAlign', { viaRows, viaStrips, bands: refined.map((b) => `${b.kind[0]}${b.baseline.start}-${b.baseline.end}@${b.offset}${b.columns ? `[${b.columns.start}-${b.columns.end}]` : ''}`) })
        if (viaRows >= viaStrips) {
          bands = refined
          later.length = 0
          later.push(...rowWarnings)
        }
      }
    }
    for (const emit of later) emit()

    // The strip signatures can be fooled (a re-themed panel makes every strip
    // of a section look new, and free end gaps then let a far-fetched match
    // win). The pixels decide: when the plain global alignment has more
    // pixel-exact cells than the band map, the band map is discarded.
    if (bands.length > 1) {
      const grayB = B.grayBlur.data
      const grayW = W.grayBlur.data
      const aligned = exactContentCells(bands, grayB, grayW, B.width, B.height, W.height, pad)
      const diagonal = exactContentCells(singleBand(shared), grayB, grayW, B.width, B.height, W.height, pad)
      const dbg = debugSink()
      if (dbg) dbg('exactCells', { aligned, diagonal, bands: bands.map((b) => `${b.kind[0]}${b.baseline.start}-${b.baseline.end}@${b.offset}`) })
      if (diagonal > aligned * EXACT_MARGIN) {
        ctx.warn('STRUCT_WEAK_MATCH', 'the strip alignment explained fewer pixels than the global alignment and was discarded', { alignedCells: aligned, diagonalCells: diagonal })
        return finish(singleBand(shared), stripPx, 1)
      }
    }

    let matchedRows = 0
    let consideredRows = 0
    for (const band of bands) {
      if (band.kind === 'matched') matchedRows += band.baseline.end - band.baseline.start
      if (band.kind !== 'inserted') consideredRows += band.baseline.end - band.baseline.start
    }
    const matchedFraction = Math.min(1, matchedRows / Math.max(1, consideredRows))
    if (matchedFraction < WEAK_MATCH) {
      // When one block changed its look entirely (a code panel that switched
      // theme, a redesigned footer) the strip alignment can prefer a tiny
      // far-fetched match plus free end gaps over the obvious diagonal, and
      // then reports the whole page as removed. The global alignment already
      // put the shared content on the diagonal; if that lines up more strips
      // than the sequence alignment kept, trust it and compare band by band.
      const overlap = Math.min(nB, cIndex.length)
      let diagonal = 0
      for (let i = 0; i < overlap; i++) if (similarity(sigB, bStart + i, sigC, cStart + i) >= st.matchThreshold) diagonal++
      const diagonalFraction = overlap ? diagonal / overlap : 0
      // Strip signatures see a hero next to a re-themed code panel as a
      // different strip; the pixels do not lie. Count the rows that are
      // the same on the diagonal to the pixel.
      const y0 = Math.max(0, Math.ceil(W.extent.top))
      const y1 = Math.min(shared, Math.floor(W.extent.bottom))
      let exact = 0
      let considered = 0
      const grayB = B.grayBlur.data
      const grayW = W.grayBlur.data
      for (let y = y0; y < y1; y += REFINE_STEP) {
        considered++
        if (bandDifference(grayB, grayW, B.width, y, y + pad, 1) < EXACT_ROW_MAD) exact++
      }
      const exactFraction = considered ? exact / considered : 0
      const percent = Math.round(matchedFraction * 100)
      if (diagonalFraction > matchedFraction || exactFraction >= matchedFraction || input.confidence < 0.3) {
        ctx.warn('STRUCT_WEAK_MATCH', `only ${percent}% of the baseline rows found a counterpart in the candidate; compared on the global alignment instead`, {
          matchedFraction,
          diagonalFraction,
          exactFraction,
        })
        return finish(singleBand(shared), stripPx, Math.max(matchedFraction, diagonalFraction, exactFraction))
      }
      ctx.warn('STRUCT_WEAK_MATCH', `only ${percent}% of the baseline rows found a counterpart in the candidate`, { matchedFraction, diagonalFraction, exactFraction })
    }
    return finish(bands, stripPx, matchedFraction)
  },
}
