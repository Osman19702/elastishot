/**
 * elastishot.config.(js|mjs|json): named targets, viewports and defaults for
 * the run/snapshot/approve workflow.
 */
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { CaptureOptions } from '../capture/index.ts'
import { ElastishotError } from '../core/errors.ts'
import { REGION_KINDS } from '../core/options.ts'
import type { Box, CompareOptions, RegionKind } from '../core/types.ts'
import type { LocatorOptions } from '../locators/index.ts'
import type { Reporter } from '../pipeline.ts'

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
}

export interface ReportConfigOptions {
  images?: 'files' | 'inline'
  junit?: boolean
  title?: string
}

export interface ElastishotConfig {
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
  /** Extra reporters (JS config only). */
  reporters?: Reporter[]
}

export interface ResolvedConfig {
  rootDir: string
  configPath: string | null
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
  reporters: Reporter[]
}

export interface ResolvedTarget {
  name: string
  url: string
  viewport: ViewportConfig
  capture: CaptureOptions
  compare: CompareOptions
  /** name/viewport, the baseline folder below baselineDir. */
  key: string
}

export const CONFIG_FILES = ['elastishot.config.js', 'elastishot.config.mjs', 'elastishot.config.json']
export const DEFAULT_VIEWPORTS: ViewportConfig[] = [{ name: 'desktop', width: 1280, height: 800 }]

const KNOWN_KEYS = new Set(['baselineDir', 'outDir', 'threshold', 'failOn', 'minRegionScore', 'viewports', 'capture', 'compare', 'locators', 'report', 'targets', 'reporters'])
const TARGET_KEYS = new Set(['name', 'url', 'viewports', 'capture', 'compare', 'ignoreRegions'])

function fail(where: string, message: string): never {
  throw new ElastishotError('E_CONFIG', `${where}: ${message}`)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Structural validation with the path of the offending key in the message. */
export function validateConfig(raw: unknown, where = 'config'): ElastishotConfig {
  if (!isRecord(raw)) fail(where, 'must be an object')
  for (const k of Object.keys(raw)) if (!KNOWN_KEYS.has(k)) fail(where, `unknown key "${k}" (known: ${[...KNOWN_KEYS].join(', ')})`)
  const c = raw as ElastishotConfig
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
      if (typeof t.url !== 'string' || !/^https?:\/\//i.test(t.url)) fail(at, 'needs an http(s) url')
      if (t.viewports !== undefined && (!Array.isArray(t.viewports) || !t.viewports.every((v) => typeof v === 'string'))) fail(at, 'viewports must be an array of viewport names')
      if (names.has(t.name as string)) fail(at, `duplicate target name "${t.name}"`)
      names.add(t.name as string)
    })
  }
  if (c.report !== undefined) {
    if (!isRecord(c.report)) fail(where, 'report must be an object')
    if (c.report.images !== undefined && c.report.images !== 'files' && c.report.images !== 'inline') fail(where, 'report.images must be "files" or "inline"')
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
    baselineDir: path.resolve(rootDir, raw.baselineDir ?? 'baselines'),
    outDir: path.resolve(rootDir, raw.outDir ?? '.elastishot/runs'),
    threshold: raw.threshold ?? 0.98,
    failOn: raw.failOn ?? [...REGION_KINDS],
    minRegionScore: raw.minRegionScore ?? 0.05,
    viewports,
    capture: raw.capture ?? {},
    compare: raw.compare ?? {},
    locators: raw.locators ?? {},
    report: { images: raw.report?.images ?? 'files', junit: raw.report?.junit ?? false, title: raw.report?.title ?? 'Elastishot report' },
    targets: raw.targets ?? [],
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

/** Load the config file (explicit path, or discovered in cwd); no file means defaults. */
export async function loadConfig(cwd = process.cwd(), explicitPath?: string): Promise<ResolvedConfig> {
  let file: string | null = null
  if (explicitPath) {
    file = path.resolve(cwd, explicitPath)
    if (!(await exists(file))) throw new ElastishotError('E_CONFIG', `config file not found: ${file}`)
  } else {
    for (const name of CONFIG_FILES) {
      const p = path.join(cwd, name)
      if (await exists(p)) {
        file = p
        break
      }
    }
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

/** Expand targets × viewports; `filter` keeps only the named targets (name or name/viewport). */
export function resolveTargets(config: ResolvedConfig, filter: string[] = []): ResolvedTarget[] {
  const out: ResolvedTarget[] = []
  const wanted = new Set(filter)
  for (const t of config.targets) {
    const names = t.viewports ?? config.viewports.map((v) => v.name)
    for (const vn of names) {
      const viewport = config.viewports.find((v) => v.name === vn)!
      const key = `${t.name}/${vn}`
      if (wanted.size && !wanted.has(t.name) && !wanted.has(key)) continue
      out.push({
        name: t.name,
        url: t.url,
        viewport,
        capture: { ...config.capture, ...t.capture },
        compare: { ...config.compare, ...t.compare, ...(t.ignoreRegions ? { ignoreRegions: t.ignoreRegions } : {}) },
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
