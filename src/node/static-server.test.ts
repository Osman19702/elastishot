import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { resolveInside, startStaticServer } from './static-server.ts'

let tmp = ''
before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'elastishot-static-'))
  await mkdir(path.join(tmp, 'site', 'docs'), { recursive: true })
  await mkdir(path.join(tmp, 'site-secrets'), { recursive: true })
  await writeFile(path.join(tmp, 'site', 'index.html'), '<h1>home</h1>')
  await writeFile(path.join(tmp, 'site', 'docs', 'index.html'), '<h1>docs</h1>')
  await writeFile(path.join(tmp, 'site', 'font.woff2'), 'x')
  await writeFile(path.join(tmp, 'site-secrets', 'key.txt'), 'secret')
})
after(() => rm(tmp, { recursive: true, force: true }))

/** A raw request: fetch would normalise the dot segments a traversal attempt relies on. */
function get(url: string, rawPath: string): Promise<{ status: number; type: string; body: string }> {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    http
      .get({ host: u.hostname, port: u.port, path: rawPath }, (res) => {
        let body = ''
        res.on('data', (d) => (body += d))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body }))
      })
      .on('error', reject)
  })
}

test('a path that leaves the root is refused, a sibling sharing its name included', () => {
  const root = path.join(tmp, 'site')
  assert.equal(resolveInside(root, '/docs/index.html'), path.join(root, 'docs', 'index.html'))
  assert.equal(resolveInside(root, '/../site-secrets/key.txt'), null)
  assert.equal(resolveInside(root, '/'), root)
})

test('serves files and folders, refuses escapes and bad escapes, and falls back for single-page apps', async () => {
  const plain = await startStaticServer(path.join(tmp, 'site'))
  const spa = await startStaticServer(path.join(tmp, 'site'), { spa: true })
  try {
    assert.deepEqual(await get(plain.url, '/'), { status: 200, type: 'text/html; charset=utf-8', body: '<h1>home</h1>' })
    assert.equal((await get(plain.url, '/docs')).status, 301)
    assert.equal((await get(plain.url, '/font.woff2')).type, 'font/woff2')
    assert.equal((await get(plain.url, '/..%2fsite-secrets/key.txt')).status, 403)
    assert.equal((await get(plain.url, '/%E0%A4%A')).status, 400)
    assert.equal((await get(plain.url, '/pricing')).status, 404)
    assert.deepEqual(await get(spa.url, '/pricing'), { status: 200, type: 'text/html; charset=utf-8', body: '<h1>home</h1>' })
    assert.equal((await get(spa.url, '/missing.js')).status, 404)
  } finally {
    await plain.close()
    await spa.close()
  }
})

test('a base path mounts the folder below it', async () => {
  const server = await startStaticServer(path.join(tmp, 'site'), { basePath: '/docs-site/' })
  try {
    assert.match(server.url, /\/docs-site$/)
    const origin = new URL(server.url).origin
    assert.equal((await get(origin, '/docs-site/')).body, '<h1>home</h1>')
    assert.equal((await get(origin, '/')).status, 404)
  } finally {
    await server.close()
  }
})
