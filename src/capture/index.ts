/**
 * elastishot/capture: screenshot a page with Playwright and record an
 * element map next to it, so diff regions can later be named by locator.
 */
import type { Browser, BrowserContext, Page } from 'playwright'

import { ElastishotError } from '../core/errors.ts'
import type { ElementMap, Snapshot } from '../core/types.ts'
import { createSnapshotMeta } from '../node/baselines.ts'
import { decodeImage } from '../node/io.ts'
import { launchBrowser, type BrowserName } from './browser.ts'
import { buildCollectScript, type CollectResult } from './collect.ts'
import { preparePage } from './prepare.ts'

export { buildCollectScript, type CollectOptions, type CollectResult, type CollectedElement } from './collect.ts'
export { launchBrowser, loadPlaywright, type BrowserName } from './browser.ts'
export { preparePage, type PrepareOptions } from './prepare.ts'

export interface CaptureTarget {
  url: string
  /** Label stored in the snapshot meta. */
  name?: string
}

export interface ElementMapOptions {
  maxElements?: number
  minSize?: number
  testAttributes?: string[]
  text?: boolean
}

export interface CaptureOptions {
  viewport?: { width: number; height: number }
  deviceScaleFactor?: number
  fullPage?: boolean
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'
  /** Selector to wait for, milliseconds to wait, or a custom wait. */
  waitFor?: string | number | ((page: Page) => Promise<void>)
  /** Selectors made invisible (layout kept). */
  hide?: string[]
  /** Selectors painted solid. */
  mask?: string[]
  freezeAnimations?: boolean
  /** Scroll through the page first so lazy content loads (default: fullPage). */
  scrollToLoad?: boolean
  /** false disables the element map. */
  elementMap?: false | ElementMapOptions
  headers?: Record<string, string>
  storageState?: string
  timeoutMs?: number
  /** Reuse a page (its context and viewport are used as-is). */
  page?: Page
  /** Reuse a browser; a context is created and closed per capture. */
  browser?: Browser
  browserType?: BrowserName
}

export const DEFAULT_TEST_ATTRIBUTES = ['data-testid', 'data-test', 'data-cy']

interface Resolved {
  viewport: { width: number; height: number }
  deviceScaleFactor: number
  fullPage: boolean
  waitUntil: NonNullable<CaptureOptions['waitUntil']>
  waitFor?: CaptureOptions['waitFor']
  hide: string[]
  mask: string[]
  freezeAnimations: boolean
  scrollToLoad: boolean
  elementMap: false | Required<ElementMapOptions>
  headers?: Record<string, string>
  storageState?: string
  timeoutMs: number
  browserType: BrowserName
}

function resolve(o: CaptureOptions): Resolved {
  const fullPage = o.fullPage ?? false
  const em = o.elementMap === false ? false : { maxElements: 5000, minSize: 4, testAttributes: DEFAULT_TEST_ATTRIBUTES, text: true, ...(o.elementMap ?? {}) }
  return {
    viewport: o.viewport ?? { width: 1280, height: 800 },
    deviceScaleFactor: o.deviceScaleFactor ?? 1,
    fullPage,
    waitUntil: o.waitUntil ?? 'networkidle',
    ...(o.waitFor !== undefined ? { waitFor: o.waitFor } : {}),
    hide: o.hide ?? [],
    mask: o.mask ?? [],
    freezeAnimations: o.freezeAnimations ?? true,
    scrollToLoad: o.scrollToLoad ?? fullPage,
    elementMap: em,
    ...(o.headers ? { headers: o.headers } : {}),
    ...(o.storageState ? { storageState: o.storageState } : {}),
    timeoutMs: o.timeoutMs ?? 30_000,
    browserType: o.browserType ?? 'chromium',
  }
}

async function captureOnPage(page: Page, target: CaptureTarget, r: Resolved): Promise<Snapshot> {
  const capturedAt = new Date().toISOString()
  try {
    await page.goto(target.url, { waitUntil: r.waitUntil, timeout: r.timeoutMs })
  } catch (cause) {
    throw new ElastishotError('E_CAPTURE', `cannot open ${target.url}: ${(cause as Error).message}`, { cause })
  }
  await preparePage(page, r)

  let collected: CollectResult | null = null
  if (r.elementMap) {
    const viewport = page.viewportSize() ?? r.viewport
    collected = (await page.evaluate(
      buildCollectScript({
        testAttributes: r.elementMap.testAttributes,
        maxElements: r.elementMap.maxElements,
        minSize: r.elementMap.minSize,
        includeText: r.elementMap.text,
        fullPage: r.fullPage,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        dpr: r.deviceScaleFactor,
      }),
    )) as CollectResult
  }
  const png = new Uint8Array(await page.screenshot({ fullPage: r.fullPage, type: 'png', timeout: r.timeoutMs, animations: 'disabled' }))
  const image = decodeImage(png, { url: target.url, id: target.name ?? target.url, devicePixelRatio: r.deviceScaleFactor })
  const viewport = page.viewportSize() ?? r.viewport
  const elementMap: ElementMap | null = collected
    ? {
        schema: 'elastishot.element-map/1',
        url: target.url,
        capturedAt,
        viewport,
        dpr: r.deviceScaleFactor,
        fullPage: r.fullPage,
        image: { width: image.width, height: image.height },
        truncated: collected.truncated,
        elements: collected.elements.map((e, i) => ({ i, ...e })),
      }
    : null
  const meta = createSnapshotMeta({
    url: target.url,
    capturedAt,
    viewport: { ...viewport, deviceScaleFactor: r.deviceScaleFactor },
    dpr: r.deviceScaleFactor,
    fullPage: r.fullPage,
    ...(target.name ? { target: target.name } : {}),
  })
  return { image, png, elementMap, meta }
}

async function withContext<T>(browser: Browser, r: Resolved, fn: (page: Page) => Promise<T>): Promise<T> {
  let context: BrowserContext
  try {
    context = await browser.newContext({
      viewport: r.viewport,
      deviceScaleFactor: r.deviceScaleFactor,
      reducedMotion: 'reduce',
      ...(r.headers ? { extraHTTPHeaders: r.headers } : {}),
      ...(r.storageState ? { storageState: r.storageState } : {}),
    })
  } catch (cause) {
    throw new ElastishotError('E_CAPTURE', `cannot create a browser context: ${(cause as Error).message}`, { cause })
  }
  try {
    const page = await context.newPage()
    return await fn(page)
  } finally {
    await context.close()
  }
}

/** Capture one page. Launches and closes a browser unless one is supplied. */
export async function capture(target: CaptureTarget | string, options: CaptureOptions = {}): Promise<Snapshot> {
  const t = typeof target === 'string' ? { url: target } : target
  const r = resolve(options)
  if (options.page) return captureOnPage(options.page, t, r)
  if (options.browser) return withContext(options.browser, r, (page) => captureOnPage(page, t, r))
  const browser = await launchBrowser(r.browserType)
  try {
    return await withContext(browser, r, (page) => captureOnPage(page, t, r))
  } finally {
    await browser.close()
  }
}

export interface CaptureAdapter {
  capture(target: CaptureTarget | string, options?: CaptureOptions): Promise<Snapshot>
  /** Close the browser this adapter launched. */
  close(): Promise<void>
}

/** An adapter that keeps one browser open across captures. */
export function createCaptureAdapter(defaults: CaptureOptions = {}): CaptureAdapter {
  let browser: Promise<Browser> | null = null
  const get = (): Promise<Browser> => (browser ??= launchBrowser(defaults.browserType ?? 'chromium'))
  return {
    async capture(target, options = {}) {
      const merged = { ...defaults, ...options }
      if (merged.page || merged.browser) return capture(target, merged)
      return capture(target, { ...merged, browser: await get() })
    },
    async close() {
      const b = browser
      browser = null
      if (b) await (await b).close()
    },
  }
}
