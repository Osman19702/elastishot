import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyToPoint, multiply, scaling, translation } from '../../core/geometry.ts'
import { CoordinateMapper } from './transform.ts'

test('CoordinateMapper round-trips boxes through every space', () => {
  const sB = 0.5
  const sC = 0.8
  // candidate working -> baseline working: scale 1.1 then move by (3, -4)
  const tW = multiply(translation(3, -4), scaling(1.1))
  const m = new CoordinateMapper(sB, sC, tW)

  assert.deepEqual(m.baselineWorkingToOriginal({ x: 10, y: 20, w: 30, h: 40 }), { x: 20, y: 40, w: 60, h: 80 })
  assert.deepEqual(m.baselineOriginalToWorking({ x: 20, y: 40, w: 60, h: 80 }), { x: 10, y: 20, w: 30, h: 40 })
  assert.deepEqual(m.candidateWorkingToOriginal({ x: 8, y: 8, w: 16, h: 8 }), { x: 10, y: 10, w: 20, h: 10 })

  const candOriginal = { x: 100, y: 200, w: 50, h: 40 }
  const warped = m.candidateOriginalToWarped(candOriginal)
  const back = m.warpedToCandidateOriginal(warped)
  // rounding outward at each hop can only grow the box by a pixel or so
  assert.ok(back.x <= candOriginal.x && back.y <= candOriginal.y)
  assert.ok(back.x + back.w >= candOriginal.x + candOriginal.w && back.y + back.h >= candOriginal.y + candOriginal.h)
  assert.ok(back.w - candOriginal.w <= 4 && back.h - candOriginal.h <= 4)

  const p = applyToPoint(m.originalTransform(), { x: 100, y: 200 })
  // 100 * 0.8 = 80 -> *1.1 = 88 -> +3 = 91 -> /0.5 = 182
  assert.ok(Math.abs(p.x - 182) < 1e-9)
  // 200 * 0.8 = 160 -> *1.1 = 176 -> -4 = 172 -> /0.5 = 344
  assert.ok(Math.abs(p.y - 344) < 1e-9)
})
