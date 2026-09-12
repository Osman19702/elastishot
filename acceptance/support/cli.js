/**
 * Drive the built CLI (bin/elastishot.js -> dist) as a subprocess, the way a
 * user or a CI job would. Run `npm run build` first; test:acceptance does.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const BIN = path.join(root, 'bin', 'elastishot.js')
export const FIXTURE_IMAGES = path.join(root, 'test', 'fixtures', 'images')
export const FIXTURE_SITE = path.join(root, 'test', 'fixtures', 'site')

export function elastishot(args, { cwd = root, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, ...env }, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr, lines: stdout.split(/\r?\n/).filter(Boolean) }))
  })
}

export async function workspace(prefix = 'elastishot-acceptance-') {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) }
}

export const image = (name) => path.join(FIXTURE_IMAGES, name)
