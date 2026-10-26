/**
 * Serve one side of a pr run: a folder through the built-in static server,
 * or a command (a preview or dev server) on a port elastishot picked.
 */
import path from 'node:path'

import { ElastishotError } from '../core/errors.ts'
import { freePort, killTree, portAnswers, spawnCommand } from './processes.ts'
import { startStaticServer } from './static-server.ts'

export interface ServeConfig {
  /** A folder to serve, relative to the config folder (default '.'). */
  dir?: string
  /** With dir: answer unknown paths with index.html, as single-page apps expect. */
  spa?: boolean
  /** With dir: serve under this path, e.g. '/docs/'. */
  basePath?: string
  /** A server command; {port} and {host} are replaced, and PORT and HOST are set. */
  command?: string
  /** When the command's server is ready: a line it prints, and a URL that must answer below HTTP 500 (default '/'). */
  ready?: { log?: string; url?: string }
  /** How long the command may take to be ready (default 120 s). */
  timeoutMs?: number
  env?: Record<string, string>
}

export interface ServedSide {
  origin: string
  /** Stop the server; safe to call twice. */
  stop(): Promise<void>
}

const once = (fn: () => Promise<void>): (() => Promise<void>) => {
  let run: Promise<void> | null = null
  return () => (run ??= fn())
}

export async function startSide(side: 'base' | 'head', root: string, serve: ServeConfig, log?: (line: string) => void): Promise<ServedSide> {
  if (!serve.command) {
    const dir = path.resolve(root, serve.dir ?? '.')
    const server = await startStaticServer(dir, { ...(serve.spa ? { spa: true } : {}), ...(serve.basePath ? { basePath: serve.basePath } : {}) })
    log?.(`[${side}] serving ${dir} at ${server.url}`)
    return { origin: new URL(server.url).origin, stop: once(() => server.close()) }
  }

  // A port nothing answers on before the command starts, so whatever answers
  // there afterwards is this command's server and not a stale one left over
  // from an earlier run, which would make a comparison of the wrong tree look
  // perfectly clean.
  let port = await freePort()
  for (let i = 0; i < 3 && (await portAnswers(port)); i++) port = await freePort()
  if (await portAnswers(port)) throw new ElastishotError('E_SERVE', `${side}: could not find a free port`)
  const command = serve.command.replaceAll('{port}', String(port)).replaceAll('{host}', '127.0.0.1')
  let sawReadyLine = !serve.ready?.log
  const s = spawnCommand(command, {
    cwd: root,
    env: { PORT: String(port), HOST: '127.0.0.1', ELASTISHOT_SIDE: side, ...serve.env },
    label: side,
    ...(log ? { log } : {}),
    onLine: (line) => {
      if (serve.ready?.log && line.includes(serve.ready.log)) sawReadyLine = true
    },
  })
  const stop = once(() => killTree(s.child))
  const timeoutMs = serve.timeoutMs ?? 120_000
  const deadline = Date.now() + timeoutMs
  const readyPath = serve.ready?.url ?? '/'
  // Dev servers bind to localhost, which may be the IPv6 loopback only.
  const hosts = [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
  try {
    for (;;) {
      if (s.done()) throw new ElastishotError('E_SERVE', `${side}: "${command}" exited before its server was ready\n${s.tail()}`)
      if (Date.now() > deadline) {
        throw new ElastishotError(
          'E_SERVE',
          `${side}: nothing answered at ${new URL(readyPath, hosts[0]).href} within ${Math.round(timeoutMs / 1000)} s. Does the command listen on {port} (or $PORT)? A server that picks another port when its own is taken (Vite without --strictPort) is never compared.\n${s.tail()}`,
        )
      }
      if (sawReadyLine) {
        for (const origin of hosts) {
          try {
            const r = await fetch(new URL(readyPath, origin), { redirect: 'manual', signal: AbortSignal.timeout(2_000) })
            if (r.status < 500) {
              log?.(`[${side}] ready at ${origin}`)
              return { origin, stop }
            }
          } catch {
            /* not yet */
          }
        }
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  } catch (error) {
    await stop()
    throw error
  }
}
