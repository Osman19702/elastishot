import type { Browser, BrowserType } from 'playwright'

import { ElastishotError } from '../core/errors.ts'

export type BrowserName = 'chromium' | 'firefox' | 'webkit'

let playwrightModule: Promise<typeof import('playwright')> | null = null

/** Playwright is an optional peer dependency; load it on first use with a clear error. */
export function loadPlaywright(): Promise<typeof import('playwright')> {
  playwrightModule ??= import('playwright').catch((cause: unknown) => {
    playwrightModule = null
    throw new ElastishotError(
      'E_CAPTURE',
      'capturing pages needs Playwright: npm install -D playwright && npx playwright install chromium',
      { cause },
    )
  })
  return playwrightModule
}

export async function launchBrowser(name: BrowserName = 'chromium'): Promise<Browser> {
  const pw = await loadPlaywright()
  const type: BrowserType = pw[name]
  try {
    return await type.launch({ headless: true })
  } catch (cause) {
    throw new ElastishotError('E_CAPTURE', `cannot launch ${name}: ${(cause as Error).message}`, { cause })
  }
}
