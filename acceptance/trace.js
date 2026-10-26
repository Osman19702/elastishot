#!/usr/bin/env node
/**
 * Traceability: every scenario in acceptance/features/*.feature against the
 * automated tests in acceptance/*.acceptance.test.js, matched by the
 * "A1 — Title" identifier both carry. Prints a markdown table and exits
 * non-zero if a scenario has no test at all (a todo counts as a test; the
 * point is that no scenario can be silently forgotten).
 *
 * Run: npm run test:trace
 *
 * It also refuses to run with ELASTISHOT_BIN set. That variable redirects the
 * whole acceptance tier at another build (docs/ATDD.md explains why), and
 * test:trace is the last step of test:all, so a variable left behind in a
 * shell cannot end in a green test:all that never ran this tree's CLI.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readScenarios } from './support/features.js'

const dir = path.dirname(fileURLToPath(import.meta.url))

/** id -> { file, todo } for every top-level test in the acceptance files. */
export function readTests() {
  const tests = new Map()
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.acceptance.test.js'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8')
    const consts = Object.fromEntries([...src.matchAll(/const\s+([A-Z_]+)\s*=\s*(['"`])(.*?)\2/g)].map((m) => [m[1], m[3]]))
    for (const m of src.matchAll(/test\(\s*(['"`])([A-H]\d+) — .*?\1\s*(?:,\s*\{\s*todo:\s*(?:(['"`])(.*?)\3|([A-Z_]+))\s*\})?/gs)) {
      const todo = m[4] ?? (m[5] ? consts[m[5]] || m[5] : null)
      tests.set(m[2], { file, todo })
    }
  }
  return tests
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  if (process.env.ELASTISHOT_BIN) {
    console.error(`ELASTISHOT_BIN is set (${process.env.ELASTISHOT_BIN}).`)
    console.error('It points the acceptance tier at another build, so this run would not certify this tree.')
    console.error('Unset it and run again: PowerShell `$env:ELASTISHOT_BIN = $null`, POSIX `unset ELASTISHOT_BIN`.')
    process.exit(1)
  }
  const scenarios = readScenarios()
  const tests = readTests()
  const rows = scenarios.map((s) => {
    const t = tests.get(s.id)
    const status = !t ? 'MISSING' : t.todo ? 'todo' : 'automated'
    return { ...s, status, note: t?.todo || '' }
  })
  const counts = { automated: 0, todo: 0, MISSING: 0 }
  for (const r of rows) counts[r.status]++

  let current = ''
  console.log('| ID | Scenario | Seam | Status |')
  console.log('|---|---|---|---|')
  for (const r of rows) {
    if (r.feature !== current) {
      current = r.feature
      console.log(`| **${current}** | | | |`)
    }
    const seam = r.tags.map((t) => t.replace('@', '')).join(', ')
    const status = r.status === 'automated' ? 'automated' : r.status === 'todo' ? `todo: ${r.note}` : 'NO TEST'
    console.log(`| ${r.id} | ${r.title} | ${seam} | ${status} |`)
  }
  console.log()
  console.log(`Scenarios: ${rows.length} · automated: ${counts.automated} · todo: ${counts.todo} · missing: ${counts.MISSING}`)
  if (counts.MISSING) process.exit(1)
}
