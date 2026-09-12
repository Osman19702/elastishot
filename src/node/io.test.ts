import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { isElastishotError } from '../core/errors.ts'
import { createImage, getPixel, imagesEqual, setPixel } from '../core/image.ts'
import { decodeImage, encodeJpeg, encodePng, readImageFile, sniffFormat, writeImageFile } from './io.ts'

let tmp = ''
before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'elastishot-io-'))
})
after(() => rm(tmp, { recursive: true, force: true }))

test('PNG round trip preserves every byte including alpha', () => {
  const img = createImage(5, 3, [10, 20, 30, 255])
  setPixel(img, 4, 2, [1, 2, 3, 4])
  const bytes = encodePng(img)
  assert.equal(sniffFormat(bytes), 'png')
  const back = decodeImage(bytes)
  assert.equal(back.width, 5)
  assert.equal(back.height, 3)
  assert.ok(imagesEqual(img, back))
  assert.equal(back.source?.format, 'png')
})

test('JPEG decodes to approximately the same colours', () => {
  const img = createImage(8, 8, [200, 100, 50, 255])
  const bytes = encodeJpeg(img, 95)
  assert.equal(sniffFormat(bytes), 'jpeg')
  const back = decodeImage(bytes, { id: 'j' })
  const [r, g, b, a] = getPixel(back, 3, 3)
  assert.ok(Math.abs(r - 200) < 8 && Math.abs(g - 100) < 8 && Math.abs(b - 50) < 8, `got ${r},${g},${b}`)
  assert.equal(a, 255)
  assert.equal(back.source?.format, 'jpeg')
  assert.equal(back.source?.id, 'j')
})

test('unknown or corrupt bytes are rejected with E_DECODE', () => {
  assert.throws(() => decodeImage(new Uint8Array([1, 2, 3, 4, 5])), (e: unknown) => isElastishotError(e, 'E_DECODE'))
  const corrupt = encodePng(createImage(4, 4)).slice(0, 30)
  assert.throws(() => decodeImage(corrupt, { path: 'x.png' }), (e: unknown) => isElastishotError(e, 'E_DECODE') && /x\.png/.test((e as Error).message))
})

test('readImageFile reports missing files with E_INPUT_NOT_FOUND', async () => {
  await assert.rejects(readImageFile(path.join(tmp, 'nope.png')), (e: unknown) => isElastishotError(e, 'E_INPUT_NOT_FOUND'))
})

test('writeImageFile creates folders and readImageFile reads back', async () => {
  const img = createImage(6, 4, [0, 128, 255, 255])
  const file = path.join(tmp, 'nested', 'shot.png')
  await writeImageFile(file, img)
  const back = await readImageFile(file)
  assert.ok(imagesEqual(img, back))
  assert.equal(back.source?.path, file)
  assert.equal(back.source?.id, 'shot.png')
  const jpg = path.join(tmp, 'shot.jpg')
  await writeImageFile(jpg, img)
  assert.equal((await readImageFile(jpg)).source?.format, 'jpeg')
})
