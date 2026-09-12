#!/usr/bin/env node
/**
 * Layering check: the browser-safe packages (src/core, src/engine,
 * src/locators, src/report, src/viewer) must not import Node built-ins,
 * Playwright, or the node/capture/cli packages. Test files are exempt
 * because node:test is Node-only by nature.
 *
 *   node scripts/check-layering.mjs
 *
 * Exit codes: 0 clean, 1 violations found.
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOTS = ['src/core', 'src/engine', 'src/locators', 'src/report', 'src/viewer']
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'http', 'https', 'os', 'path',
  'perf_hooks', 'process', 'stream', 'url', 'util', 'worker_threads', 'zlib',
])
const SPECIFIER_RES = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

function* walk(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) yield full
  }
}

function offence(spec, file) {
  if (spec.startsWith('node:') || NODE_BUILTINS.has(spec)) return 'Node built-in'
  if (spec === 'playwright' || spec.startsWith('playwright/') || spec === '@playwright/test') return 'Playwright'
  if (spec.startsWith('.')) {
    const target = path.resolve(path.dirname(file), spec)
    const rel = path.relative(process.cwd(), target).split(path.sep).join('/')
    if (/^src\/(node|capture|cli)(\/|$)/.test(rel)) return 'Node-only package'
  }
  return null
}

const violations = []
let files = 0
for (const root of ROOTS) {
  for (const file of walk(root)) {
    files++
    const src = fs.readFileSync(file, 'utf8')
    for (const re of SPECIFIER_RES) {
      for (const m of src.matchAll(re)) {
        const why = offence(m[1], file)
        if (why) violations.push(`${file}: imports '${m[1]}' (${why})`)
      }
    }
  }
}

if (violations.length) {
  console.error('Layering violations:')
  for (const v of violations) console.error(`  ${v}`)
  process.exit(1)
}
console.log(`layering ok: ${files} browser-safe files checked`)
