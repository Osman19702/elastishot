import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { isElastishotError } from '../core/errors.ts'
import { loadConfig, resolveConfig, resolveTargets, validateConfig } from './config.ts'

let tmp = ''
before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'elastishot-config-'))
})
after(() => rm(tmp, { recursive: true, force: true }))

test('defaults apply when there is no config file', async () => {
  const c = await loadConfig(tmp)
  assert.equal(c.configPath, null)
  assert.equal(c.baselineDir, path.join(tmp, 'baselines'))
  assert.equal(c.outDir, path.join(tmp, '.elastishot', 'runs'))
  assert.equal(c.threshold, 0.98)
  assert.deepEqual(c.viewports.map((v) => v.name), ['desktop'])
  assert.deepEqual(resolveTargets(c), [])
})

test('a JSON config is discovered, validated and expanded into targets x viewports', async () => {
  const dir = path.join(tmp, 'json')
  await import('node:fs/promises').then((fs) => fs.mkdir(dir, { recursive: true }))
  await writeFile(
    path.join(dir, 'elastishot.config.json'),
    JSON.stringify({
      baselineDir: 'shots',
      threshold: 0.95,
      viewports: [
        { name: 'desktop', width: 1280, height: 800 },
        { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 2 },
      ],
      capture: { fullPage: true },
      targets: [
        { name: 'home', url: 'https://a.test/' },
        { name: 'pricing', url: 'https://a.test/pricing', viewports: ['desktop'], capture: { waitFor: '#plans' }, ignoreRegions: [{ x: 0, y: 0, w: 10, h: 10 }] },
      ],
    }),
  )
  const c = await loadConfig(dir)
  assert.equal(c.configPath, path.join(dir, 'elastishot.config.json'))
  assert.equal(c.baselineDir, path.join(dir, 'shots'))
  const targets = resolveTargets(c)
  assert.deepEqual(targets.map((t) => t.key), ['home/desktop', 'home/mobile', 'pricing/desktop'])
  assert.deepEqual(targets[2]!.capture, { fullPage: true, waitFor: '#plans' })
  assert.deepEqual(targets[2]!.compare.ignoreRegions, [{ x: 0, y: 0, w: 10, h: 10 }])
  assert.equal(targets[1]!.viewport.deviceScaleFactor, 2)
  assert.deepEqual(resolveTargets(c, ['pricing']).map((t) => t.key), ['pricing/desktop'])
  assert.deepEqual(resolveTargets(c, ['home/mobile']).map((t) => t.key), ['home/mobile'])
  assert.throws(() => resolveTargets(c, ['blog']), (e: unknown) => isElastishotError(e, 'E_USAGE'))
})

test('a JS config can carry reporters', async () => {
  const dir = path.join(tmp, 'js')
  await import('node:fs/promises').then((fs) => fs.mkdir(dir, { recursive: true }))
  await writeFile(path.join(dir, 'elastishot.config.mjs'), `export default { targets: [{ name: 'home', url: 'https://a.test/' }], reporters: [{ name: 'noop', report() { return [] } }] }`)
  const c = await loadConfig(dir)
  assert.equal(c.reporters.length, 1)
  assert.equal(c.targets[0]!.name, 'home')
  await assert.rejects(loadConfig(dir, 'missing.config.js'), (e: unknown) => isElastishotError(e, 'E_CONFIG'))
})

test('validation names the offending key', () => {
  const bad = (raw: unknown, re: RegExp) => assert.throws(() => validateConfig(raw), (e: unknown) => isElastishotError(e, 'E_CONFIG') && re.test((e as Error).message))
  bad({ thresold: 0.9 }, /unknown key "thresold"/)
  bad({ threshold: 2 }, /threshold/)
  bad({ failOn: ['fuzzy'] }, /failOn/)
  bad({ viewports: [] }, /viewports/)
  bad({ viewports: [{ name: 'a', width: 1, height: 1 }, { name: 'a', width: 2, height: 2 }] }, /duplicate viewport/)
  bad({ targets: [{ name: 'x', url: 'ftp://x' }] }, /targets\[0\]/)
  bad({ targets: [{ name: 'x', url: 'https://x', foo: 1 }] }, /unknown key "foo"/)
  bad({ report: { images: 'blob' } }, /report\.images/)
  assert.throws(() => resolveConfig({ viewports: [{ name: 'd', width: 1, height: 1 }], targets: [{ name: 'x', url: 'https://x', viewports: ['tablet'] }] }, '/tmp'), /unknown viewport "tablet"/)
})

test('the nearest config in a parent folder is found, and a .cjs config loads', async () => {
  const root = path.join(tmp, 'monorepo')
  const app = path.join(root, 'packages', 'app')
  await mkdir(app, { recursive: true })
  await writeFile(path.join(root, 'elastishot.config.cjs'), "module.exports = { threshold: 0.9, targets: [{ name: 'home', url: 'https://a.test/' }] }\n")
  const c = await loadConfig(app)
  assert.equal(c.configPath, path.join(root, 'elastishot.config.cjs'))
  assert.equal(c.rootDir, root)
  assert.equal(c.threshold, 0.9)
  assert.equal(c.baselineDir, path.join(root, 'baselines'))
})

test('capture options are validated, and targets carry their ignore and expect', () => {
  const bad = (raw: unknown, re: RegExp) => assert.throws(() => validateConfig(raw), (e: unknown) => isElastishotError(e, 'E_CONFIG') && re.test((e as Error).message))
  bad({ capture: { locael: 'en-GB' } }, /config\.capture: unknown key "locael"/)
  bad({ capture: { animations: 'skip' } }, /animations must be "freeze" or "finish"/)
  bad({ capture: { reducedMotion: 'off' } }, /reducedMotion must be/)
  bad({ capture: { clock: { time: true } } }, /clock must be/)
  bad({ capture: { clock: { time: 0, mode: 'slow' } } }, /clock must be/)
  bad({ targets: [{ name: 'x', url: 'https://x', capture: { waitFor: 1, foo: 1 } }] }, /targets\[0\]\.capture: unknown key "foo"/)
  bad({ ignore: ['ok', ''] }, /ignore must be an array of locators/)
  bad({ targets: [{ name: 'x', url: 'https://x', expect: 7 }] }, /expect must be a selector/)
  const raw = validateConfig({
    ignore: ['[data-testid=clock]'],
    capture: { locale: 'en-GB', clock: { time: '2026-01-15T09:41:00Z', mode: 'install' }, animations: 'finish', storageState: { cookies: [], origins: [] } },
    targets: [{ name: 'home', url: 'https://a.test/', ignore: ['#ad'], expect: '[data-testid="screen-home"]' }],
  })
  const [home] = resolveTargets(resolveConfig(raw, '/tmp'))
  assert.deepEqual(home!.ignore, ['[data-testid=clock]', '#ad'])
  assert.equal(home!.capture.expect, '[data-testid="screen-home"]')
  assert.equal(home!.capture.locale, 'en-GB')
})

test('baseUrl takes relative target URLs; the pr block is validated', () => {
  const bad = (raw: unknown, re: RegExp) => assert.throws(() => validateConfig(raw), (e: unknown) => isElastishotError(e, 'E_CONFIG') && re.test((e as Error).message))
  bad({ baseUrl: 'localhost:3000' }, /baseUrl must be an http\(s\) URL/)
  bad({ targets: [{ name: 'x', url: 'file:///x' }] }, /needs an http\(s\) url, or a path relative to baseUrl/)
  bad({ pr: { serve: { dir: 'dist', command: 'npm run preview' } } }, /takes a dir or a command, not both/)
  bad({ pr: { install: { base: 'npm ci', middle: 'x' } } }, /install must be a command, or \{ base, head \}/)
  bad({ pr: { serve: { ready: { line: 'Local:' } } } }, /ready must be \{ log\?: string, url\?: string \}/)
  bad({ pr: { deploy: true } }, /config\.pr: unknown key "deploy"/)
  const c = resolveConfig(validateConfig({ baseUrl: 'https://a.test/app/', pr: { install: 'npm ci', build: { base: 'npm run build', head: false }, serve: { command: 'npx vite preview --port {port} --strictPort', ready: { log: 'Local:' } } }, targets: [{ name: 'home', url: './' }] }), '/tmp')
  assert.equal(resolveTargets(c)[0]!.url, 'https://a.test/app/')
  assert.equal(resolveTargets(c, [], { baseUrl: 'http://127.0.0.1:4173/' })[0]!.url, 'http://127.0.0.1:4173/')
  const noBase = resolveConfig(validateConfig({ targets: [{ name: 'home', url: '/' }] }), '/tmp')
  assert.throws(() => resolveTargets(noBase), (e: unknown) => isElastishotError(e, 'E_CONFIG') && /needs baseUrl in the config, or --base-url/.test((e as Error).message))
})
