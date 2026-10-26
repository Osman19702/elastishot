import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseCliArgs, parseFailOn, parseViewport, resolveViewportArg, UsageError } from './args.ts'

const rejects = (argv: string[], message: RegExp) =>
  assert.throws(() => parseCliArgs(argv), (e: unknown) => e instanceof UsageError && message.test((e as Error).message), argv.join(' '))

test('each command takes only the options it reads', () => {
  rejects(['run', '--viewport', '390x844'], /--viewport does not apply to run: run captures the viewports in the config/)
  rejects(['run', '--name', 'x'], /--name does not apply to run/)
  rejects(['compare', 'a', 'b', '--all'], /--all does not apply to compare \(compare takes --out, /)
  rejects(['approve', 'home', '--update'], /--update does not apply to approve/)
  rejects(['snapshot', 'http://x', '--junit'], /--junit does not apply to snapshot/)
  const run = parseCliArgs(['run', '--full-page', '--hide', '.ad', '--no-map', '--wait-for', '#ready'])
  assert.equal(run.fullPage, true)
  assert.deepEqual(run.hide, ['.ad'])
  assert.equal(run.noMap, true)
  assert.equal(parseCliArgs(['approve', '--help']).help, true)
})

test('--force needs --update, --config excludes --no-config, and --wait-for takes ms', () => {
  rejects(['run', '--force'], /--force only works with --update/)
  assert.equal(parseCliArgs(['run', '--update', '--force']).force, true)
  rejects(['compare', 'a', 'b', '--config', 'x.json', '--no-config'], /cannot be used together/)
  assert.equal(parseCliArgs(['compare', 'a', 'b', '--no-config']).noConfig, true)
  assert.equal(parseCliArgs(['compare', 'a', 'b', '--wait-for', '2000ms']).waitFor, 2000)
  assert.equal(parseCliArgs(['compare', 'a', 'b', '--wait-for', '[data-ms]']).waitFor, '[data-ms]')
})

test('--viewport is WxH or a configured name, and a configured size keeps its name', () => {
  const configured = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 2 },
  ]
  const named = parseCliArgs(['snapshot', 'http://x', '--viewport', 'mobile'])
  assert.equal(named.viewportName, 'mobile')
  assert.equal(resolveViewportArg(named, configured)?.name, 'mobile')
  assert.equal(resolveViewportArg(parseCliArgs(['snapshot', 'http://x', '--viewport', '390x844@2']), configured)?.name, 'mobile')
  assert.equal(resolveViewportArg(parseCliArgs(['snapshot', 'http://x', '--viewport', '390x844']), configured)?.name, '390x844')
  assert.equal(resolveViewportArg(parseCliArgs(['snapshot', 'http://x']), configured), undefined)
  assert.throws(
    () => resolveViewportArg(parseCliArgs(['snapshot', 'http://x', '--viewport', 'tablet']), configured),
    (e: unknown) => e instanceof UsageError && /configured: desktop, mobile/.test((e as Error).message),
  )
  rejects(['snapshot', 'http://x', '--viewport', 'big screen'], /--viewport must look like 1280x800/)
})

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
