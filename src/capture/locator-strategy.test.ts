import assert from 'node:assert/strict'
import { test } from 'node:test'

import { collapseWhitespace, escapeAttributeValue, implicitRole, isStableId } from './locator-strategy.ts'

test('isStableId rejects generated ids and keeps hand-written ones', () => {
  for (const good of ['faq', 'main-nav', 'cta_button', 'Section2']) assert.equal(isStableId(good), true, good)
  for (const bad of [':r1:', 'radix-:R2:', 'mui-12', 'ember123', 'react-select-2-input', 'headlessui-menu-1', 'v-abc', '__next', 'ng-star', 'item-12345', 'card-a1b2c3d4', '42', '', 'x'.repeat(65)]) {
    assert.equal(isStableId(bad), false, bad)
  }
})

test('implicitRole follows the HTML-ARIA mapping', () => {
  assert.equal(implicitRole('button', {}), 'button')
  assert.equal(implicitRole('a', { href: '#' }), 'link')
  assert.equal(implicitRole('a', {}), null)
  assert.equal(implicitRole('h2', {}), 'heading')
  assert.equal(implicitRole('input', { type: 'submit' }), 'button')
  assert.equal(implicitRole('input', { type: 'checkbox' }), 'checkbox')
  assert.equal(implicitRole('input', {}), 'textbox')
  assert.equal(implicitRole('input', { type: 'hidden' }), null)
  assert.equal(implicitRole('div', {}), null)
})

test('attribute values and whitespace', () => {
  assert.equal(escapeAttributeValue('say "hi" \\ there'), 'say \\"hi\\" \\\\ there')
  assert.equal(collapseWhitespace('  Get \n  started  '), 'Get started')
})

test('helpers are self-contained functions (safe to inline into the page)', () => {
  for (const fn of [isStableId, implicitRole, escapeAttributeValue, collapseWhitespace]) {
    const src = fn.toString()
    assert.match(src, /^function\s+\w+\s*\(/, fn.name)
    assert.doesNotMatch(src, /\bimport\b|\brequire\(/, fn.name)
  }
})
