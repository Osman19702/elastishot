import type { Page } from 'playwright'

export interface PrepareOptions {
  freezeAnimations: boolean
  hide: string[]
  mask: string[]
  waitFor?: string | number | ((page: Page) => Promise<void>)
  scrollToLoad: boolean
  timeoutMs: number
}

const FREEZE_CSS = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}`

/**
 * Add a stylesheet the way a strict Content-Security-Policy allows: a
 * constructed sheet is CSSOM, which `style-src` does not govern, whereas an
 * injected <style> element is refused by any policy without 'unsafe-inline'.
 * Falls back to a <style> element where constructed sheets are unsupported.
 */
async function injectCss(page: Page, css: string): Promise<void> {
  const adopted = await page.evaluate((text) => {
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(text)
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
      return true
    } catch {
      return false
    }
  }, css)
  if (!adopted) await page.addStyleTag({ content: css })
}

/** Settle the page so two captures of the same state produce the same pixels. */
export async function preparePage(page: Page, options: PrepareOptions): Promise<void> {
  if (options.freezeAnimations) await injectCss(page, FREEZE_CSS)
  if (options.hide.length) {
    await injectCss(page, `${options.hide.join(', ')} { visibility: hidden !important; }`)
  }
  if (options.mask.length) {
    const sel = options.mask.join(', ')
    await injectCss(
      page,
      `${sel} { background: #ff00ff !important; color: transparent !important; box-shadow: none !important; background-image: none !important; }
${options.mask.map((s) => `${s} *`).join(', ')} { visibility: hidden !important; }`,
    )
  }
  const w = options.waitFor
  if (typeof w === 'number') await page.waitForTimeout(w)
  else if (typeof w === 'string') await page.waitForSelector(w, { timeout: options.timeoutMs })
  else if (typeof w === 'function') await w(page)

  if (options.scrollToLoad) {
    await page.evaluate(async () => {
      const step = Math.max(200, window.innerHeight)
      const total = document.documentElement.scrollHeight
      for (let y = 0; y < total; y += step) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 40))
      }
      window.scrollTo(0, 0)
    })
  }
  await page.evaluate(async () => {
    window.scrollTo(0, 0)
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts
    if (fonts) await fonts.ready
  })
}
