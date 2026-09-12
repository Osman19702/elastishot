/**
 * Snapshot folders on disk:
 *
 *   <dir>/baseline.png        the image
 *   <dir>/baseline.map.json   element map (optional)
 *   <dir>/meta.json           elastishot.snapshot/1
 *
 * Run folders store candidates with the same layout under candidate.* names.
 * A plain image file may carry a sidecar map next to it: foo.png + foo.map.json.
 */
import { readFile, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ElastishotError } from '../core/errors.ts'
import type { ElementMap, Snapshot, SnapshotMeta } from '../core/types.ts'
import { parseElementMap } from '../locators/element-map.ts'
import { decodeImage, encodePng } from './io.ts'
import { ELASTISHOT_VERSION } from './version.ts'

export const SNAPSHOT_SCHEMA = 'elastishot.snapshot/1'

export interface SnapshotFileNames {
  image: string
  map: string
  meta: string
}

export const BASELINE_FILES: SnapshotFileNames = { image: 'baseline.png', map: 'baseline.map.json', meta: 'meta.json' }
export const CANDIDATE_FILES: SnapshotFileNames = { image: 'candidate.png', map: 'candidate.map.json', meta: 'meta.json' }

/** foo.png -> foo.map.json */
export function sidecarPath(imagePath: string): string {
  const ext = path.extname(imagePath)
  return `${imagePath.slice(0, imagePath.length - ext.length)}.map.json`
}

const isMissing = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === 'ENOENT'

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (e) {
    if (isMissing(e)) return null
    throw new ElastishotError('E_INPUT_NOT_FOUND', `cannot read ${filePath}`, { cause: e })
  }
}

export async function readMapFile(filePath: string): Promise<ElementMap | null> {
  const text = await readOptionalText(filePath)
  return text === null ? null : parseElementMap(text, filePath)
}

/** The element map stored next to an image, or null when there is none. */
export function readSidecarMap(imagePath: string): Promise<ElementMap | null> {
  return readMapFile(sidecarPath(imagePath))
}

export function createSnapshotMeta(partial: Partial<SnapshotMeta> = {}): SnapshotMeta {
  const meta: SnapshotMeta = {
    schema: SNAPSHOT_SCHEMA,
    capturedAt: new Date().toISOString(),
    dpr: 1,
    fullPage: false,
    elastishotVersion: ELASTISHOT_VERSION,
  }
  for (const [k, v] of Object.entries(partial)) if (v !== undefined) (meta as unknown as Record<string, unknown>)[k] = v
  return meta
}

function isSnapshotMeta(v: unknown): v is SnapshotMeta {
  return typeof v === 'object' && v !== null && (v as SnapshotMeta).schema === SNAPSHOT_SCHEMA
}

async function readMetaFile(filePath: string, imagePath: string): Promise<SnapshotMeta> {
  const text = await readOptionalText(filePath)
  if (text === null) {
    const s = await stat(imagePath)
    return createSnapshotMeta({ capturedAt: s.mtime.toISOString(), elastishotVersion: 'unknown' })
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new ElastishotError('E_DECODE', `${filePath} is not valid JSON`, { cause })
  }
  if (!isSnapshotMeta(value)) throw new ElastishotError('E_DECODE', `${filePath} is not an ${SNAPSHOT_SCHEMA} document`)
  return value
}

export async function isSnapshotDir(dir: string, names: SnapshotFileNames = BASELINE_FILES): Promise<boolean> {
  try {
    return (await stat(path.join(dir, names.image))).isFile()
  } catch {
    return false
  }
}

export async function readSnapshotDir(dir: string, names: SnapshotFileNames = BASELINE_FILES): Promise<Snapshot> {
  const imagePath = path.join(dir, names.image)
  let png: Buffer
  try {
    png = await readFile(imagePath)
  } catch (cause) {
    throw new ElastishotError('E_INPUT_NOT_FOUND', `${dir} is not a snapshot folder: cannot read ${names.image}`, { cause })
  }
  const image = decodeImage(png, { path: imagePath, id: dir })
  const elementMap = await readMapFile(path.join(dir, names.map))
  const meta = await readMetaFile(path.join(dir, names.meta), imagePath)
  return { image, png, elementMap, meta }
}

export async function writeSnapshotDir(dir: string, snapshot: Snapshot, names: SnapshotFileNames = BASELINE_FILES): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, names.image), snapshot.png ?? encodePng(snapshot.image))
  if (snapshot.elementMap) await writeFile(path.join(dir, names.map), JSON.stringify(snapshot.elementMap))
  await writeFile(path.join(dir, names.meta), `${JSON.stringify(snapshot.meta, null, 2)}\n`)
}
