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

/** Settle the page so two captures of the same state produce the same pixels. */
export async function preparePage(page: Page, options: PrepareOptions): Promise<void> {
  if (options.freezeAnimations) await page.addStyleTag({ content: FREEZE_CSS })
  if (options.hide.length) {
    await page.addStyleTag({ content: `${options.hide.join(', ')} { visibility: hidden !important; }` })
  }
  if (options.mask.length) {
    const sel = options.mask.join(', ')
    await page.addStyleTag({
      content: `${sel} { background: #ff00ff !important; color: transparent !important; box-shadow: none !important; background-image: none !important; }
${options.mask.map((s) => `${s} *`).join(', ')} { visibility: hidden !important; }`,
    })
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
