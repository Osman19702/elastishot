/**
 * Turn whatever a caller hands us into an image plus an optional element map:
 * a decoded image, a Snapshot, raw bytes, a file path (with a sidecar map),
 * a snapshot folder, an image URL, or a page URL (captured via the adapter
 * passed in options).
 */
import { stat } from 'node:fs/promises'

import { ElastishotError } from '../core/errors.ts'
import type { ElementMap, RasterImage, Snapshot, SnapshotMeta } from '../core/types.ts'
import { readSidecarMap, readSnapshotDir } from './baselines.ts'
import { decodeImage, fetchBytes, readImageFile, sniffFormat } from './io.ts'

export type SideInput = string | Uint8Array | RasterImage | Snapshot

export type InputKind = 'image' | 'bytes' | 'file' | 'directory' | 'image-url' | 'page-url' | 'snapshot'

export interface ResolvedSide {
  kind: InputKind
  /** Human-readable origin: path, URL or label. */
  source: string
  image: RasterImage
  elementMap: ElementMap | null
  meta?: SnapshotMeta
  snapshot?: Snapshot
}

export interface ResolveInputOptions {
  /** Captures a web page; without it page URLs are rejected. */
  capture?: (url: string) => Promise<Snapshot>
}

const IMAGE_EXT = /\.(png|jpe?g)$/i

export function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s)
}

export function isRasterImage(v: unknown): v is RasterImage {
  return typeof v === 'object' && v !== null && (v as RasterImage).data instanceof Uint8ClampedArray && typeof (v as RasterImage).width === 'number'
}

export function isSnapshot(v: unknown): v is Snapshot {
  return typeof v === 'object' && v !== null && isRasterImage((v as Snapshot).image) && typeof (v as Snapshot).meta === 'object'
}

export async function resolveInput(input: SideInput, options: ResolveInputOptions = {}): Promise<ResolvedSide> {
  if (isSnapshot(input)) {
    return {
      kind: 'snapshot',
      source: input.meta.url ?? input.image.source?.id ?? 'snapshot',
      image: input.image,
      elementMap: input.elementMap ?? null,
      meta: input.meta,
      snapshot: input,
    }
  }
  if (isRasterImage(input)) {
    const s = input.source
    return { kind: 'image', source: s?.id ?? s?.path ?? s?.url ?? 'image', image: input, elementMap: null }
  }
  if (input instanceof Uint8Array) {
    return { kind: 'bytes', source: 'bytes', image: decodeImage(input, { id: 'bytes' }), elementMap: null }
  }
  if (typeof input !== 'string') {
    throw new ElastishotError('E_INPUT_UNSUPPORTED', 'input must be a path, a URL, image bytes, a RasterImage or a Snapshot')
  }
  return isUrl(input) ? resolveUrl(input, options) : resolvePath(input)
}

async function resolvePath(p: string): Promise<ResolvedSide> {
  let s
  try {
    s = await stat(p)
  } catch (cause) {
    throw new ElastishotError('E_INPUT_NOT_FOUND', `no such file or folder: ${p}`, { cause })
  }
  if (s.isDirectory()) {
    const snapshot = await readSnapshotDir(p)
    return { kind: 'directory', source: p, image: snapshot.image, elementMap: snapshot.elementMap ?? null, meta: snapshot.meta, snapshot }
  }
  return { kind: 'file', source: p, image: await readImageFile(p), elementMap: await readSidecarMap(p) }
}

async function resolveUrl(url: string, options: ResolveInputOptions): Promise<ResolvedSide> {
  const { bytes, contentType } = await fetchBytes(url)
  const looksLikeImage = IMAGE_EXT.test(new URL(url).pathname) || contentType.startsWith('image/') || sniffFormat(bytes) !== 'unknown'
  if (looksLikeImage) {
    return { kind: 'image-url', source: url, image: decodeImage(bytes, { url, id: url }), elementMap: null }
  }
  if (!options.capture) {
    throw new ElastishotError(
      'E_INPUT_UNSUPPORTED',
      `${url} is a web page (${contentType || 'unknown content type'}); capturing pages needs the Playwright adapter from elastishot/capture`,
    )
  }
  const snapshot = await options.capture(url)
  return { kind: 'page-url', source: url, image: snapshot.image, elementMap: snapshot.elementMap ?? null, meta: snapshot.meta, snapshot }
}
