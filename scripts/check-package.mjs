#!/usr/bin/env node
/**
 * Prove the package is publishable: pack it to a temporary folder, check the
 * file list carries what it must and nothing it must not, check the CLI
 * shebang survived line-ending conversion, then install the tarball into a
 * scratch project and import every documented entry point.
 *
 *   npm run check:package        (needs a prior npm run build)
 *
 * Exit codes: 0 clean, 1 something is wrong.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
// Under `npm run` the CLI's own entry is in npm_execpath, which runs the
// same on every platform without a shell; elsewhere fall back to the npm
// on the PATH (a .cmd shim on Windows, hence the shell there).
const npmCli = process.env.npm_execpath
const run = (args, cwd) =>
  npmCli
    ? execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    : execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
const problems = []

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elastishot-pack-'))
run(['pack', '--pack-destination', tmp], root)
// The tarball's own listing, not npm's --json report, whose shape has moved
// between npm majors; tar ships with every OS this runs on.
const tarball = path.join(tmp, `${pkg.name}-${pkg.version}.tgz`)
if (!fs.existsSync(tarball)) {
  console.error(`npm pack did not produce ${tarball}`)
  process.exit(1)
}
// A relative name inside the temp folder: GNU tar reads "C:\..." as host:file.
const files = execFileSync('tar', ['-tzf', path.basename(tarball)], { cwd: tmp, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .map((f) => f.replace(/^package\//, ''))
console.log(`${path.basename(tarball)}: ${files.length} files, ${(fs.statSync(tarball).size / 1024).toFixed(0)} kB packed`)

for (const must of ['bin/elastishot.js', 'dist/index.js', 'dist/cli/main.js', 'dist/viewer/elastishot-viewer.js', 'dist/engine/index.js', 'LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md', 'package.json']) {
  if (!files.includes(must)) problems.push(`missing from the tarball: ${must}`)
}
for (const f of files) {
  if (/^(src|test|acceptance|examples|site|scripts|\.github)\//.test(f) || /\.test\.(js|ts|d\.ts)$/.test(f) || /\.map$/.test(f)) problems.push(`must not ship: ${f}`)
}
const shebang = fs.readFileSync(path.join(root, 'bin', 'elastishot.js')).subarray(0, 24).toString()
if (!shebang.startsWith('#!/usr/bin/env node\n')) problems.push(`bin/elastishot.js must start with "#!/usr/bin/env node" followed by LF, got ${JSON.stringify(shebang)}`)

// Install the tarball into a scratch project and import the public surface.
const scratch = path.join(tmp, 'consumer')
fs.mkdirSync(scratch)
fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }))
run(['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball], scratch)
const expect = {
  elastishot: ['comparePair', 'compare', 'loadEngine', 'evaluate', 'resolveCompareOptions', 'ElastishotError'],
  'elastishot/engine': ['createEngine'],
  'elastishot/locators': ['mapLocators'],
  'elastishot/report': ['renderSummaryReport', 'renderPairReport', 'buildReport'],
  'elastishot/node': ['createElastishot', 'loadConfig', 'readImageFile', 'resolveInput'],
  'elastishot/capture': ['capture', 'createCaptureAdapter'],
}
const probe = `
const expect = ${JSON.stringify(expect)}
const out = {}
for (const [name, keys] of Object.entries(expect)) {
  try { const m = await import(name); out[name] = keys.filter((k) => !(k in m)) } catch (e) { out[name] = ['import failed: ' + e.message] }
}
console.log(JSON.stringify(out))
`
fs.writeFileSync(path.join(scratch, 'probe.mjs'), probe)
const result = JSON.parse(execFileSync(process.execPath, ['probe.mjs'], { cwd: scratch, encoding: 'utf8' }))
for (const [name, missing] of Object.entries(result)) if (missing.length) problems.push(`${name}: ${missing.join(', ')}`)
const version = execFileSync(process.execPath, [path.join(scratch, 'node_modules', 'elastishot', 'bin', 'elastishot.js'), '--version'], { encoding: 'utf8' }).trim()
if (version !== pkg.version) problems.push(`installed CLI reports ${version}, package.json says ${pkg.version}`)

fs.rmSync(tmp, { recursive: true, force: true })
if (problems.length) {
  console.error('package check failed:\n  ' + problems.join('\n  '))
  process.exit(1)
}
console.log(`package check ok: entry points import, CLI reports ${version}`)
