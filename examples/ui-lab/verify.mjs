/**
 * Score an Elastishot run of the lab against the ground truth in
 * dist/changes.json: which expected changes were named by locator, which
 * were only covered by a region, which were missed, and how many regions
 * landed on elements nobody changed.
 */
import fs from 'node:fs'
import path from 'node:path'

const OVERLAP_MIN = 0.3
const NOISE_SCORE = 0.2

const area = (b) => Math.max(0, b.w) * Math.max(0, b.h)
function overlap(a, b) {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
}
const contains = (outer, inner) => overlap(outer, inner) >= 0.9 * area(inner)
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

function elementByTestid(map, testid) {
  return map?.elements.find((e) => e.locator === `[data-testid="${testid}"]`) ?? null
}

/** @returns per-pair verdicts, ready for the report */
export function verifyRun(runDir, changesPath) {
  const report = readJson(path.join(runDir, 'report.json'))
  const builds = readJson(changesPath)
  const byName = new Map(builds.map((b) => [b.name, b]))
  const results = []
  for (const pair of report.pairs) {
    const scenario = byName.get(pair.target ?? pair.name)
    if (!scenario) continue
    const dir = path.join(runDir, 'pairs', pair.id)
    const baselineMap = fs.existsSync(path.join(dir, 'baseline.map.json')) ? readJson(path.join(dir, 'baseline.map.json')) : null
    const candidateMap = fs.existsSync(path.join(dir, 'candidate.map.json')) ? readJson(path.join(dir, 'candidate.map.json')) : null
    const all = pair.locators?.changedLocators ?? []
    const named = new Map(all.filter((l) => l.evidence.includes('pixels')).map((l) => [l.locator, l]))
    const domOnly = new Map(all.filter((l) => !l.evidence.includes('pixels')).map((l) => [l.locator, l]))
    const regions = pair.regions
    const expectedBoxes = []
    const items = scenario.expected.map((exp) => {
      const locator = `[data-testid="${exp.testid}"]`
      const entry = named.get(locator)
      const side = exp.kind === 'removed' ? baselineMap : candidateMap
      const el = elementByTestid(side, exp.testid) ?? elementByTestid(exp.kind === 'removed' ? candidateMap : baselineMap, exp.testid)
      if (el) expectedBoxes.push(el.box)
      const elBaseline = elementByTestid(baselineMap, exp.testid)
      if (elBaseline) expectedBoxes.push(elBaseline.box)
      let covered = false
      if (el) {
        for (const r of regions) {
          const box = exp.kind === 'removed' ? r.boxBaseline : (r.boxCandidate ?? r.boxBaseline)
          if (box && overlap(box, el.box) >= OVERLAP_MIN * Math.min(area(box), area(el.box))) {
            covered = true
            break
          }
        }
      }
      // A change inside the element is also fine when it was attributed to a
      // descendant: the price span inside the plan card, a word inside a line.
      const descendant = el ? [...named.values()].find((l) => l.sideCandidate && contains(el.box, l.sideCandidate.box)) : undefined
      const dom = domOnly.get(locator)
      const status = entry ? 'named' : descendant ? 'named-child' : covered ? 'covered' : dom ? 'dom-only' : 'missed'
      const source = entry ?? descendant ?? dom
      const kindOk = source ? source.kinds.includes(exp.kind) : false
      return { ...exp, status, kindOk, reportedKinds: source?.kinds ?? [], score: source?.score ?? null, regions: source?.regions.length ?? 0, sizeDelta: dom?.sizeDelta ?? null }
    })
    // Regions that touch none of the expected elements (on either side) are noise
    // to a tester: count the ones with a score worth looking at.
    const noise = regions.filter((r) => {
      if (r.score < NOISE_SCORE) return false
      const boxes = [r.boxBaseline, r.boxCandidate].filter(Boolean)
      return !boxes.some((b) => expectedBoxes.some((e) => overlap(b, e) > 0))
    })
    const found = items.filter((i) => i.status !== 'missed').length
    const foundByPixels = items.filter((i) => i.status !== 'missed' && i.status !== 'dom-only').length
    results.push({
      id: pair.id,
      name: pair.name,
      target: pair.target ?? pair.name,
      viewport: pair.viewport?.name ?? 'desktop',
      build: scenario.n,
      title: scenario.title,
      summary: scenario.summary,
      status: pair.status,
      similarity: pair.summary?.similarity ?? null,
      counts: pair.summary?.counts ?? null,
      regions: regions.length,
      alignMethod: pair.summary?.alignMethod ?? null,
      structural: pair.summary?.structural ?? null,
      warnings: (pair.summary?.warnings ?? []).map((w) => w.code),
      durationMs: pair.durationMs ?? null,
      expected: items.length,
      found,
      foundByPixels,
      missed: items.length - found,
      kindMismatches: items.filter((i) => i.status !== 'missed' && !i.kindOk).length,
      noiseRegions: noise.length,
      noiseSample: noise.slice(0, 5).map((r) => ({ kind: r.kind, box: r.boxBaseline ?? r.boxCandidate, score: +r.score.toFixed(2) })),
      items,
      report: path.join('pairs', pair.id, 'report.html').split(path.sep).join('/'),
      overlay: pair.artifacts?.overlay ?? null,
    })
  }
  return { runId: report.runId, createdAt: report.createdAt, elastishotVersion: report.elastishotVersion, totals: report.totals, pairs: results }
}
