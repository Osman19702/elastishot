// Elastishot config for the UI lab. Every target is one deployment scenario:
// a name, the build that plays the "after" deployment and, when it is not
// build 1, the build it is compared with. With LAB_BASELINE=1 every target
// points at its "before" build, which is how the baselines are approved.
//
// The list comes from site.mjs, which is the ground truth the run is scored
// against: a build number written here and not there would compare one pair
// and label another. Build 1 keeps the target name `no-change` (site.mjs
// calls the build itself `baseline`), so its pair id and baseline folder stay
// what they have always been and verify.mjs goes on leaving it unscored: it
// plants no change, so there is nothing to find.
import { BUILDS } from './site.mjs'

const PORT = process.env.LAB_PORT ?? '4321'
const build = (n) => `http://127.0.0.1:${PORT}/build-${n}/`
const baseline = process.env.LAB_BASELINE === '1'

const scenarios = BUILDS.map((b) => [b.n === 1 ? 'no-change' : b.name, b.n, b.before ?? 1])

export default {
  baselineDir: '.elastishot/baselines',
  outDir: '.elastishot/runs',
  threshold: 0.98,
  viewports: [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 390, height: 844 },
  ],
  capture: { fullPage: true, waitUntil: 'load', freezeAnimations: true },
  report: { title: 'Lumen UI lab' },
  targets: scenarios.map(([name, after, before = 1]) => ({
    name,
    url: build(baseline ? before : after),
    // The mixed release is also checked on a phone; the single-family
    // scenarios stay on the desktop viewport.
    viewports: name === 'release' ? ['desktop', 'mobile'] : ['desktop'],
  })),
}
