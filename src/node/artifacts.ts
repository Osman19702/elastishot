/**
 * Write everything a compared pair produces into its run folder and describe
 * it as a PairReport with paths relative to the run root.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { resizeImage } from '../core/image.ts'
import type { CompareResult, RasterImage } from '../core/types.ts'
import type { LocatorReport } from '../locators/index.ts'
import { renderPairReport } from '../report/pair.ts'
import type { PairArtifacts, PairReport, PairStatus } from '../report/schema.ts'
import { CANDIDATE_FILES, writeSnapshotDir } from './baselines.ts'
import type { ResolvedSide } from './inputs.ts'
import { encodeJpeg, encodePng } from './io.ts'
import { pairDirFor } from './runs.ts'

export interface PairWriteInput {
  id: string
  name: string
  target?: string
  viewport?: { name?: string; width: number; height: number; deviceScaleFactor?: number }
  baseline: ResolvedSide
  candidate: ResolvedSide
  result: CompareResult | null
  locators: LocatorReport | null
  status: PairStatus
  failReasons: string[]
  error?: string
  durationMs: number
}

export interface ArtifactOptions {
  /** 'files' writes PNGs next to the pages; 'inline' embeds data URIs (single-file reports). */
  images: 'files' | 'inline'
  /** Width of the JPEG previews on the summary page. */
  thumbWidth?: number
}

const toDataUri = (bytes: Uint8Array, type: string): string => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`

function thumbnail(img: RasterImage, width: number): string {
  const w = Math.min(width, img.width)
  const h = Math.max(1, Math.round((img.height * w) / img.width))
  return toDataUri(encodeJpeg(resizeImage(img, w, h), 70), 'image/jpeg')
}

/** Write the pair's images, JSON and detail page; returns its PairReport (paths relative to runDir). */
export async function writePairArtifacts(runDir: string, input: PairWriteInput, options: ArtifactOptions): Promise<PairReport> {
  const dir = pairDirFor(runDir, input.id)
  await mkdir(dir, { recursive: true })
  const rel = (file: string) => `pairs/${input.id}/${file}`
  const inline = options.images === 'inline'
  const refs: Record<string, string> = {}
  const images: Array<[string, RasterImage | undefined, Uint8Array | undefined]> = [
    ['baseline.png', input.baseline.image, input.baseline.snapshot?.png],
    ['candidate.png', input.candidate.image, input.candidate.snapshot?.png],
    ['diff.png', input.result?.artifacts.diffMask, undefined],
    ['overlay.png', input.result?.artifacts.overlay, undefined],
    ['warped.png', input.result?.artifacts.warpedCandidate, undefined],
    ['candidate-overlay.png', input.result?.artifacts.candidateOverlay, undefined],
  ]
  for (const [file, image, bytes] of images) {
    if (!image) continue
    const png = bytes ?? encodePng(image)
    if (inline) refs[file] = toDataUri(png, 'image/png')
    else {
      await writeFile(path.join(dir, file), png)
      refs[file] = rel(file)
    }
  }
  // The candidate is stored like a snapshot so `approve` can promote it.
  if (!inline && input.candidate.snapshot) {
    await writeSnapshotDir(dir, { ...input.candidate.snapshot, png: input.candidate.snapshot.png ?? encodePng(input.candidate.image) }, CANDIDATE_FILES)
  }
  if (!inline && input.baseline.elementMap) await writeFile(path.join(dir, 'baseline.map.json'), JSON.stringify(input.baseline.elementMap))
  if (!inline && input.candidate.elementMap && !input.candidate.snapshot) await writeFile(path.join(dir, 'candidate.map.json'), JSON.stringify(input.candidate.elementMap))

  const thumbWidth = options.thumbWidth ?? 320
  const artifacts: PairArtifacts = {
    ...(refs['diff.png'] ? { diff: refs['diff.png'] } : {}),
    ...(refs['overlay.png'] ? { overlay: refs['overlay.png'] } : {}),
    ...(refs['warped.png'] ? { warped: refs['warped.png'] } : {}),
    ...(refs['candidate-overlay.png'] ? { candidateOverlay: refs['candidate-overlay.png'] } : {}),
    thumbs: {
      baseline: thumbnail(input.baseline.image, thumbWidth),
      candidate: thumbnail(input.candidate.image, thumbWidth),
      ...(input.result?.artifacts.diffMask ? { diff: thumbnail(input.result.artifacts.diffMask, thumbWidth) } : {}),
    },
    report: rel('report.html'),
  }
  const pair: PairReport = {
    id: input.id,
    name: input.name,
    ...(input.target ? { target: input.target } : {}),
    ...(input.viewport ? { viewport: input.viewport } : {}),
    status: input.status,
    failReasons: input.failReasons,
    ...(input.error ? { error: input.error } : {}),
    baseline: {
      source: input.baseline.source,
      ...(refs['baseline.png'] ? { image: refs['baseline.png'] } : {}),
      map: Boolean(input.baseline.elementMap),
      ...(input.baseline.meta ? { meta: input.baseline.meta } : {}),
      size: { width: input.baseline.image.width, height: input.baseline.image.height },
    },
    candidate: {
      source: input.candidate.source,
      ...(refs['candidate.png'] ? { image: refs['candidate.png'] } : {}),
      map: Boolean(input.candidate.elementMap),
      ...(input.candidate.meta ? { meta: input.candidate.meta } : {}),
      size: { width: input.candidate.image.width, height: input.candidate.image.height },
    },
    ...(input.result ? { summary: input.result.summary, alignment: input.result.alignment } : {}),
    regions: input.result?.regions ?? [],
    ...(input.locators ? { locators: input.locators } : {}),
    artifacts,
    durationMs: input.durationMs,
  }
  await writeFile(path.join(dir, 'result.json'), JSON.stringify({ ...pair, artifacts: { ...artifacts, thumbs: undefined } }, null, 2))
  // The detail page lives inside the pair folder: rebase the image references.
  const local = (p: string | undefined) => (p && !p.startsWith('data:') ? p.replace(`pairs/${input.id}/`, '') : p)
  const forPage: PairReport = {
    ...pair,
    baseline: { ...pair.baseline, ...(pair.baseline.image ? { image: local(pair.baseline.image) } : {}) },
    candidate: { ...pair.candidate, ...(pair.candidate.image ? { image: local(pair.candidate.image) } : {}) },
    artifacts: {
      ...artifacts,
      ...(artifacts.diff ? { diff: local(artifacts.diff) } : {}),
      ...(artifacts.overlay ? { overlay: local(artifacts.overlay) } : {}),
      ...(artifacts.warped ? { warped: local(artifacts.warped) } : {}),
      ...(artifacts.candidateOverlay ? { candidateOverlay: local(artifacts.candidateOverlay) } : {}),
    },
  }
  await writeFile(path.join(dir, 'report.html'), renderPairReport(forPage))
  return pair
}
