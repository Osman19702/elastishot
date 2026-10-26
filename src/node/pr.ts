/**
 * `elastishot pr`: the base commit and the working tree, each prepared and
 * served on this machine in the same run, so fonts and the browser are the
 * same on both sides and no baseline is ever committed.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { ElastishotError } from '../core/errors.ts'
import { resolveTargets, type PrConfig, type PrSteps, type ResolvedConfig, type ResolvedTarget } from './config.ts'
import { addWorktree, chooseBase, gitIn, headState, removeWorktree, type BaseChoice } from './git.ts'
import { runStep } from './processes.ts'
import { startSide } from './serve.ts'
import { isHttpUrl, sharedOrigin, withOrigin } from './urls.ts'

/** Undo steps, run last-in-first-out when the run ends however it ends. */
export type Cleanup = () => Promise<void>

/**
 * The targets with their URLs moved onto a side's origin. With baseUrl, its
 * origin is replaced and its path kept; without, the one origin all
 * absolute target URLs share is. A target on another origin is an error: pr
 * compares the project's own pages, and an external page compared with
 * itself would look exactly like a clean result.
 */
export function prTargets(config: ResolvedConfig, filter: string[], origin: string): ResolvedTarget[] {
  const absolute = config.targets.map((t) => t.url).filter(isHttpUrl)
  const from = config.baseUrl ? new URL(config.baseUrl).origin : sharedOrigin(absolute)
  if (!config.baseUrl && absolute.length && !from) {
    throw new ElastishotError('E_CONFIG', `pr needs every target on one origin, or baseUrl with relative target URLs; the targets use ${[...new Set(absolute.map((u) => new URL(u).origin))].join(', ')}`)
  }
  const baseUrl = config.baseUrl ? withOrigin(config.baseUrl, origin) : `${origin}/`
  return resolveTargets(config, filter, { baseUrl }).map((t) => {
    const configured = config.targets.find((c) => c.name === t.name)!.url
    if (!isHttpUrl(configured)) return t
    const own = new URL(configured).origin
    if (own !== from) throw new ElastishotError('E_CONFIG', `target "${t.name}" is on ${own}, not ${from}; pr compares the project's own pages (use compare for external ones)`)
    return { ...t, url: withOrigin(configured, origin) }
  })
}

function stepsFor(spec: string | PrSteps | undefined, aString: 'base' | 'both'): { base?: string; head?: string } {
  if (!spec) return {}
  if (typeof spec === 'string') return aString === 'both' ? { base: spec, head: spec } : { base: spec }
  return { ...(spec.base ? { base: spec.base } : {}), ...(spec.head ? { head: spec.head } : {}) }
}

export interface OpenedSides {
  base: BaseChoice & { root: string; origin: string }
  head: { sha: string; dirty: boolean; root: string; origin: string }
  /** The temporary folder for the worktree and the base captures. */
  tmp: string
  /** Stop the base server once its captures are done. */
  stopBase(): Promise<void>
}

export interface OpenSidesOptions {
  /** The folder of the config, inside the repository; both trees are served from here. */
  configRoot: string
  pr: PrConfig
  base?: string
  keep?: boolean
  env?: Record<string, string | undefined>
  log: (line: string) => void
  signal?: AbortSignal
  /** Undo steps are appended here as they become needed. */
  cleanup: Cleanup[]
}

export async function openSides(o: OpenSidesOptions): Promise<OpenedSides> {
  const check = () => {
    if (o.signal?.aborted) throw new ElastishotError('E_ABORTED', 'interrupted')
  }
  const git = gitIn(o.configRoot)
  const top = path.resolve(await git(['rev-parse', '--show-toplevel']))
  const base = await chooseBase(git, { ...(o.base ? { base: o.base } : {}), env: o.env ?? process.env })
  const head = await headState(git)
  o.log(`elastishot: comparing ${head.dirty ? 'the working tree' : `HEAD (${head.sha.slice(0, 7)})`} with ${base.ref} (${base.sha.slice(0, 7)}, ${base.rule})`)
  check()

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'elastishot-pr-'))
  o.cleanup.push(async () => {
    if (o.keep) o.log(`elastishot: kept ${tmp}`)
    else await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
  // A worktree left by an interrupted run would block a new one of the same commit.
  await git(['worktree', 'prune']).catch(() => undefined)
  const worktree = path.join(tmp, 'base')
  await addWorktree(git, worktree, base.sha)
  o.cleanup.push(async () => {
    if (!o.keep) await removeWorktree(git, worktree)
  })
  // The config may live below the repository root, as in a monorepo package.
  const baseRoot = path.join(worktree, path.relative(top, o.configRoot))

  const install = stepsFor(o.pr.install, 'base')
  const build = stepsFor(o.pr.build, 'both')
  const timeoutMs = o.pr.timeoutMs ?? 600_000
  for (const [side, root] of [['base', baseRoot], ['head', o.configRoot]] as const) {
    for (const [kind, command] of [['install', install[side]], ['build', build[side]]] as const) {
      if (!command) continue
      check()
      o.log(`[${side}] ${kind}: ${command}`)
      await runStep(command, { cwd: root, label: `${side} ${kind}`, log: o.log, timeoutMs, env: { ELASTISHOT_SIDE: side } })
    }
  }

  check()
  const serve = o.pr.serve ?? {}
  const baseServer = await startSide('base', baseRoot, serve, o.log)
  o.cleanup.push(() => baseServer.stop())
  check()
  const headServer = await startSide('head', o.configRoot, serve, o.log)
  o.cleanup.push(() => headServer.stop())
  return {
    base: { ...base, root: baseRoot, origin: baseServer.origin },
    head: { ...head, root: o.configRoot, origin: headServer.origin },
    tmp,
    stopBase: () => baseServer.stop(),
  }
}
