/**
 * A zero-dependency static file server: a folder on a free port, index.html
 * for directories, correct types, no caching. `elastishot pr` serves built
 * sites with it, and the tests serve their fixture site.
 *
 *   const server = await startStaticServer('dist', { spa: true })
 *   ... capture `${server.url}/pricing` ...
 *   await server.close()
 */
import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

export interface StaticServerOptions {
  host?: string
  /** 0 picks a free port. */
  port?: number
  /** Answer unknown paths without a file extension with the root index.html, as single-page apps expect. */
  spa?: boolean
  /** Serve the folder under this path, e.g. '/docs/' for a site built for a project page. */
  basePath?: string
}

export interface StaticServer {
  /** Origin plus base path, without a trailing slash: `${url}/v1/`. */
  url: string
  port: number
  close(): Promise<void>
}

/** The file a URL path names inside root, or null when the path escapes it. */
export function resolveInside(root: string, urlPath: string): string | null {
  const file = path.resolve(root, `.${urlPath}`)
  // A sibling folder that starts with the root's name is outside it too.
  return file === root || file.startsWith(root + path.sep) ? file : null
}

export async function startStaticServer(root: string, options: StaticServerOptions = {}): Promise<StaticServer> {
  const host = options.host ?? '127.0.0.1'
  const base = path.resolve(root)
  const prefix = `/${(options.basePath ?? '').replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '')
  const send = (res: http.ServerResponse, file: string) => {
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    fs.createReadStream(file).pipe(res)
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let pathname: string
    try {
      pathname = decodeURIComponent(url.pathname)
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' })
      res.end('bad request')
      return
    }
    if (prefix) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
        return
      }
      pathname = pathname.slice(prefix.length) || '/'
    }
    if (pathname.endsWith('/')) pathname += 'index.html'
    const file = resolveInside(base, pathname)
    if (!file) {
      res.writeHead(403)
      res.end()
      return
    }
    fs.stat(file, (err, stat) => {
      if (!err && stat.isFile()) return send(res, file)
      if (!err && stat.isDirectory()) {
        res.writeHead(301, { location: `${url.pathname}/` })
        res.end()
        return
      }
      const index = path.join(base, 'index.html')
      if (options.spa && !path.extname(pathname) && fs.existsSync(index)) return send(res, index)
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    })
  })
  server.listen(options.port ?? 0, host)
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return {
    url: `http://${host}:${port}${prefix}`,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
