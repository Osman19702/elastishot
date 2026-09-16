// Elastishot config for the UI lab. Every target is one deployment scenario.
// With LAB_BASELINE=1 every target points at build 1, which is how the
// baselines are approved; without it each target points at the build that
// plays the "after" deployment for that scenario.
const PORT = process.env.LAB_PORT ?? '4321'
const build = (n) => `http://127.0.0.1:${PORT}/build-${n}/`
const baseline = process.env.LAB_BASELINE === '1'

const scenarios = [
  ['no-change', 1],
  ['new-elements', 2],
  ['text-changes', 3],
  ['shifts', 4],
  ['expansions', 5],
  ['images', 6],
  ['release', 7],
  ['columns', 8],
]

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
  targets: scenarios.map(([name, n]) => ({
    name,
    url: build(baseline ? 1 : n),
    // The mixed release is also checked on a phone; the single-family
    // scenarios stay on the desktop viewport.
    viewports: name === 'release' ? ['desktop', 'mobile'] : ['desktop'],
  })),
}
