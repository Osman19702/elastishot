// Copy to elastishot.config.mjs. Paths are relative to this file.
export default {
  // Relative target URLs resolve against baseUrl. `elastishot pr` serves the
  // base commit and the working tree on ports of its own and keeps this path.
  baseUrl: 'https://example.com/',
  baselineDir: 'baselines',
  outDir: '.elastishot/runs',
  threshold: 0.98,
  failOn: ['added', 'removed', 'changed', 'moved'],
  viewports: [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 2 },
  ],
  capture: {
    fullPage: true,
    waitUntil: 'networkidle',
    hide: ['.cookie-banner'],
    freezeAnimations: true,
    // locale: 'en-GB',
    // timezoneId: 'Europe/London',
    // clock: '2026-01-15T09:41:00Z',      // pins Date.now() before the page loads
    // storageState: 'tests/state.json',   // cookies and localStorage, relative to this file
    // animations: 'finish',               // run animations to their end instead of freezing them
  },
  // Left out of every comparison, looked up in both element maps.
  ignore: ['[data-testid="clock"]'],
  report: { images: 'files', junit: true, markdown: true, title: 'Acme visual checks' },
  // How `elastishot pr` prepares each side. A static site needs none of this:
  // by default the config folder itself is served.
  pr: {
    install: 'npm ci', // in the base worktree only
    build: 'npm run build', // in both trees
    serve: { command: 'npx vite preview --port {port} --strictPort', ready: { log: 'Local:' } },
  },
  targets: [
    { name: 'home', url: '/', expect: '[data-testid="hero"]' },
    { name: 'pricing', url: '/pricing', viewports: ['desktop'], capture: { waitFor: '[data-testid="plans"]' } },
  ],
  // reporters: [{ name: 'slack', async report(report) { await fetch(process.env.SLACK_WEBHOOK, { method: 'POST', body: JSON.stringify({ text: `${report.totals.failed} failed` }) }) } }],
}
