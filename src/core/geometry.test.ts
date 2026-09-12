import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyToBox,
  applyToPoint,
  composeTransforms,
  coverage,
  decompose,
  fromAffine,
  identity,
  intersect,
  invert,
  iou,
  makeTransform,
  multiply,
  resizeTransform,
  roundOutward,
  scaling,
  touches,
  transformKindOf,
  translation,
  union,
} from './geometry.ts'

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps

test('intersect and union of boxes', () => {
  assert.deepEqual(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), { x: 5, y: 5, w: 5, h: 5 })
  assert.equal(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 }), null)
  assert.deepEqual(union({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), { x: 0, y: 0, w: 15, h: 15 })
  assert.equal(touches({ x: 0, y: 0, w: 10, h: 10 }, { x: 12, y: 0, w: 5, h: 5 }, 2), true)
  assert.equal(touches({ x: 0, y: 0, w: 10, h: 10 }, { x: 12, y: 0, w: 5, h: 5 }, 1), false)
})

test('iou and coverage', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 }
  assert.equal(iou(a, a), 1)
  assert.equal(iou(a, { x: 20, y: 20, w: 1, h: 1 }), 0)
  assert.ok(near(iou(a, { x: 0, y: 0, w: 10, h: 5 }), 0.5))
  assert.ok(near(coverage({ x: 2, y: 2, w: 4, h: 4 }, a), 1))
  assert.ok(near(coverage(a, { x: 0, y: 0, w: 5, h: 10 }), 0.5))
})

test('roundOutward grows fractional boxes and snaps near-integers', () => {
  assert.deepEqual(roundOutward({ x: 1.2, y: 2.7, w: 3.1, h: 1.1 }), { x: 1, y: 2, w: 4, h: 2 })
  assert.deepEqual(roundOutward({ x: 0, y: 0, w: 20.0000000001, h: 19.9999999999 }), { x: 0, y: 0, w: 20, h: 20 })
})

test('invert undoes multiply and rejects singular matrices', () => {
  const m = multiply(translation(5, -3), scaling(2, 0.5))
  const r = multiply(invert(m), m)
  identity().forEach((v, i) => assert.ok(near(r[i]!, v), `element ${i}`))
  assert.throws(() => invert([0, 0, 0, 0, 0, 0, 0, 0, 0]), RangeError)
})

test('applyToPoint and applyToBox with scale and translation', () => {
  const m = multiply(translation(10, 20), scaling(2))
  assert.deepEqual(applyToPoint(m, { x: 1, y: 1 }), { x: 12, y: 22 })
  assert.deepEqual(applyToBox(m, { x: 0, y: 0, w: 10, h: 5 }), { x: 10, y: 20, w: 20, h: 10 })
})

test('decompose recovers scale, rotation and translation', () => {
  const th = (30 * Math.PI) / 180
  const m = fromAffine([2 * Math.cos(th), -2 * Math.sin(th), 7, 2 * Math.sin(th), 2 * Math.cos(th), -4])
  const d = decompose(m)
  assert.ok(near(d.scaleX, 2))
  assert.ok(near(d.scaleY, 2))
  assert.ok(near(d.scale, 2))
  assert.ok(near(d.rotationDeg, 30))
  assert.ok(near(d.shear, 0))
  assert.equal(d.tx, 7)
  assert.equal(d.ty, -4)
  assert.equal(d.perspective, 0)
})

test('transformKindOf classifies matrices', () => {
  assert.equal(transformKindOf(identity()), 'identity')
  assert.equal(transformKindOf(translation(1, 0)), 'translation')
  assert.equal(transformKindOf(fromAffine([2, -1, 0, 1, 2, 0])), 'similarity')
  assert.equal(transformKindOf(scaling(2, 1)), 'affine')
  assert.equal(transformKindOf([1, 0, 0, 0, 1, 0, 0.001, 0, 1]), 'homography')
})

test('resizeTransform maps one size onto another', () => {
  const t = resizeTransform({ width: 320, height: 320 }, { width: 1080, height: 1350 })
  assert.equal(t.kind, 'affine')
  const p = applyToPoint(t.m, { x: 320, y: 320 })
  assert.ok(near(p.x, 1080))
  assert.ok(near(p.y, 1350))
})

test('composeTransforms applies inner first and keeps the broader kind', () => {
  const inner = makeTransform(scaling(2))
  const outer = makeTransform(translation(1, 1))
  const c = composeTransforms(outer, inner)
  assert.equal(c.kind, 'similarity')
  assert.deepEqual(applyToPoint(c.m, { x: 1, y: 1 }), { x: 3, y: 3 })
})
