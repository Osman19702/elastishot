/**
 * Write examples/ui-lab/report/index.html: the walkthrough video, a
 * scoreboard, one card per scenario with the ground truth ticked off, and
 * the commands to reproduce the run. Everything it references is copied
 * next to it, so the folder can be published as is.
 */
import fs from 'node:fs'
import path from 'node:path'

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const pct = (n) => (n === null || n === undefined ? '—' : `${(n * 100).toFixed(1)} %`)

const CSS = `
:root { --ground: #f4f6f9; --paper: #ffffff; --ink: #16202b; --muted: #5b6675; --line: #d8dee7; --accent: #1d4ed8; --accent-soft: #e4ebfb;
  --ok: #0f766e; --ok-soft: #dcf3ef; --warn: #b45309; --warn-soft: #fcefd9; --bad: #b91c1c; --bad-soft: #fbe3e3; --code: #eaeef3; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --ground: #0f141a; --paper: #171d25; --ink: #e8edf3; --muted: #9aa6b4; --line: #2b3541; --accent: #8ab4ff; --accent-soft: #1b2a45;
  --ok: #5fd3c4; --ok-soft: #10312d; --warn: #f2b45c; --warn-soft: #3a2a12; --bad: #f28b8b; --bad-soft: #3d1b1b; --code: #232c37; } }
:root[data-theme="dark"] { --ground: #0f141a; --paper: #171d25; --ink: #e8edf3; --muted: #9aa6b4; --line: #2b3541; --accent: #8ab4ff; --accent-soft: #1b2a45;
  --ok: #5fd3c4; --ok-soft: #10312d; --warn: #f2b45c; --warn-soft: #3a2a12; --bad: #f28b8b; --bad-soft: #3d1b1b; --code: #232c37; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--ground); color: var(--ink); font: 17px/1.55 "Source Sans 3", "Segoe UI", system-ui, sans-serif; padding-inline: 16px; padding-block: 32px 64px; }
.wrap { max-width: 1040px; margin: 0 auto; }
h1, h2, h3 { font-family: "Sora", "Segoe UI", system-ui, sans-serif; line-height: 1.2; margin: 0; text-wrap: balance; }
h1 { font-size: 2.1rem; } h2 { font-size: 1.35rem; margin-top: 3rem; padding-top: 1rem; border-top: 2px solid var(--line); } h3 { font-size: 1.05rem; }
p { max-width: 70ch; margin: .6rem 0; } .lead { font-size: 1.15rem; }
.eyebrow { font-family: "Sora", system-ui, sans-serif; font-size: .78rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-bottom: .5rem; }
.meta { color: var(--muted); font-size: .92rem; display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: .8rem; }
code { font-family: "JetBrains Mono", Consolas, monospace; font-size: .86em; background: var(--code); padding: .05em .35em; border-radius: 4px; }
pre { background: var(--code); padding: 12px 14px; border-radius: 6px; overflow-x: auto; font-size: .85rem; line-height: 1.45; } pre code { background: none; padding: 0; font-size: inherit; }
video { width: 100%; max-width: 100%; border-radius: 10px; border: 1px solid var(--line); background: #000; display: block; margin-top: 1.2rem; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: 1.5rem; }
.tile { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; border-left: 4px solid var(--accent); }
.tile.ok { border-left-color: var(--ok); } .tile.warn { border-left-color: var(--warn); } .tile.bad { border-left-color: var(--bad); }
.tile .k { font-family: "Sora", system-ui, sans-serif; font-size: .76rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.tile .v { font-family: "Sora", system-ui, sans-serif; font-size: 1.6rem; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 4px; } .tile .s { color: var(--muted); font-size: .9rem; }
.scroll { overflow-x: auto; margin: 1rem 0; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); }
table { border-collapse: collapse; width: 100%; font-size: .92rem; } th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-family: "Sora", system-ui, sans-serif; font-size: .74rem; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
td.num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; } tr:last-child td { border-bottom: 0; }
.pill { display: inline-block; font-family: "Sora", system-ui, sans-serif; font-size: .72rem; font-weight: 600; letter-spacing: .04em; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.pill.ok { background: var(--ok-soft); color: var(--ok); } .pill.warn { background: var(--warn-soft); color: var(--warn); } .pill.bad { background: var(--bad-soft); color: var(--bad); } .pill.na { background: var(--code); color: var(--muted); }
.scenario { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 18px 20px; margin-top: 1.2rem; }
.scenario header { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: baseline; } .scenario header .n { font-family: "JetBrains Mono", monospace; color: var(--muted); font-size: .85rem; }
.scenario .facts { display: flex; flex-wrap: wrap; gap: 6px 18px; color: var(--muted); font-size: .9rem; margin: 6px 0 10px; font-variant-numeric: tabular-nums; }
.checks { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; } .checks li { display: grid; grid-template-columns: 22px 1fr auto; gap: 10px; align-items: baseline; font-size: .95rem; }
.checks .mark { font-weight: 700; } .checks .mark.ok { color: var(--ok); } .checks .mark.bad { color: var(--bad); } .checks .mark.warn { color: var(--warn); }
.checks .kinds { color: var(--muted); font-size: .85rem; white-space: nowrap; }
.pics { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-top: 12px; }
figure { margin: 0; } figure img { max-width: 100%; height: auto; display: block; border: 1px solid var(--line); border-radius: 6px; background: #fff; } figcaption { color: var(--muted); font-size: .85rem; margin-top: 4px; }
.thumb { max-height: 420px; overflow: hidden; border-radius: 6px; border: 1px solid var(--line); } .thumb img { border: 0; border-radius: 0; }
ul { padding-left: 1.3rem; max-width: 72ch; } li { margin: .3rem 0; }
.small { font-size: .9rem; color: var(--muted); }
`

function statusPill(p) {
  if (p.expected === 0) return p.regions === 0 ? '<span class="pill ok">Clean pass</span>' : '<span class="pill bad">False positives</span>'
  if (p.missed === 0 && p.noiseRegions === 0) return '<span class="pill ok">All found</span>'
  if (p.missed === 0) return '<span class="pill warn">All found, some noise</span>'
  return `<span class="pill bad">${p.missed} missed</span>`
}

const mark = (i) => (i.status === 'missed' ? '<span class="mark bad">✗</span>' : i.status === 'dom-only' ? '<span class="mark warn">◐</span>' : i.kindOk ? '<span class="mark ok">✓</span>' : '<span class="mark warn">~</span>')
const statusWord = { named: 'named', 'named-child': 'named (child)', covered: 'region only', 'dom-only': 'DOM only', missed: 'missed' }

export function makeReport({ results, runDir, outDir, media, siteUrl }) {
  const imgDir = path.join(outDir, 'img')
  fs.mkdirSync(imgDir, { recursive: true })
  const shots = media?.shots ?? {}
  const overlays = {}
  for (const p of results.pairs) {
    if (!p.overlay) continue
    const src = path.join(runDir, 'pairs', p.id, 'overlay.png')
    if (!fs.existsSync(src)) continue
    const dst = `img/${p.id}-overlay.png`
    fs.copyFileSync(src, path.join(outDir, dst))
    overlays[p.id] = dst
  }
  const pairs = results.pairs
  const expected = pairs.reduce((s, p) => s + p.expected, 0)
  const found = pairs.reduce((s, p) => s + p.found, 0)
  const missed = expected - found
  const noise = pairs.reduce((s, p) => s + p.noiseRegions, 0)
  const cleanPass = pairs.filter((p) => p.expected === 0).every((p) => p.regions === 0)
  const ms = pairs.reduce((s, p) => s + (p.durationMs ?? 0), 0)

  const scenarioCard = (p) => `<section class="scenario" id="${esc(p.id)}">
<header><span class="n">build ${p.build} · ${esc(p.viewport)}</span><h3>${esc(p.title)}</h3>${statusPill(p)}</header>
<p class="small">${esc(p.summary)}</p>
<div class="facts"><span>similarity ${pct(p.similarity)}</span><span>${p.counts ? `+${p.counts.added} −${p.counts.removed} ~${p.counts.changed} ›${p.counts.moved}` : ''}</span><span>${p.regions} regions</span><span>${esc(p.alignMethod ?? '')}</span>${p.structural ? `<span>rows matched ${p.structural.matchedRows}, added ${p.structural.insertedRows}, removed ${p.structural.deletedRows}</span>` : ''}${p.durationMs ? `<span>${(p.durationMs / 1000).toFixed(1)} s</span>` : ''}</div>
${
  p.items.length
    ? `<ul class="checks">${p.items
        .map(
          (i) =>
            `<li>${mark(i)}<span><code>${esc(i.testid)}</code> ${esc(i.what)}</span><span class="kinds">${i.status === 'missed' ? 'missed' : `${statusWord[i.status]}${i.reportedKinds.length ? `: ${i.reportedKinds.join('/')}` : ''}${i.sizeDelta ? ` (${i.sizeDelta.w >= 0 ? '+' : ''}${i.sizeDelta.w}×${i.sizeDelta.h >= 0 ? '+' : ''}${i.sizeDelta.h} px)` : ''}${i.score ? ` · ${i.score.toFixed(2)}` : ''}`}</span></li>`,
        )
        .join('')}</ul>`
    : '<p class="small">Nothing changed in this build; the pair must pass with no regions.</p>'
}
${p.noiseRegions ? `<p class="small">Regions on elements nobody changed (score ≥ 0.2): ${p.noiseRegions}${p.noiseSample.length ? ` — e.g. ${p.noiseSample.map((n) => `${n.kind} ${n.box.w}×${n.box.h} at ${n.box.x},${n.box.y} (${n.score})`).join('; ')}` : ''}</p>` : ''}
${p.warnings.length ? `<p class="small">Warnings: ${p.warnings.map((w) => `<code>${esc(w)}</code>`).join(' ')}</p>` : ''}
<div class="pics">
${shots[`build-${p.build}`] ? `<figure><div class="thumb"><img src="${shots[`build-${p.build}`]}" alt="Build ${p.build} at 1280 by 720" loading="lazy"></div><figcaption>Build ${p.build} as captured (top of the page)</figcaption></figure>` : ''}
${overlays[p.id] ? `<figure><div class="thumb"><img src="${overlays[p.id]}" alt="Elastishot overlay for ${esc(p.id)}: coloured boxes on the baseline where the regions are" loading="lazy"></div><figcaption>Overlay: red removed, green added, magenta changed, blue moved</figcaption></figure>` : ''}
</div>
</section>`

  const html = `<title>Lumen UI Lab</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Source+Sans+3:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap">
<style>${CSS}</style>
<div class="wrap">
<div class="eyebrow">Elastishot ${esc(results.elastishotVersion)} · run ${esc(results.runId)} · ${esc(new Date(results.createdAt).toISOString().slice(0, 16).replace('T', ' '))} UTC</div>
<h1>Lumen UI Lab</h1>
<p class="lead">A small product page served on localhost in seven builds. Build 1 is approved as the baseline; builds 2 to 7 each change the page in a known way, and Elastishot has to find every change and nothing else.</p>
<div class="meta"><span>Site: ${esc(siteUrl)}</span><span>Capture: Chromium, full page, desktop 1280×800 and mobile 390×844</span><span>Ground truth: ${expected} expected changes across ${pairs.length} pairs</span></div>
${media?.video ? `<video controls playsinline preload="metadata" src="${media.video}"></video><p class="small">The walkthrough: the seven builds scrolling past, then the Elastishot summary and three pair reports with the viewer in slider, flip, blink, overlay and diff modes.</p>` : ''}
<div class="tiles">
<div class="tile ${missed === 0 ? 'ok' : 'bad'}"><div class="k">Expected changes found</div><div class="v">${found} / ${expected}</div><div class="s">${missed === 0 ? 'nothing missed' : `${missed} missed`}</div></div>
<div class="tile ${noise === 0 ? 'ok' : noise <= 3 ? 'warn' : 'bad'}"><div class="k">Noise regions</div><div class="v">${noise}</div><div class="s">regions on elements nobody changed, score ≥ 0.2</div></div>
<div class="tile ${cleanPass ? 'ok' : 'bad'}"><div class="k">No-change pair</div><div class="v">${cleanPass ? 'Clean' : 'Regions'}</div><div class="s">build 1 against itself</div></div>
<div class="tile"><div class="k">Run time</div><div class="v">${(ms / 1000).toFixed(0)} s</div><div class="s">${pairs.length} pairs, captures included</div></div>
</div>

<h2>Scenarios</h2>
<div class="scroll"><table>
<thead><tr><th>Pair</th><th>What changed</th><th>Similarity</th><th>Regions</th><th>Found (by pixels)</th><th>Noise</th><th>Verdict</th></tr></thead>
<tbody>${pairs
    .map(
      (p) =>
        `<tr><td><a href="#${esc(p.id)}">${esc(p.id)}</a></td><td>${esc(p.summary)}</td><td class="num">${pct(p.similarity)}</td><td class="num">${p.regions}</td><td class="num">${p.expected ? `${p.found} / ${p.expected} (${p.foundByPixels})` : '—'}</td><td class="num">${p.noiseRegions}</td><td>${statusPill(p)}</td></tr>`,
    )
    .join('\n')}</tbody></table></div>
${shots.summary ? `<figure><img src="${shots.summary}" alt="The Elastishot summary page with one card per scenario" loading="lazy"><figcaption>The Elastishot summary page for this run (index.html in the run folder).</figcaption></figure>` : ''}

<h2>Scenario details</h2>
<p>Each expected change is ticked when Elastishot named the element (or one of its children) in the changed-elements list with pixel evidence; a tilde means it was named but with a different kind than expected; a half circle means only the element maps reported it (present on one side, or resized) with no pixels attributed; a cross means nothing reported it.</p>
${pairs.map(scenarioCard).join('\n')}

<h2>Reproduce it</h2>
<pre><code>npm run build
node examples/ui-lab/run-lab.mjs          # builds the site, approves build 1, compares builds 2–7, records the video, writes this page
node examples/ui-lab/run-lab.mjs --no-video</code></pre>
<p>The run folder holds the Elastishot reports themselves: <code>examples/ui-lab/.elastishot/runs/&lt;run&gt;/index.html</code> and one <code>report.html</code> per pair. To edit the scenarios, change <code>examples/ui-lab/site.mjs</code>: the <code>BUILDS</code> list is both the page variants and the ground truth.</p>
</div>
`
  fs.writeFileSync(path.join(outDir, 'index.html'), html)
  return path.join(outDir, 'index.html')
}
