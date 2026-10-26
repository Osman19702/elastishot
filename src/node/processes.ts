/**
 * Child processes for `pr`: install and build steps, and servers whose whole
 * process tree must be gone when the run ends, however it ends.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import type { AddressInfo } from 'node:net'

import { ElastishotError } from '../core/errors.ts'

export interface Spawned {
  child: ChildProcess
  /** The last lines of output, for error messages. */
  tail(): string
  /** Resolves with the exit code once the process has ended (null when it could not start). */
  exited: Promise<number | null>
  /** Whether the process has ended. */
  done(): boolean
}

export interface SpawnOptions {
  cwd: string
  env?: Record<string, string>
  /** Prefix of every output line in the log: base, head. */
  label: string
  log?: (line: string) => void
  /** Called with every complete output line, for readiness checks. */
  onLine?: (line: string) => void
}

const live = new Set<ChildProcess>()
let exitHook = false

/** The last resort: whatever ends elastishot, no process tree it started outlives it. */
function installExitHook(): void {
  if (exitHook) return
  exitHook = true
  process.on('exit', () => {
    for (const child of live) killTreeSync(child)
  })
}

const ended = (child: ChildProcess): boolean => child.exitCode !== null || child.signalCode !== null

/**
 * Whether a POSIX process group still has a member. The shell that started a
 * server can be gone while the server it forked still listens, so the group,
 * not the shell, says whether the tree is gone. A member not yet reaped
 * counts; EPERM means one exists that this process may not signal.
 */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function until(done: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  for (;;) {
    if (done()) return true
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, 20))
  }
}

function killTreeSync(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    if (!ended(child)) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

/**
 * Run a command through the shell (npm is npm.cmd on Windows, and commands
 * are written as one string), in its own process group outside Windows so
 * the whole tree can be stopped.
 */
export function spawnCommand(command: string, o: SpawnOptions): Spawned {
  installExitHook()
  const child = spawn(command, {
    cwd: o.cwd,
    env: { ...process.env, ...o.env },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  live.add(child)
  const lines: string[] = []
  const rest = { out: '', err: '' }
  const feed = (key: 'out' | 'err') => (chunk: Buffer) => {
    const parts = (rest[key] + chunk.toString()).split(/\r?\n/)
    rest[key] = parts.pop() ?? ''
    for (const line of parts) {
      if (!line.trim()) continue
      lines.push(line)
      if (lines.length > 20) lines.shift()
      o.log?.(`[${o.label}] ${line}`)
      o.onLine?.(line)
    }
  }
  child.stdout?.on('data', feed('out'))
  child.stderr?.on('data', feed('err'))
  let finished = false
  const exited = new Promise<number | null>((resolve) => {
    const finish = (code: number | null) => {
      if (finished) return
      // A last line without a newline is still part of the story.
      for (const key of ['out', 'err'] as const) {
        if (rest[key].trim()) {
          lines.push(rest[key])
          o.log?.(`[${o.label}] ${rest[key]}`)
        }
        rest[key] = ''
      }
      if (lines.length > 20) lines.splice(0, lines.length - 20)
      finished = true
      live.delete(child)
      resolve(code)
    }
    child.on('error', (error) => {
      lines.push(error.message)
      finish(null)
    })
    // 'exit' can come before the last output has been read, and an error
    // message is often exactly that output. 'close' waits for the pipes; a
    // grandchild that keeps them open must not hold the run up, so 'exit'
    // finishes the job a moment later if 'close' has not.
    child.on('close', (code) => finish(code))
    child.on('exit', (code) => {
      setTimeout(() => finish(code), 250).unref()
    })
  })
  return { child, tail: () => lines.join('\n'), exited, done: () => finished }
}

/**
 * Stop a process and everything it started, and resolve once all of it is
 * gone: taskkill /T on Windows, the process group elsewhere, escalating to
 * SIGKILL after the grace period.
 */
export async function killTree(child: ChildProcess, graceMs = 3_000): Promise<void> {
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') {
    if (!ended(child)) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    await until(() => ended(child), graceMs)
  } else if (groupAlive(pid)) {
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      /* gone in between */
    }
    if (!(await until(() => !groupAlive(pid), graceMs))) {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        /* gone in between */
      }
      await until(() => !groupAlive(pid), 1_000)
    }
  }
  live.delete(child)
}

/** Run a step to the end; a non-zero exit or a timeout is E_SERVE with the last lines of output. */
export async function runStep(command: string, o: SpawnOptions & { timeoutMs: number }): Promise<void> {
  const s = spawnCommand(command, o)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    void killTree(s.child)
  }, o.timeoutMs)
  const code = await s.exited
  clearTimeout(timer)
  if (timedOut) throw new ElastishotError('E_SERVE', `${o.label}: "${command}" did not finish within ${Math.round(o.timeoutMs / 1000)} s\n${s.tail()}`)
  if (code !== 0) throw new ElastishotError('E_SERVE', `${o.label}: "${command}" ${code === null ? 'could not start' : `exited with ${code}`}\n${s.tail()}`)
}

/** A port nothing listens on right now, from the operating system. */
export function freePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, host, () => {
      const { port } = server.address() as AddressInfo
      server.close(() => resolve(port))
    })
  })
}

/** Whether something accepts connections on this port, over IPv4 or IPv6 loopback. */
export async function portAnswers(port: number, timeoutMs = 300): Promise<boolean> {
  const probe = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = net.connect({ host, port })
      const done = (ok: boolean) => {
        socket.destroy()
        resolve(ok)
      }
      socket.setTimeout(timeoutMs, () => done(false))
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
    })
  const [v4, v6] = await Promise.all([probe('127.0.0.1'), probe('::1')])
  return v4 || v6
}
