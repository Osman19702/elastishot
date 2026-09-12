import assert from 'node:assert/strict'
import { test } from 'node:test'

import { matrixToCss } from './transform.ts'

test('affine matrices become CSS matrix() in column order', () => {
  // x' = 2x + 0.5y + 10, y' = -0.5x + 2y + 20
  assert.equal(matrixToCss([2, 0.5, 10, -0.5, 2, 20, 0, 0, 1]), 'matrix(2, -0.5, 0.5, 2, 10, 20)')
  assert.equal(matrixToCss([2, 0, 0, 0, 2, 0, 0, 0, 2]), 'matrix(1, 0, 0, 1, 0, 0)')
})

test('projective matrices become matrix3d() with perspective terms', () => {
  const css = matrixToCss([1, 0, 0, 0, 1, 0, 0.001, 0, 1])
  assert.match(css, /^matrix3d\(1, 0, 0, 0\.001, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1\)$/)
  assert.equal(matrixToCss([1, 0]), 'none')
})
