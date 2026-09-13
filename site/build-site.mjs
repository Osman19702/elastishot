#!/usr/bin/env node
/**
 * Assemble the Elastishot landing page in site/dist from the template, the
 * built viewer bundle and the latest UI-lab run (two real pairs with their
 * regions and named elements, plus the walkthrough video).
 *
 *   npm run build && node examples/ui-lab/run-lab.mjs   # once, for the assets
 *   node site/build-site.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const lab = path.join(repo, 'examples', 'ui-lab')
const OUT = path.join(here, 'dist')

const latest = fs.readFileSync(path.join(lab, '.elastishot', 'runs', 'latest'), 'utf8').trim()
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))
const results = JSON.parse(fs.readFileSync(path.join(lab, 'report', 'results.json'), 'utf8'))

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(path.join(OUT, 'demo'), { recursive: true })
fs.mkdirSync(path.join(OUT, 'video'), { recursive: true })
fs.copyFileSync(path.join(repo, 'dist', 'viewer', 'elastishot-viewer.js'), path.join(OUT, 'viewer.js'))

const jsonForScript = (v) => JSON.stringify(v).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--')

function pairData(id, key) {
  const dir = path.join(latest, 'pairs', id)
  for (const f of ['baseline.png', 'candidate.png', 'diff.png']) fs.copyFileSync(path.join(dir, f), path.join(OUT, 'demo', `${key}-${f}`))
  const r = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'))
  const named = (r.locators?.changedLocators ?? []).filter((l) => l.evidence.includes('pixels'))
  return {
    json: jsonForScript({ regions: r.regions, locators: r.locators ?? null, alignment: r.alignment ?? null }),
    summary: r.summary,
    named,
    scored: results.pairs.find((p) => p.id === id) ?? null,
  }
}

const release = pairData('release--desktop', 'release')
const text = pairData('text-changes--desktop', 'text')
const video = path.join(lab, 'report', 'video', 'lab-walkthrough.webm')
const hasVideo = fs.existsSync(video)
if (hasVideo) fs.copyFileSync(video, path.join(OUT, 'video', 'lab-walkthrough.webm'))

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const short = (loc) => {
  const parts = loc.split(' > ')
  return parts.length > 2 ? `… > ${parts.slice(-2).join(' > ')}` : loc
}
const chips = (named, max = 8) =>
  named
    .slice(0, max)
    .map((l) => `<li class="chip k-${l.kinds[0]}"><span class="kind">${l.kinds.join('/')}</span><code title="${esc(l.locator)}">${esc(short(l.locator))}</code></li>`)
    .join('')

const totalExpected = results.pairs.reduce((s, p) => s + p.expected, 0)
const totalFound = results.pairs.reduce((s, p) => s + p.found, 0)
const totalNoise = results.pairs.reduce((s, p) => s + p.noiseRegions, 0)
const runSeconds = Math.round(results.pairs.reduce((s, p) => s + (p.durationMs ?? 0), 0) / 1000)

let html = fs.readFileSync(path.join(here, 'index.template.html'), 'utf8')
const fill = {
  VERSION: pkg.version,
  RELEASE_JSON: release.json,
  TEXT_JSON: text.json,
  RELEASE_SIMILARITY: `${(release.summary.similarity * 100).toFixed(1)}%`,
  RELEASE_COUNTS: `+${release.summary.counts.added} −${release.summary.counts.removed} ~${release.summary.counts.changed} ›${release.summary.counts.moved}`,
  RELEASE_CHIPS: chips(release.named),
  TEXT_SIMILARITY: `${(text.summary.similarity * 100).toFixed(1)}%`,
  TEXT_CHIPS: chips(text.named),
  TEXT_SECONDS: (text.scored?.durationMs ? text.scored.durationMs / 1000 : 0).toFixed(1),
  LAB_FOUND: String(totalFound),
  LAB_EXPECTED: String(totalExpected),
  LAB_NOISE: String(totalNoise),
  LAB_PAIRS: String(results.pairs.length),
  LAB_SECONDS: String(runSeconds),
  VIDEO_BLOCK: hasVideo
    ? `<video controls playsinline preload="metadata" src="video/lab-walkthrough.webm"></video><p class="cap">Sixty-five seconds: the seven builds of the lab, the summary page, then three pair reports with every viewer mode.</p>`
    : '',
}
html = html.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in fill ? fill[k] : m))
fs.writeFileSync(path.join(OUT, 'index.html'), html)
console.log(`site written to ${OUT} (${fs.readdirSync(path.join(OUT, 'demo')).length} demo images${hasVideo ? ', video' : ''})`)
