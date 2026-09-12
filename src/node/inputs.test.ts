import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { isElastishotError } from '../core/errors.ts'
import { createImage, imagesEqual } from '../core/image.ts'
import type { ElementMap, Snapshot } from '../core/types.ts'
import { createSnapshotMeta, readSnapshotDir, sidecarPath, writeSnapshotDir } from './baselines.ts'
import { encodePng, writeImageFile } from './io.ts'
import { isRasterImage, isSnapshot, isUrl, resolveInput } from './inputs.ts'

const img = createImage(5, 3, [1, 2, 3, 255])
const map: ElementMap = {
  schema: 'elastishot.element-map/1',
  capturedAt: '2026-09-11T00:00:00.000Z',
  viewport: { width: 5, height: 3 },
  dpr: 1,
  fullPage: false,
  image: { width: 5, height: 3 },
  truncated: false,
  elements: [{ i: 0, locator: '#a', strategy: 'id', tag: 'div', name: 'a', box: { x: 0, y: 0, w: 2, h: 2 }, parent: null, fixed: false }],
}

let tmp = ''
let server: http.Server
let base = ''

before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'elastishot-inputs-'))
  const png = Buffer.from(encodePng(img))
  server = http.createServer((req, res) => {
    if (req.url === '/shot.png' || req.url === '/download?id=1') {
      res.writeHead(200, { 'content-type': req.url === '/shot.png' ? 'image/png' : 'application/octet-stream' })
      res.end(png)
    } else if (req.url === '/page') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><title>x</title>')
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(async () => {
  server.close()
  await rm(tmp, { recursive: true, force: true })
})

test('type guards and URL detection', () => {
  assert.equal(isUrl('https://example.com/a.png'), true)
  assert.equal(isUrl('C:\\shots\\a.png'), false)
  assert.equal(isUrl('./a.png'), false)
  assert.equal(isRasterImage(img), true)
  assert.equal(isRasterImage({ width: 1 }), false)
  assert.equal(isSnapshot({ image: img, meta: createSnapshotMeta() }), true)
  assert.equal(sidecarPath(path.join('x', 'foo.png')), path.join('x', 'foo.map.json'))
})

test('in-memory inputs pass through', async () => {
  const fromImage = await resolveInput(img)
  assert.equal(fromImage.kind, 'image')
  assert.equal(fromImage.image, img)
  const fromBytes = await resolveInput(encodePng(img))
  assert.equal(fromBytes.kind, 'bytes')
  assert.ok(imagesEqual(fromBytes.image, img))
  const snapshot: Snapshot = { image: img, elementMap: map, meta: createSnapshotMeta({ url: 'https://a.test/' }) }
  const fromSnapshot = await resolveInput(snapshot)
  assert.equal(fromSnapshot.kind, 'snapshot')
  assert.equal(fromSnapshot.source, 'https://a.test/')
  assert.equal(fromSnapshot.elementMap, map)
  await assert.rejects(resolveInput(42 as never), (e: unknown) => isElastishotError(e, 'E_INPUT_UNSUPPORTED'))
})

test('a file path loads the image and its sidecar map when present', async () => {
  const file = path.join(tmp, 'a.png')
  await writeImageFile(file, img)
  const bare = await resolveInput(file)
  assert.equal(bare.kind, 'file')
  assert.equal(bare.elementMap, null)
  await writeFile(sidecarPath(file), JSON.stringify(map))
  const withMap = await resolveInput(file)
  assert.equal(withMap.elementMap?.elements[0]?.locator, '#a')
  await writeFile(sidecarPath(file), '{"schema":"other"}')
  await assert.rejects(resolveInput(file), (e: unknown) => isElastishotError(e, 'E_DECODE'))
  await assert.rejects(resolveInput(path.join(tmp, 'missing.png')), (e: unknown) => isElastishotError(e, 'E_INPUT_NOT_FOUND'))
})

test('a snapshot folder round-trips image, map and meta', async () => {
  const dir = path.join(tmp, 'baselines', 'home')
  const meta = createSnapshotMeta({ url: 'https://a.test/', viewport: { width: 5, height: 3 } })
  await writeSnapshotDir(dir, { image: img, elementMap: map, meta })
  const back = await readSnapshotDir(dir)
  assert.ok(imagesEqual(back.image, img))
  assert.deepEqual(back.meta, meta)
  assert.equal(back.elementMap?.elements.length, 1)
  const resolved = await resolveInput(dir)
  assert.equal(resolved.kind, 'directory')
  assert.equal(resolved.meta?.url, 'https://a.test/')
  await assert.rejects(resolveInput(tmp), (e: unknown) => isElastishotError(e, 'E_INPUT_NOT_FOUND'))
})

test('a folder without meta.json still resolves', async () => {
  const dir = path.join(tmp, 'legacy')
  await writeImageFile(path.join(dir, 'baseline.png'), img)
  const back = await readSnapshotDir(dir)
  assert.equal(back.meta.schema, 'elastishot.snapshot/1')
  assert.equal(back.meta.elastishotVersion, 'unknown')
  assert.equal(back.elementMap, null)
})

test('image URLs are fetched by extension or by content', async () => {
  const byExt = await resolveInput(`${base}/shot.png`)
  assert.equal(byExt.kind, 'image-url')
  assert.ok(imagesEqual(byExt.image, img))
  const byContent = await resolveInput(`${base}/download?id=1`)
  assert.equal(byContent.kind, 'image-url')
  await assert.rejects(resolveInput(`${base}/nope.png`), (e: unknown) => isElastishotError(e, 'E_FETCH') && /404/.test((e as Error).message))
})

test('page URLs need a capture adapter', async () => {
  await assert.rejects(resolveInput(`${base}/page`), (e: unknown) => isElastishotError(e, 'E_INPUT_UNSUPPORTED') && /text\/html/.test((e as Error).message))
  const captured: string[] = []
  const side = await resolveInput(`${base}/page`, {
    capture: async (url) => {
      captured.push(url)
      return { image: img, elementMap: map, meta: createSnapshotMeta({ url }) }
    },
  })
  assert.equal(side.kind, 'page-url')
  assert.deepEqual(captured, [`${base}/page`])
  assert.equal(side.elementMap, map)
})
