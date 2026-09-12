import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isElastishotError } from '../../src/core/errors.ts'
import { loadOpenCV } from '../../src/engine/cv/loader.ts'
import { MatScope } from '../../src/engine/cv/mat-scope.ts'
import { cvReady } from '../support/cv.ts'

test('the default runtime loads once and exposes the functions the engine needs', async () => {
  const cv = await cvReady
  assert.equal(typeof cv.Mat, 'function')
  assert.equal(typeof cv.ORB, 'function')
  assert.equal(typeof cv.estimateAffine2D, 'function')
  assert.equal(typeof cv.connectedComponentsWithStats, 'function')
  assert.equal(typeof cv.matchTemplate, 'function')
  assert.equal(await loadOpenCV(), cv)
  assert.equal(await loadOpenCV(cv), cv)
  assert.equal(await loadOpenCV(async () => cv), cv)
})

test('bad sources fail with E_OPENCV_LOAD', async () => {
  await assert.rejects(loadOpenCV({ notCv: true }), (e: unknown) => isElastishotError(e, 'E_OPENCV_LOAD'))
  await assert.rejects(loadOpenCV(async () => 42), (e: unknown) => isElastishotError(e, 'E_OPENCV_LOAD'))
})

test('MatScope frees what it tracks and tolerates double disposal', async () => {
  const cv = await cvReady
  const scope = new MatScope(cv)
  const m = scope.zeros(4, 4, cv.CV_8UC1)
  scope.mat()
  scope.fromArray(1, 2, cv.CV_8UC1, [1, 2])
  assert.equal(scope.size, 3)
  scope.release(m)
  assert.equal(scope.size, 2)
  scope.dispose()
  assert.equal(scope.size, 0)
  scope.dispose()
})
