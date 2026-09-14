#!/usr/bin/env node
/**
 * Print the CHANGELOG.md section of one version, for release notes.
 *
 *   node scripts/changelog-section.mjs 0.1.0
 *
 * Exits 1 when the version has no section, so a release cannot ship without
 * its changelog entry.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (!version) {
  console.error('usage: changelog-section.mjs <version>')
  process.exit(2)
}
const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md')
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`))
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}`)
  process.exit(1)
}
let end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
if (end < 0) end = lines.findIndex((l, i) => i > start && /^\[.+\]: /.test(l))
if (end < 0) end = lines.length
process.stdout.write(`${lines.slice(start + 1, end).join('\n').trim()}\n`)
