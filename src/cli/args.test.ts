import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseCliArgs, parseFailOn, parseViewport, UsageError } from './args.ts'

test('commands, positionals and flags parse', () => {
  const a = parseCliArgs(['compare', 'a.png', 'b.png', '--threshold', '0.9', '--fail-on', 'added,removed', '--viewport', '390x844@2', '--full-page', '--hide', '.a', '--hide', '.b', '--json', '--out', 'runs/x', '--wait-for', '250'])
  assert.equal(a.command, 'compare')
  assert.deepEqual(a.positionals, ['a.png', 'b.png'])
  assert.equal(a.threshold, 0.9)
  assert.deepEqual(a.failOn, ['added', 'removed'])
  assert.deepEqual(a.viewport, { name: '390x844@2', width: 390, height: 844, deviceScaleFactor: 2 })
  assert.equal(a.fullPage, true)
  assert.deepEqual(a.hide, ['.a', '.b'])
  assert.equal(a.json, true)
  assert.equal(a.out, 'runs/x')
  assert.equal(a.waitFor, 250)
  assert.equal(parseCliArgs(['run', '--wait-for', '#ready']).waitFor, '#ready')
  assert.equal(parseCliArgs([]).command, null)
  assert.equal(parseCliArgs(['-h']).help, true)
  assert.equal(parseCliArgs(['--version']).version, true)
})

test('bad input is a UsageError with a helpful message', () => {
  assert.throws(() => parseCliArgs(['frobnicate']), (e: unknown) => e instanceof UsageError && /unknown command "frobnicate"/.test((e as Error).message))
  assert.throws(() => parseCliArgs(['compare', '--bogus']), (e: unknown) => e instanceof UsageError && /bogus/.test((e as Error).message))
  assert.throws(() => parseCliArgs(['compare', '--threshold', '7']), (e: unknown) => e instanceof UsageError && /--threshold/.test((e as Error).message))
  assert.throws(() => parseViewport('big'), UsageError)
  assert.throws(() => parseFailOn('added,blurry'), (e: unknown) => e instanceof UsageError && /blurry/.test((e as Error).message))
  assert.equal(parseFailOn('none'), 'none')
  assert.deepEqual(parseViewport('1280x800'), { name: '1280x800', width: 1280, height: 800 })
})
