/**
 * elastishot.config.(js|mjs|json): named targets, viewports and defaults for
 * the run/snapshot/approve workflow.
 */
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { CAPTURE_OPTION_KEYS, type CaptureOptions } from '../capture/index.ts'
import { ElastishotError } from '../core/errors.ts'
import { REGION_KINDS } from '../core/options.ts'
import type { Box, CompareOptions, RegionKind } from '../core/types.ts'
import type { LocatorOptions } from '../locators/index.ts'
import type { Reporter } from '../pipeline.ts'
import type { ServeConfig } from './serve.ts'
import { hasScheme, isHttpUrl, resolveTargetUrl } from './urls.ts'

export interface ViewportConfig {
  name: string
  width: number
  height: number
  deviceScaleFactor?: number
}

export interface TargetConfig {
  name: string
  url: string
  /** Viewport names; default: every configured viewport. */
  viewports?: string[]
  capture?: CaptureOptions
  compare?: CompareOptions
  ignoreRegions?: Box[]
  /** Locators whose boxes are left out of the comparison on both sides, added to the config's `ignore`. */
  ignore?: string[]
  /** A selector the page must show once it is ready (capture.expect for this target). */
  expect?: string
}

export interface ReportConfigOptions {
  images?: 'files' | 'inline'
  junit?: boolean
  /** Also write summary.md, and append it to the GitHub job summary in Actions (pr always does). */
  markdown?: boolean
  title?: string
}

/** A step per side of a pr run; false skips that side. */
export interface PrSteps {
  base?: string | false
  head?: string | false
}

/** How `pr` prepares and serves the base commit and the working tree. */
export interface PrConfig {
  /**
   * Installs dependencies. A string runs in the base worktree only: the working
   * tree is the one running elastishot, so an install there would replace the
   * very packages in use. Default: nothing.
   */
  install?: string | PrSteps
  /** Builds the site. A string runs in both trees. Default: nothing. */
  build?: string | PrSteps
  /** Default: the config folder itself, through the built-in static server. */
  serve?: ServeConfig
  /** The longest an install or build step may take (default 10 minutes). */
  timeoutMs?: number
}

export interface ElastishotConfig {
  /** The URL relative target URLs resolve against; `pr` serves each side on its own origin and keeps this path. */
  baseUrl?: string
  pr?: PrConfig
  baselineDir?: string
  outDir?: string
  threshold?: number
  failOn?: RegionKind[] | 'none'
  minRegionScore?: number
  viewports?: ViewportConfig[]
  capture?: CaptureOptions
  compare?: CompareOptions
  locators?: LocatorOptions
  report?: ReportConfigOptions
  targets?: TargetConfig[]
  /**
   * Locators left out of every comparison: each one is looked up in both
   * element maps and its boxes are ignored on that side. Test ids, ids and
   * role locators work; for other CSS selectors use capture.mask.
   */
  ignore?: string[]
  /** Extra reporters (JS config only). */
  reporters?: Reporter[]
}

export interface ResolvedConfig {
  rootDir: string
  configPath: string | null
  baseUrl: string | null
  pr: PrConfig
  baselineDir: string
  outDir: string
  threshold: number
  failOn: RegionKind[] | 'none'
  minRegionScore: number
  viewports: ViewportConfig[]
  capture: CaptureOptions
  compare: CompareOptions
  locators: LocatorOptions
  report: Required<ReportConfigOptions>
  targets: TargetConfig[]
  ignore: string[]
  reporters: Reporter[]
}

export interface ResolvedTarget {
  name: string
  url: string
  viewport: ViewportConfig
  capture: CaptureOptions
  compare: CompareOptions
  /** The config's and the target's ignore locators. */
  ignore: string[]
  /** name/viewport, the baseline folder below baselineDir. */
  key: string
}

export const CONFIG_FILES = ['elastishot.config.js', 'elastishot.config.mjs', 'elastishot.config.cjs', 'elastishot.config.json']
export const DEFAULT_VIEWPORTS: ViewportConfig[] = [{ name: 'desktop', width: 1280, height: 800 }]

const KNOWN_KEYS = new Set(['baseUrl', 'pr', 'baselineDir', 'outDir', 'threshold', 'failOn', 'minRegionScore', 'viewports', 'capture', 'compare', 'locators', 'report', 'targets', 'ignore', 'reporters'])
const TARGET_KEYS = new Set(['name', 'url', 'viewports', 'capture', 'compare', 'ignoreRegions', 'ignore', 'expect'])
const CAPTURE_KEYS = new Set<string>(CAPTURE_OPTION_KEYS)

function fail(where: string, message: string): never {
  throw new ElastishotError('E_CONFIG', `${where}: ${message}`)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Capture options are checked like the rest: a misspelt key used to be dropped without a word. */
function validateCapture(where: string, c: unknown): void {
  if (!isRecord(c)) fail(where, 'must be an object')
  for (const k of Object.keys(c)) if (!CAPTURE_KEYS.has(k)) fail(where, `unknown key "${k}" (known: ${[...CAPTURE_KEYS].join(', ')})`)
  const oneOf = (key: string, values: string[]) => {
    if (c[key] !== undefined && !values.includes(c[key] as string)) fail(where, `${key} must be ${values.map((v) => `"${v}"`).join(' or ')}`)
  }
  oneOf('colorScheme', ['light', 'dark'])
  oneOf('reducedMotion', ['reduce', 'no-preference'])
  oneOf('animations', ['freeze', 'finish'])
  oneOf('waitUntil', ['load', 'domcontentloaded', 'networkidle', 'commit'])
  for (const key of ['locale', 'timezoneId', 'expect']) if (c[key] !== undefined && (typeof c[key] !== 'string' || !c[key])) fail(where, `${key} must be a non-empty string`)
  if (c.setup !== undefined && typeof c.setup !== 'function') fail(where, 'setup must be a function (JS config only)')
  if (c.storageState !== undefined && typeof c.storageState !== 'string' && !isRecord(c.storageState)) fail(where, 'storageState must be a file path or a storage state object')
  const clock = c.clock
  if (clock !== undefined) {
    const time = isRecord(clock) ? clock.time : clock
    if (!(typeof time === 'string' || typeof time === 'number') || (isRecord(clock) && clock.mode !== undefined && clock.mode !== 'fixed' && clock.mode !== 'install')) {
      fail(where, 'clock must be an ISO date, epoch milliseconds, or { time, mode: "fixed" | "install" }')
    }
  }
}

function validateIgnore(where: string, ignore: unknown): void {
  if (!Array.isArray(ignore) || !ignore.every((s) => typeof s === 'string' && s.trim())) fail(where, 'ignore must be an array of locators')
}

const PR_KEYS = new Set(['install', 'build', 'serve', 'timeoutMs'])
const SERVE_KEYS = new Set(['dir', 'spa', 'basePath', 'command', 'ready', 'timeoutMs', 'env'])

function validatePr(where: string, pr: unknown): void {
  if (!isRecord(pr)) fail(where, 'must be an object')
  for (const k of Object.keys(pr)) if (!PR_KEYS.has(k)) fail(where, `unknown key "${k}" (known: ${[...PR_KEYS].join(', ')})`)
  for (const step of ['install', 'build'] as const) {
    const v = pr[step]
    if (v === undefined || (typeof v === 'string' && v.trim())) continue
    if (!isRecord(v) || !Object.entries(v).every(([side, cmd]) => (side === 'base' || side === 'head') && (cmd === false || (typeof cmd === 'string' && cmd.trim())))) {
      fail(where, `${step} must be a command, or { base, head } with a command or false each`)
    }
  }
  if (pr.timeoutMs !== undefined && !(typeof pr.timeoutMs === 'number' && pr.timeoutMs > 0)) fail(where, 'timeoutMs must be a positive number')
  const serve = pr.serve
  if (serve === undefined) return
  if (!isRecord(serve)) fail(`${where}.serve`, 'must be an object')
  for (const k of Object.keys(serve)) if (!SERVE_KEYS.has(k)) fail(`${where}.serve`, `unknown key "${k}" (known: ${[...SERVE_KEYS].join(', ')})`)
  if (serve.dir !== undefined && serve.command !== undefined) fail(`${where}.serve`, 'takes a dir or a command, not both')
  for (const k of ['dir', 'basePath', 'command'] as const) if (serve[k] !== undefined && (typeof serve[k] !== 'string' || !serve[k])) fail(`${where}.serve`, `${k} must be a non-empty string`)
  if (serve.ready !== undefined && (!isRecord(serve.ready) || !Object.entries(serve.ready).every(([k, v]) => (k === 'log' || k === 'url') && typeof v === 'string'))) fail(`${where}.serve`, 'ready must be { log?: string, url?: string }')
  if (serve.env !== undefined && (!isRecord(serve.env) || !Object.values(serve.env).every((v) => typeof v === 'string'))) fail(`${where}.serve`, 'env must map names to strings')
  if (serve.timeoutMs !== undefined && !(typeof serve.timeoutMs === 'number' && serve.timeoutMs > 0)) fail(`${where}.serve`, 'timeoutMs must be a positive number')
}

/** Structural validation with the path of the offending key in the message. */
export function validateConfig(raw: unknown, where = 'config'): ElastishotConfig {
  if (!isRecord(raw)) fail(where, 'must be an object')
  for (const k of Object.keys(raw)) if (!KNOWN_KEYS.has(k)) fail(where, `unknown key "${k}" (known: ${[...KNOWN_KEYS].join(', ')})`)
  const c = raw as ElastishotConfig
  if (c.baseUrl !== undefined && (typeof c.baseUrl !== 'string' || !isHttpUrl(c.baseUrl))) fail(where, 'baseUrl must be an http(s) URL')
  if (c.baselineDir !== undefined && typeof c.baselineDir !== 'string') fail(where, 'baselineDir must be a string')
  if (c.outDir !== undefined && typeof c.outDir !== 'string') fail(where, 'outDir must be a string')
  if (c.threshold !== undefined && !(typeof c.threshold === 'number' && c.threshold >= 0 && c.threshold <= 1)) fail(where, 'threshold must be a number between 0 and 1')
  if (c.minRegionScore !== undefined && !(typeof c.minRegionScore === 'number' && c.minRegionScore >= 0 && c.minRegionScore <= 1)) fail(where, 'minRegionScore must be between 0 and 1')
  if (c.failOn !== undefined && c.failOn !== 'none') {
    if (!Array.isArray(c.failOn) || !c.failOn.every((k) => REGION_KINDS.includes(k))) fail(where, `failOn must be "none" or an array of ${REGION_KINDS.join(', ')}`)
  }
  if (c.viewports !== undefined) {
    if (!Array.isArray(c.viewports) || c.viewports.length === 0) fail(where, 'viewports must be a non-empty array')
    const names = new Set<string>()
    c.viewports.forEach((v, i) => {
      const at = `${where}.viewports[${i}]`
      if (!isRecord(v) || typeof v.name !== 'string' || !v.name) fail(at, 'needs a name')
      if (!Number.isInteger(v.width) || !Number.isInteger(v.height) || (v.width as number) <= 0 || (v.height as number) <= 0) fail(at, 'needs integer width and height')
      if (v.deviceScaleFactor !== undefined && !(typeof v.deviceScaleFactor === 'number' && v.deviceScaleFactor > 0)) fail(at, 'deviceScaleFactor must be a positive number')
      if (names.has(v.name as string)) fail(at, `duplicate viewport name "${v.name}"`)
      names.add(v.name as string)
    })
  }
  if (c.targets !== undefined) {
    if (!Array.isArray(c.targets)) fail(where, 'targets must be an array')
    const names = new Set<string>()
    c.targets.forEach((t, i) => {
      const at = `${where}.targets[${i}]`
      if (!isRecord(t)) fail(at, 'must be an object')
      for (const k of Object.keys(t)) if (!TARGET_KEYS.has(k)) fail(at, `unknown key "${k}"`)
      if (typeof t.name !== 'string' || !t.name) fail(at, 'needs a name')
      if (typeof t.url !== 'string' || !t.url || (hasScheme(t.url) && !isHttpUrl(t.url))) fail(at, 'needs an http(s) url, or a path relative to baseUrl')
      if (t.viewports !== undefined && (!Array.isArray(t.viewports) || !t.viewports.every((v) => typeof v === 'string'))) fail(at, 'viewports must be an array of viewport names')
      if (t.capture !== undefined) validateCapture(`${at}.capture`, t.capture)
      if (t.ignore !== undefined) validateIgnore(at, t.ignore)
      if (t.expect !== undefined && (typeof t.expect !== 'string' || !t.expect)) fail(at, 'expect must be a selector')
      if (names.has(t.name as string)) fail(at, `duplicate target name "${t.name}"`)
      names.add(t.name as string)
    })
  }
  if (c.capture !== undefined) validateCapture(`${where}.capture`, c.capture)
  if (c.ignore !== undefined) validateIgnore(where, c.ignore)
  if (c.pr !== undefined) validatePr(`${where}.pr`, c.pr)
  if (c.report !== undefined) {
    if (!isRecord(c.report)) fail(where, 'report must be an object')
    if (c.report.images !== undefined && c.report.images !== 'files' && c.report.images !== 'inline') fail(where, 'report.images must be "files" or "inline"')
    for (const key of ['junit', 'markdown'] as const) if (c.report[key] !== undefined && typeof c.report[key] !== 'boolean') fail(where, `report.${key} must be true or false`)
  }
  if (c.reporters !== undefined && (!Array.isArray(c.reporters) || !c.reporters.every((r) => isRecord(r) && typeof r.report === 'function'))) {
    fail(where, 'reporters must be objects with a report() function')
  }
  return c
}

export function resolveConfig(raw: ElastishotConfig, rootDir: string, configPath: string | null = null): ResolvedConfig {
  const viewports = raw.viewports ?? DEFAULT_VIEWPORTS
  const known = new Set(viewports.map((v) => v.name))
  for (const t of raw.targets ?? []) {
    for (const v of t.viewports ?? []) if (!known.has(v)) fail(`config.targets(${t.name})`, `unknown viewport "${v}"`)
  }
  return {
    rootDir,
    configPath,
    baseUrl: raw.baseUrl ?? null,
    pr: raw.pr ?? {},
    baselineDir: path.resolve(rootDir, raw.baselineDir ?? 'baselines'),
    outDir: path.resolve(rootDir, raw.outDir ?? '.elastishot/runs'),
    threshold: raw.threshold ?? 0.98,
    failOn: raw.failOn ?? [...REGION_KINDS],
    minRegionScore: raw.minRegionScore ?? 0.05,
    viewports,
    capture: raw.capture ?? {},
    compare: raw.compare ?? {},
    locators: raw.locators ?? {},
    report: { images: raw.report?.images ?? 'files', junit: raw.report?.junit ?? false, markdown: raw.report?.markdown ?? false, title: raw.report?.title ?? 'Elastishot report' },
    targets: raw.targets ?? [],
    ignore: raw.ignore ?? [],
    reporters: raw.reporters ?? [],
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** The nearest config file in cwd or the folders above it, the way npm finds package.json. */
export async function findConfigFile(cwd: string): Promise<string | null> {
  for (let dir = path.resolve(cwd); ; ) {
    for (const name of CONFIG_FILES) {
      const p = path.join(dir, name)
      if (await exists(p)) return p
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Load the config file (explicit path, or the nearest one from cwd up); no file means defaults. */
export async function loadConfig(cwd = process.cwd(), explicitPath?: string): Promise<ResolvedConfig> {
  let file: string | null = null
  if (explicitPath) {
    file = path.resolve(cwd, explicitPath)
    if (!(await exists(file))) throw new ElastishotError('E_CONFIG', `config file not found: ${file}`)
  } else {
    file = await findConfigFile(cwd)
  }
  if (!file) return resolveConfig({}, cwd, null)
  let raw: unknown
  try {
    if (file.endsWith('.json')) raw = JSON.parse(await readFile(file, 'utf8'))
    else {
      const mod = (await import(pathToFileURL(file).href)) as { default?: unknown }
      raw = mod.default ?? mod
    }
  } catch (cause) {
    if (cause instanceof ElastishotError) throw cause
    throw new ElastishotError('E_CONFIG', `cannot load ${file}: ${(cause as Error).message}`, { cause })
  }
  return resolveConfig(validateConfig(raw, path.basename(file)), path.dirname(file), file)
}

/**
 * Expand targets × viewports; `filter` keeps only the named targets (name or
 * name/viewport). Relative target URLs resolve against `baseUrl`, the
 * config's unless one is given.
 */
export function resolveTargets(config: ResolvedConfig, filter: string[] = [], options: { baseUrl?: string } = {}): ResolvedTarget[] {
  const out: ResolvedTarget[] = []
  const wanted = new Set(filter)
  const baseUrl = options.baseUrl ?? config.baseUrl ?? undefined
  for (const t of config.targets) {
    const names = t.viewports ?? config.viewports.map((v) => v.name)
    for (const vn of names) {
      const viewport = config.viewports.find((v) => v.name === vn)!
      const key = `${t.name}/${vn}`
      if (wanted.size && !wanted.has(t.name) && !wanted.has(key)) continue
      out.push({
        name: t.name,
        url: resolveTargetUrl(t.url, baseUrl, t.name),
        viewport,
        capture: { ...config.capture, ...t.capture, ...(t.expect ? { expect: t.expect } : {}) },
        compare: { ...config.compare, ...t.compare, ...(t.ignoreRegions ? { ignoreRegions: t.ignoreRegions } : {}) },
        ignore: [...config.ignore, ...(t.ignore ?? [])],
        key,
      })
    }
  }
  if (wanted.size) {
    const found = new Set(out.flatMap((r) => [r.name, r.key]))
    for (const w of wanted) if (!found.has(w)) throw new ElastishotError('E_USAGE', `unknown target "${w}" (targets: ${config.targets.map((t) => t.name).join(', ') || 'none'})`)
  }
  return out
}
