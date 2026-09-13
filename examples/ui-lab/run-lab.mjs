#!/usr/bin/env node
/**
 * The whole lab in one go:
 *   1. build the seven Lumen pages and serve them on http://127.0.0.1:4321
 *   2. approve build 1 as the baseline of every scenario (elastishot run --update)
 *   3. run the scenarios against their "after" builds (elastishot run)
 *   4. score the run against the ground truth (verify.mjs)
 *   5. record the walkthrough video and screenshots (record.mjs)
 *   6. write examples/ui-lab/report/index.html (make-report.mjs)
 *
 *   node examples/ui-lab/run-lab.mjs            # everything
 *   node examples/ui-lab/run-lab.mjs --no-video # skip step 5
 *
 * Needs the built CLI (npm run build) and Playwright's Chromium.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { startStaticServer } from '../../test/support/static-server.js'
import { buildSite, DIST } from './build.mjs'
import { makeReport } from './make-report.mjs'
import { record } from './record.mjs'
import { verifyRun } from './verify.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..')
const bin = path.join(repo, 'bin', 'elastishot.js')
const config = path.join(here, 'elastishot.config.js')
const PORT = 4321
const REPORT_DIR = path.join(here, 'report')

// The static server runs in this process, so the CLI must be spawned
// asynchronously or the server could never answer its requests.
function elastishot(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: here, env: { ...process.env, LAB_PORT: String(PORT), ...env }, stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
}

const withVideo = !process.argv.includes('--no-video')
buildSite()
console.log(`site built: ${DIST}`)
const server = await startStaticServer(DIST, { port: PORT })
console.log(`serving ${server.url}`)
try {
  fs.rmSync(path.join(here, '.elastishot'), { recursive: true, force: true })
  console.log('\n== approving build 1 as the baseline')
  const approved = await elastishot(['run', '--config', config, '--update'], { LAB_BASELINE: '1' })
  if (approved !== 0) throw new Error(`baseline run exited with ${approved}`)

  console.log('\n== comparing the deployments')
  const code = await elastishot(['run', '--config', config, '--junit'])
  console.log(`elastishot run exited with ${code} (1 = differences found, as expected)`)
  const runDir = fs.readFileSync(path.join(here, '.elastishot', 'runs', 'latest'), 'utf8').trim()

  console.log('\n== scoring against the ground truth')
  const results = verifyRun(runDir, path.join(DIST, 'changes.json'))
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  fs.writeFileSync(path.join(REPORT_DIR, 'results.json'), `${JSON.stringify(results, null, 2)}\n`)
  for (const p of results.pairs) console.log(`${p.id.padEnd(24)} ${p.status.padEnd(7)} ${((p.similarity ?? 0) * 100).toFixed(1).padStart(5)}%  found ${p.found}/${p.expected}  noise ${p.noiseRegions}`)

  const media = withVideo ? await record({ siteUrl: server.url, runDir, outDir: REPORT_DIR }) : null
  makeReport({ results, runDir, outDir: REPORT_DIR, media, siteUrl: server.url })
  console.log(`\nreport: ${path.join(REPORT_DIR, 'index.html')}\nrun:    ${runDir}`)
} finally {
  await server.close()
}
