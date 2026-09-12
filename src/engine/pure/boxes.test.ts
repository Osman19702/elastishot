import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Box } from '../../core/types.ts'
import { mergeBoxes } from './boxes.ts'

const id = (b: Box) => b

test('boxes within the gap merge transitively into one group', () => {
  const boxes: Box[] = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 14, y: 0, w: 10, h: 10 }, // 4 px from the first
    { x: 28, y: 0, w: 10, h: 10 }, // 4 px from the second, 18 from the first
    { x: 100, y: 100, w: 5, h: 5 },
  ]
  const groups = mergeBoxes(boxes, id, 4)
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0]!.box, { x: 0, y: 0, w: 38, h: 10 })
  assert.equal(groups[0]!.members.length, 3)
  assert.deepEqual(groups[1]!.box, { x: 100, y: 100, w: 5, h: 5 })
})

test('a smaller gap keeps them apart and overlapping boxes always merge', () => {
  const boxes: Box[] = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 14, y: 0, w: 10, h: 10 },
    { x: 5, y: 5, w: 3, h: 3 },
  ]
  const groups = mergeBoxes(boxes, id, 3)
  assert.equal(groups.length, 2)
  assert.equal(groups.find((g) => g.members.length === 2)!.box.w, 10)
})

test('empty input and vertical gaps', () => {
  assert.deepEqual(mergeBoxes([], id, 5), [])
  const groups = mergeBoxes([{ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 12, w: 10, h: 10 }], id, 2)
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0]!.box, { x: 0, y: 0, w: 10, h: 22 })
})
