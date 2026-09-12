import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isElastishotError } from './errors.ts'
import {
  blit,
  createImage,
  cropImage,
  fillRect,
  flattenAlpha,
  fromRGBA,
  getPixel,
  imagesEqual,
  resizeImage,
  setPixel,
  toGrayscale,
} from './image.ts'

test('fromRGBA validates size and byte length', () => {
  assert.throws(() => fromRGBA(2, 2, new Uint8ClampedArray(15)), (e: unknown) => isElastishotError(e, 'E_IMAGE_INVALID'))
  assert.throws(() => fromRGBA(0, 2, new Uint8ClampedArray(0)), /invalid size/)
  const img = fromRGBA(2, 1, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), { id: 'x' })
  assert.deepEqual(getPixel(img, 1, 0), [5, 6, 7, 8])
  assert.equal(img.source?.id, 'x')
})

test('createImage fills with the given colour', () => {
  const img = createImage(3, 2, [1, 2, 3, 4])
  assert.equal(img.data.length, 24)
  assert.deepEqual(getPixel(img, 2, 1), [1, 2, 3, 4])
})

test('fillRect clips to the image and cropImage clamps the box', () => {
  const img = createImage(10, 10, [9, 9, 9, 255])
  fillRect(img, { x: 5, y: 5, w: 50, h: 50 }, [1, 1, 1, 255])
  assert.deepEqual(getPixel(img, 4, 4), [9, 9, 9, 255])
  assert.deepEqual(getPixel(img, 9, 9), [1, 1, 1, 255])
  const c = cropImage(img, { x: 5, y: 5, w: 100, h: 100 })
  assert.equal(c.width, 5)
  assert.equal(c.height, 5)
  assert.deepEqual(getPixel(c, 0, 0), [1, 1, 1, 255])
  assert.throws(() => cropImage(img, { x: 20, y: 20, w: 5, h: 5 }), /outside/)
})

test('blit copies with clipping', () => {
  const dst = createImage(4, 4, [0, 0, 0, 255])
  const src = createImage(3, 3, [7, 7, 7, 255])
  blit(dst, src, 2, 2)
  assert.deepEqual(getPixel(dst, 3, 3), [7, 7, 7, 255])
  assert.deepEqual(getPixel(dst, 1, 1), [0, 0, 0, 255])
  blit(dst, src, -2, -2)
  assert.deepEqual(getPixel(dst, 0, 0), [7, 7, 7, 255])
  assert.deepEqual(getPixel(dst, 1, 1), [0, 0, 0, 255])
})

test('resizeImage averages when shrinking and interpolates when enlarging', () => {
  const img = createImage(4, 4, [0, 0, 0, 255])
  fillRect(img, { x: 0, y: 0, w: 2, h: 4 }, [200, 200, 200, 255])
  const half = resizeImage(img, 2, 2)
  assert.deepEqual(getPixel(half, 0, 0), [200, 200, 200, 255])
  assert.deepEqual(getPixel(half, 1, 0), [0, 0, 0, 255])
  const big = resizeImage(img, 8, 8)
  assert.equal(big.width, 8)
  assert.deepEqual(getPixel(big, 0, 0), [200, 200, 200, 255])
  assert.equal(getPixel(big, 3, 0)[0], 150)
  assert.deepEqual(getPixel(big, 7, 7), [0, 0, 0, 255])
  const same = resizeImage(img, 4, 4)
  assert.ok(imagesEqual(same, img))
  assert.notEqual(same.data, img.data)
})

test('flattenAlpha composites over white', () => {
  const clear = createImage(1, 1, [0, 0, 0, 0])
  assert.deepEqual(getPixel(flattenAlpha(clear), 0, 0), [255, 255, 255, 255])
  const half = createImage(1, 1, [0, 0, 0, 128])
  assert.equal(getPixel(flattenAlpha(half), 0, 0)[0], 127)
  const opaque = createImage(1, 1, [5, 5, 5, 255])
  assert.equal(flattenAlpha(opaque), opaque)
})

test('toGrayscale uses luma', () => {
  const img = createImage(2, 1, [255, 255, 255, 255])
  setPixel(img, 1, 0, [255, 0, 0, 255])
  const g = toGrayscale(img)
  assert.equal(g[0], 255)
  assert.equal(g[1], 76)
})
