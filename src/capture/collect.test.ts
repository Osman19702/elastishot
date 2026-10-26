import assert from 'node:assert/strict'
import { test } from 'node:test'

import { clipElements, type CollectedElement } from './collect.ts'

const el = (locator: string, y: number, h: number, parent: number | null): CollectedElement => ({ locator, strategy: 'testid', tag: 'div', name: locator, box: { x: 0, y, w: 100, h }, parent, fixed: false })

test('a map that fits the picture comes back unchanged', () => {
  const elements = [el('a', 0, 300, null), el('b', 10, 50, 0)]
  const out = clipElements(elements, 100, 300, 4)
  assert.deepEqual(out, elements)
  assert.equal(out[1], elements[1])
})

test('boxes past the bottom are clipped or dropped, and parents skip dropped elements', () => {
  const elements = [
    el('app', 0, 1000, null),
    el('row-1', 100, 120, 0),
    el('row-2', 260, 120, 0), // 260..380 crosses the 300 px edge
    el('below', 400, 100, 0), // entirely below
    el('child-of-below', 410, 20, 3),
  ]
  const out = clipElements(elements, 100, 300, 4)
  assert.deepEqual(out.map((e) => e.locator), ['app', 'row-1', 'row-2'])
  assert.deepEqual(out.map((e) => e.box.h), [300, 120, 40])
  assert.deepEqual(out.map((e) => e.parent), [null, 0, 0])
})

test('a child keeps its nearest kept ancestor when its parent is dropped', () => {
  const elements = [
    el('root', 0, 200, null),
    el('sliver', 198, 50, 0), // 2 px left inside the picture: below minSize
    el('inside', 150, 20, 1), // a child of the sliver that is still inside
  ]
  const out = clipElements(elements, 100, 200, 4)
  assert.deepEqual(out.map((e) => [e.locator, e.parent]), [['root', null], ['inside', 0]])
})
