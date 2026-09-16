#!/usr/bin/env node
/**
 * Write the eight builds of the Lumen page to examples/ui-lab/dist/build-<n>/
 * and the ground truth to dist/changes.json.
 *
 *   node examples/ui-lab/build.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assets, BUILDS, render, STYLES } from './site.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const DIST = path.join(here, 'dist')

export function buildSite() {
  fs.rmSync(DIST, { recursive: true, force: true })
  for (const b of BUILDS) {
    const dir = path.join(DIST, `build-${b.n}`)
    fs.mkdirSync(path.join(dir, 'img'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'index.html'), render(b.n))
    fs.writeFileSync(path.join(dir, 'styles.css'), STYLES)
    for (const [file, content] of Object.entries(assets(b.n))) fs.writeFileSync(path.join(dir, file), content)
  }
  fs.writeFileSync(path.join(DIST, 'changes.json'), `${JSON.stringify(BUILDS, null, 2)}\n`)
  return DIST
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSite()
  console.log(`${BUILDS.length} builds written to ${DIST}`)
}
