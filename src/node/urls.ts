/**
 * Target URLs: absolute http(s), or relative to a base URL the way links in a
 * page resolve. `pr` moves them onto the origin each side is served on.
 */
import { ElastishotError } from '../core/errors.ts'

export const isHttpUrl = (url: string): boolean => /^https?:\/\//i.test(url)

/** A URL with a scheme of its own (ftp:, file:, data:) is neither http(s) nor relative. */
export const hasScheme = (url: string): boolean => /^[a-z][a-z\d+.-]*:/i.test(url)

/** An absolute URL as it is; a relative one resolved against the base, like a link. */
export function resolveTargetUrl(url: string, baseUrl: string | undefined, target: string): string {
  if (isHttpUrl(url)) return url
  if (!baseUrl) throw new ElastishotError('E_CONFIG', `target "${target}": the relative url "${url}" needs baseUrl in the config, or --base-url`)
  return new URL(url, baseUrl).href
}

/** The same URL on another origin, with its path, query and hash. */
export function withOrigin(url: string, origin: string): string {
  const u = new URL(url)
  const o = new URL(origin)
  u.protocol = o.protocol
  u.host = o.host
  return u.href
}

/** The one origin all these absolute URLs share, or null when they differ or one is relative. */
export function sharedOrigin(urls: string[]): string | null {
  let origin: string | null = null
  for (const url of urls) {
    if (!isHttpUrl(url)) return null
    const o = new URL(url).origin
    if (origin !== null && o !== origin) return null
    origin = o
  }
  return origin
}
