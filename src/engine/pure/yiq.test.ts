import assert from 'node:assert/strict'
import { test } from 'node:test'

import { colorDelta, pixelDiff, YIQ_MAX_DELTA } from './yiq.ts'

test('identical pixels have zero distance and opposite pixels the maximum', () => {
  const black = [0, 0, 0, 255]
  const white = [255, 255, 255, 255]
  assert.equal(colorDelta(black, 0, black, 0), 0)
  const d = colorDelta(black, 0, white, 0)
  assert.ok(d > 0.9 * YIQ_MAX_DELTA && d <= YIQ_MAX_DELTA, `got ${d}`)
})

test('transparent pixels are blended over white before comparing', () => {
  const clear = [0, 0, 0, 0]
  const white = [255, 255, 255, 255]
  assert.ok(colorDelta(clear, 0, white, 0) < 1)
})

test('pixelDiff honours the threshold and the coverage mask', () => {
  const w = 3
  const h = 1
  const a = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255])
  const b = new Uint8ClampedArray([255, 255, 255, 255, 102, 102, 102, 255, 200, 200, 200, 255])
  const loose = pixelDiff(a, b, w, h, 0.1)
  assert.deepEqual([...loose.mask], [255, 0, 0])
  assert.equal(loose.changed, 1)
  assert.ok(loose.delta[0]! > 0.9)
  const strict = pixelDiff(a, b, w, h, 0.001)
  assert.deepEqual([...strict.mask], [255, 255, 0])
  const covered = pixelDiff(a, b, w, h, 0.1, [0, 255, 255])
  assert.equal(covered.changed, 0)
})

test('a radius tolerates one-pixel shifts but still catches new lines', () => {
  const w = 6
  const h = 3
  const white = [255, 255, 255, 255]
  const dark = [0, 0, 0, 255]
  const row = (cols: number[][]) => cols.flat()
  // an edge at x=3 in a, at x=4 in b (shifted right by one)
  const a = new Uint8ClampedArray([...row([white, white, white, dark, dark, dark]), ...row([white, white, white, dark, dark, dark]), ...row([white, white, white, dark, dark, dark])])
  const b = new Uint8ClampedArray([...row([white, white, white, white, dark, dark]), ...row([white, white, white, white, dark, dark]), ...row([white, white, white, white, dark, dark])])
  assert.equal(pixelDiff(a, b, w, h, 0.1).changed, 3)
  assert.equal(pixelDiff(a, b, w, h, 0.1, null, 1).changed, 0)
  // a new one-pixel line in the middle row of b
  const c = new Uint8ClampedArray([...row([white, white, white, white, white, white]), ...row([white, white, white, white, white, white]), ...row([white, white, white, white, white, white])])
  const d = new Uint8ClampedArray([...row([white, white, white, white, white, white]), ...row([dark, dark, dark, dark, dark, dark]), ...row([white, white, white, white, white, white])])
  assert.equal(pixelDiff(c, d, w, h, 0.1, null, 1).changed, 6)
})
