/**
 * Zero-dependency static file server for tests: serves a folder on a random
 * port, index.html for directories, correct MIME types, no caching.
 *
 *   const server = await startStaticServer('test/fixtures/site')
 *   ... fetch(`${server.url}/v1/`) ...
 *   await server.close()
 */
import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
}

export async function startStaticServer(root, { host = '127.0.0.1', port = 0 } = {}) {
  const base = path.resolve(root)
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let pathname = decodeURIComponent(url.pathname)
    if (pathname.endsWith('/')) pathname += 'index.html'
    const file = path.resolve(base, `.${pathname}`)
    if (!file.startsWith(base)) {
      res.writeHead(403)
      res.end()
      return
    }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        if (!err && stat.isDirectory()) {
          res.writeHead(301, { location: `${url.pathname}/` })
          res.end()
          return
        }
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
        return
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      fs.createReadStream(file).pipe(res)
    })
  })
  server.listen(port, host)
  await once(server, 'listening')
  const address = server.address()
  return {
    url: `http://${host}:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
