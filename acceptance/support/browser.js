import { pathToFileURL } from 'node:url'

import { chromium } from 'playwright'

/** One headless Chromium per test file; pages collect their own console errors. */
export async function openBrowser() {
  const browser = await chromium.launch()
  return {
    browser,
    async page() {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text())
      })
      return { page, errors }
    },
    /** Open a generated report from disk, the way a person double-clicks it. */
    async openFile(page, file) {
      await page.goto(pathToFileURL(file).href)
    },
    close: () => browser.close(),
  }
}
