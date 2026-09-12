// Copy to elastishot.config.js. Paths are relative to this file.
export default {
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
  },
  report: { images: 'files', junit: true, title: 'Acme visual checks' },
  targets: [
    { name: 'home', url: 'https://example.com/' },
    { name: 'pricing', url: 'https://example.com/pricing', viewports: ['desktop'], capture: { waitFor: '[data-testid="plans"]' } },
  ],
  // reporters: [{ name: 'slack', async report(report) { await fetch(process.env.SLACK_WEBHOOK, { method: 'POST', body: JSON.stringify({ text: `${report.totals.failed} failed` }) }) } }],
}
