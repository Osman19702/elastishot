/**
 * Image bytes in and out of Node: PNG (pngjs) and JPEG (jpeg-js) decoding,
 * PNG/JPEG encoding, file and URL reads. Pure JS, no native modules.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

import { ElastishotError } from '../core/errors.ts'
import { fromRGBA } from '../core/image.ts'
import type { ImageDescriptor, ImageFormat, RasterImage } from '../core/types.ts'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

export function sniffFormat(bytes: Uint8Array): ImageFormat {
  if (bytes.length >= 4 && PNG_MAGIC.every((b, i) => bytes[i] === b)) return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  return 'unknown'
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

const where = (source: ImageDescriptor): string => (source.path ?? source.url ? ` ${source.path ?? source.url}` : '')

/** Decode PNG or JPEG bytes into RGBA. Throws ElastishotError E_DECODE. */
export function decodeImage(bytes: Uint8Array, source: ImageDescriptor = {}): RasterImage {
  const format = sniffFormat(bytes)
  try {
    if (format === 'png') {
      const png = PNG.sync.read(asBuffer(bytes))
      return fromRGBA(png.width, png.height, png.data, { ...source, format })
    }
    if (format === 'jpeg') {
      const img = jpeg.decode(asBuffer(bytes), { useTArray: true, formatAsRGBA: true })
      return fromRGBA(img.width, img.height, img.data, { ...source, format })
    }
  } catch (cause) {
    if (cause instanceof ElastishotError) throw cause
    throw new ElastishotError('E_DECODE', `could not decode ${format} image${where(source)}: ${(cause as Error).message}`, { cause })
  }
  throw new ElastishotError('E_DECODE', `unsupported image format${where(source)}: only PNG and JPEG are accepted`)
}

export function encodePng(img: RasterImage): Uint8Array {
  const png = new PNG({ width: img.width, height: img.height })
  png.data = asBuffer(img.data as unknown as Uint8Array)
  return PNG.sync.write(png)
}

export function encodeJpeg(img: RasterImage, quality = 80): Uint8Array {
  return jpeg.encode({ width: img.width, height: img.height, data: asBuffer(img.data as unknown as Uint8Array) }, quality).data
}

export async function readImageFile(filePath: string): Promise<RasterImage> {
  return decodeImage(await readBytes(filePath), { path: filePath, id: path.basename(filePath) })
}

export async function readBytes(filePath: string): Promise<Buffer> {
  try {
    return await readFile(filePath)
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    throw new ElastishotError('E_INPUT_NOT_FOUND', `cannot read ${filePath}${code ? ` (${code})` : ''}`, { cause })
  }
}

/** Write PNG, or JPEG when the extension is .jpg/.jpeg. Creates parent folders. */
export async function writeImageFile(filePath: string, img: RasterImage, jpegQuality = 80): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const ext = path.extname(filePath).toLowerCase()
  const bytes = ext === '.jpg' || ext === '.jpeg' ? encodeJpeg(img, jpegQuality) : encodePng(img)
  await writeFile(filePath, bytes)
}

export interface FetchedBytes {
  bytes: Uint8Array
  contentType: string
}

export async function fetchBytes(url: string, init?: RequestInit): Promise<FetchedBytes> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (cause) {
    throw new ElastishotError('E_FETCH', `cannot fetch ${url}: ${(cause as Error).message}`, { cause })
  }
  if (!res.ok) throw new ElastishotError('E_FETCH', `cannot fetch ${url}: HTTP ${res.status}`)
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? '' }
}

export async function fetchImage(url: string): Promise<RasterImage> {
  const { bytes } = await fetchBytes(url)
  return decodeImage(bytes, { url, id: url })
}
