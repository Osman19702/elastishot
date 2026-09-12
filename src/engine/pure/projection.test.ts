import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bestShift, colProfile, ncc, rowProfile } from './projection.ts'

test('row and column profiles are means', () => {
  const data = new Uint8Array([0, 10, 20, 30, 40, 50])
  assert.deepEqual([...rowProfile(data, 3, 2)], [10, 40])
  assert.deepEqual([...colProfile(data, 3, 2)], [15, 25, 35])
})

test('ncc is 1 for identical windows and 0 for flat ones', () => {
  const a = new Float32Array([1, 5, 2, 8, 3])
  assert.ok(Math.abs(ncc(a, 0, a, 0, 5) - 1) < 1e-6)
  assert.equal(ncc(new Float32Array([2, 2, 2]), 0, a, 0, 3), 0)
})

test('bestShift recovers a known offset', () => {
  const n = 200
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = Math.sin(i / 7) + Math.cos(i / 3)
  const d = 23
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) b[i] = i - d >= 0 ? a[i - d]! : 0
  // b[i] = a[i - d]  =>  a[i] = b[i + d]  =>  shift = -d
  const r = bestShift(a, b, 40)
  assert.equal(r.shift, -d)
  assert.ok(r.ncc > 0.99)
})
