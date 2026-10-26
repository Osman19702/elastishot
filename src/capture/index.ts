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
import { buildCollectScript, clipElements, type CollectResult } from './collect.ts'
import { finishAnimations, preparePage } from './prepare.ts'

export { buildCollectScript, clipElements, type CollectOptions, type CollectResult, type CollectedElement } from './collect.ts'
export { launchBrowser, loadPlaywright, type BrowserName } from './browser.ts'
export { finishAnimations, preparePage, type PrepareOptions } from './prepare.ts'

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

/** Playwright's storage state: cookies and per-origin localStorage, as `context.storageState()` returns it. */
export type StorageState = Exclude<NonNullable<Parameters<Browser['newContext']>[0]>['storageState'], string | undefined>

/** A fixed moment for the page clock: an ISO date, epoch milliseconds, or that plus a mode. */
export type ClockOption = string | number | { time: string | number; mode?: 'fixed' | 'install' }

export interface CaptureOptions {
  viewport?: { width: number; height: number }
  deviceScaleFactor?: number
  fullPage?: boolean
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'
  /** Selector to wait for, milliseconds to wait ("2000ms" too), or a custom wait. */
  waitFor?: string | number | ((page: Page) => Promise<void>)
  /** A selector that must be on the page once it is ready; a capture without it fails instead of becoming a baseline. */
  expect?: string
  /** Emulated prefers-color-scheme for the capture (default: the browser's, which is light). */
  colorScheme?: 'light' | 'dark'
  /** Emulated prefers-reduced-motion (default 'reduce'). */
  reducedMotion?: 'reduce' | 'no-preference'
  /** Browser locale, e.g. 'en-GB': navigator.language, Intl formatting and Accept-Language. */
  locale?: string
  /** IANA time zone, e.g. 'Europe/London'. */
  timezoneId?: string
  /**
   * Pin the page clock before the page loads. 'fixed' (the default) makes
   * Date.now() and new Date() return this time while timers keep running;
   * 'install' starts a fake clock at this time that moves with the timers.
   * Needs Playwright 1.45 or newer.
   */
  clock?: ClockOption
  /** Runs before navigation with the page and its context: seed storage, add cookies, route requests. */
  setup?: (page: Page, context: BrowserContext) => Promise<void>
  /** Selectors made invisible (layout kept). */
  hide?: string[]
  /** Selectors painted solid. */
  mask?: string[]
  freezeAnimations?: boolean
  /**
   * 'freeze' (default) turns CSS animations and transitions off. 'finish'
   * fast-forwards them to their end instead, so animationend and
   * transitionend handlers run: some components only reach their final state
   * there.
   */
  animations?: 'freeze' | 'finish'
  /** Scroll through the page first so lazy content loads (default: fullPage). */
  scrollToLoad?: boolean
  /** false disables the element map. */
  elementMap?: false | ElementMapOptions
  headers?: Record<string, string>
  /** A storage state file (resolved against the config folder in a config) or the state itself. */
  storageState?: string | StorageState
  timeoutMs?: number
  /** Reuse a page (its context and viewport are used as-is, so context options above do not apply). */
  page?: Page
  /** Reuse a browser; a context is created and closed per capture. */
  browser?: Browser
  browserType?: BrowserName
}

/** Every CaptureOptions key, for config validation. */
export const CAPTURE_OPTION_KEYS: ReadonlyArray<keyof CaptureOptions> = [
  'viewport', 'deviceScaleFactor', 'fullPage', 'waitUntil', 'waitFor', 'expect', 'colorScheme', 'reducedMotion', 'locale', 'timezoneId', 'clock', 'setup',
  'hide', 'mask', 'freezeAnimations', 'animations', 'scrollToLoad', 'elementMap', 'headers', 'storageState', 'timeoutMs', 'page', 'browser', 'browserType',
]

export const DEFAULT_TEST_ATTRIBUTES = ['data-testid', 'data-test', 'data-cy']

interface Resolved {
  viewport: { width: number; height: number }
  deviceScaleFactor: number
  fullPage: boolean
  waitUntil: NonNullable<CaptureOptions['waitUntil']>
  waitFor?: CaptureOptions['waitFor']
  expect?: string
  colorScheme?: 'light' | 'dark'
  reducedMotion: 'reduce' | 'no-preference'
  locale?: string
  timezoneId?: string
  clock?: ClockOption
  setup?: CaptureOptions['setup']
  hide: string[]
  mask: string[]
  freezeAnimations: boolean
  animations: 'freeze' | 'finish'
  scrollToLoad: boolean
  elementMap: false | Required<ElementMapOptions>
  headers?: Record<string, string>
  storageState?: string | StorageState
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
    ...(o.expect ? { expect: o.expect } : {}),
    ...(o.colorScheme ? { colorScheme: o.colorScheme } : {}),
    reducedMotion: o.reducedMotion ?? 'reduce',
    ...(o.locale ? { locale: o.locale } : {}),
    ...(o.timezoneId ? { timezoneId: o.timezoneId } : {}),
    ...(o.clock !== undefined ? { clock: o.clock } : {}),
    ...(o.setup ? { setup: o.setup } : {}),
    hide: o.hide ?? [],
    mask: o.mask ?? [],
    freezeAnimations: o.freezeAnimations ?? true,
    animations: o.animations ?? 'freeze',
    scrollToLoad: o.scrollToLoad ?? fullPage,
    elementMap: em,
    ...(o.headers ? { headers: o.headers } : {}),
    ...(o.storageState ? { storageState: o.storageState } : {}),
    timeoutMs: o.timeoutMs ?? 30_000,
    browserType: o.browserType ?? 'chromium',
  }
}

interface PlaywrightClock {
  setFixedTime(time: number | string | Date): Promise<void>
  install(options?: { time?: number | string | Date }): Promise<void>
}

/** Pin the page clock before navigation; page.clock arrived in Playwright 1.45. */
async function setClock(page: Page, clock: ClockOption): Promise<void> {
  const api = (page as Page & { clock?: PlaywrightClock }).clock
  if (!api) throw new ElastishotError('E_CAPTURE', 'capture.clock needs Playwright 1.45 or newer')
  const { time, mode } = typeof clock === 'object' ? { time: clock.time, mode: clock.mode ?? 'fixed' } : { time: clock, mode: 'fixed' as const }
  if (mode === 'install') await api.install({ time })
  else await api.setFixedTime(time)
}

async function captureOnPage(page: Page, target: CaptureTarget, r: Resolved): Promise<Snapshot> {
  const capturedAt = new Date().toISOString()
  // Both shape the page from its first script, so they run before navigation.
  if (r.clock !== undefined) await setClock(page, r.clock)
  if (r.setup) {
    try {
      await r.setup(page, page.context())
    } catch (cause) {
      throw new ElastishotError('E_CAPTURE', `capture.setup failed before ${target.url}: ${(cause as Error).message}`, { cause })
    }
  }
  let httpStatus: number | undefined
  try {
    const response = await page.goto(target.url, { waitUntil: r.waitUntil, timeout: r.timeoutMs })
    httpStatus = response?.status()
  } catch (cause) {
    throw new ElastishotError('E_CAPTURE', `cannot open ${target.url}: ${(cause as Error).message}`, { cause })
  }
  await preparePage(page, r)
  if (r.expect) {
    try {
      await page.waitForSelector(r.expect, { state: 'attached', timeout: Math.min(r.timeoutMs, 5_000) })
    } catch (cause) {
      throw new ElastishotError('E_CAPTURE', `${target.url}: expected ${r.expect} on the page, but it is not there (the page is at ${page.url()})`, { cause })
    }
  }
  // Animations a waitFor or the lazy-load scroll started late reach their end too.
  if (r.freezeAnimations && r.animations === 'finish') await finishAnimations(page)
  const finalUrl = page.url()
  const title = (await page.title().catch(() => '')).trim()

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
        // A page that scrolls inside a fixed body is captured at viewport
        // height while its map runs further down; boxes past the picture
        // would name pixels that do not exist.
        elements: clipElements(collected.elements, image.width, image.height, (r.elementMap ? r.elementMap.minSize : 0) * r.deviceScaleFactor).map((e, i) => ({ i, ...e })),
      }
    : null
  const meta = createSnapshotMeta({
    url: target.url,
    ...(finalUrl && finalUrl !== target.url ? { finalUrl } : {}),
    capturedAt,
    viewport: { ...viewport, deviceScaleFactor: r.deviceScaleFactor },
    dpr: r.deviceScaleFactor,
    fullPage: r.fullPage,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(title ? { title } : {}),
    ...(target.name ? { target: target.name } : {}),
    ...(r.colorScheme ? { colorScheme: r.colorScheme } : {}),
    reducedMotion: r.reducedMotion,
    ...(r.locale ? { locale: r.locale } : {}),
    ...(r.timezoneId ? { timezoneId: r.timezoneId } : {}),
  })
  return { image, png, elementMap, meta }
}

async function withContext<T>(browser: Browser, r: Resolved, fn: (page: Page) => Promise<T>): Promise<T> {
  let context: BrowserContext
  try {
    context = await browser.newContext({
      viewport: r.viewport,
      deviceScaleFactor: r.deviceScaleFactor,
      reducedMotion: r.reducedMotion,
      ...(r.colorScheme ? { colorScheme: r.colorScheme } : {}),
      ...(r.locale ? { locale: r.locale } : {}),
      ...(r.timezoneId ? { timezoneId: r.timezoneId } : {}),
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
