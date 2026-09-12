import { parseArgs } from 'node:util'

import { ElastishotError } from '../core/errors.ts'
import { REGION_KINDS } from '../core/options.ts'
import type { RegionKind } from '../core/types.ts'
import type { ViewportConfig } from '../node/config.ts'

export class UsageError extends ElastishotError {
  constructor(message: string) {
    super('E_USAGE', message)
    this.name = 'UsageError'
  }
}

export const COMMANDS = ['compare', 'snapshot', 'run', 'approve', 'report'] as const
export type Command = (typeof COMMANDS)[number]

export const USAGE = `Usage: elastishot <command> [options]

Commands
  compare <baseline> <candidate>     Compare two sides: baseline folder, PNG/JPEG path, image URL or page URL each
  snapshot <url>                     Capture a page (PNG + element map + meta) as a baseline
  run [target...]                    Capture and compare every target x viewport from elastishot.config
  approve [target[/viewport]|runDir] Promote a run's candidate to the baseline (--all for every failed or new pair)
  report <runDir>                    Re-render index.html and junit.xml from a run's report.json

Options
  --out <dir>             Output folder (snapshot: the baseline folder; compare/run: the run folder)
  --config <file>         elastishot.config.(js|mjs|json) (default: discovered in the current folder)
  --name <name>           Name of the pair or snapshot (default: derived from the candidate)
  --threshold <0..1>      Minimum similarity to pass (default 0.98)
  --fail-on <kinds>       Comma list of added,removed,changed,moved, or none (default: all)
  --viewport <WxH[@dpr]>  Viewport for page captures, e.g. 1280x800 or 390x844@2
  --full-page             Capture the whole scrollable page
  --wait-for <sel|ms>     Wait for a selector or a delay before capturing
  --hide <selector>       Hide matching elements before capturing (repeatable)
  --no-map                Skip the element map
  --junit                 Also write junit.xml into the run folder
  --junit-file <file>     Write JUnit XML to this file
  --single-file           Inline every image into the HTML reports
  --update                run: write missing baselines instead of failing them
  --all                   approve: promote every failed or new pair
  --json                  Print the result as one JSON object and nothing else
  --quiet                 Print only the summary line
  -v, --version           Print the version
  -h, --help              Show this help

Exit codes
  0  pass: every pair at or above the threshold with no regions of a --fail-on kind
  1  differences found, or a target without a baseline (unless --update)
  2  usage error, or a runtime error (browser, engine, unreadable input)`

export interface ParsedArgs {
  command: Command | null
  positionals: string[]
  out?: string
  config?: string
  name?: string
  threshold?: number
  failOn?: RegionKind[] | 'none'
  viewport?: ViewportConfig
  fullPage?: boolean
  waitFor?: string | number
  hide: string[]
  noMap: boolean
  junit: boolean
  junitFile?: string
  singleFile: boolean
  update: boolean
  all: boolean
  json: boolean
  quiet: boolean
  help: boolean
  version: boolean
}

export function parseViewport(value: string): ViewportConfig {
  const m = /^(\d+)x(\d+)(?:@(\d+(?:\.\d+)?))?$/i.exec(value.trim())
  if (!m) throw new UsageError(`--viewport must look like 1280x800 or 390x844@2, got "${value}"`)
  const dpr = m[3] ? Number(m[3]) : undefined
  return { name: value.trim(), width: Number(m[1]), height: Number(m[2]), ...(dpr ? { deviceScaleFactor: dpr } : {}) }
}

export function parseFailOn(value: string): RegionKind[] | 'none' {
  if (value.trim() === 'none') return 'none'
  const kinds = value.split(',').map((s) => s.trim()).filter(Boolean)
  for (const k of kinds) if (!REGION_KINDS.includes(k as RegionKind)) throw new UsageError(`--fail-on: unknown kind "${k}" (use ${REGION_KINDS.join(', ')} or none)`)
  if (!kinds.length) throw new UsageError('--fail-on needs at least one kind or none')
  return kinds as RegionKind[]
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true; strict: true }>>
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  } catch (e) {
    throw new UsageError((e as Error).message.replace(/\.$/, ''))
  }
  const v = parsed.values
  const [command, ...positionals] = parsed.positionals
  if (command !== undefined && !COMMANDS.includes(command as Command)) throw new UsageError(`unknown command "${command}" (commands: ${COMMANDS.join(', ')})`)
  let threshold: number | undefined
  if (v.threshold !== undefined) {
    threshold = Number(v.threshold)
    if (!(threshold >= 0 && threshold <= 1)) throw new UsageError(`--threshold must be between 0 and 1, got "${v.threshold}"`)
  }
  let waitFor: string | number | undefined
  if (v['wait-for'] !== undefined) waitFor = /^\d+$/.test(v['wait-for']) ? Number(v['wait-for']) : v['wait-for']
  return {
    command: (command as Command | undefined) ?? null,
    positionals,
    ...(v.out !== undefined ? { out: v.out } : {}),
    ...(v.config !== undefined ? { config: v.config } : {}),
    ...(v.name !== undefined ? { name: v.name } : {}),
    ...(threshold !== undefined ? { threshold } : {}),
    ...(v['fail-on'] !== undefined ? { failOn: parseFailOn(v['fail-on']) } : {}),
    ...(v.viewport !== undefined ? { viewport: parseViewport(v.viewport) } : {}),
    ...(v['full-page'] !== undefined ? { fullPage: v['full-page'] } : {}),
    ...(waitFor !== undefined ? { waitFor } : {}),
    hide: v.hide ?? [],
    noMap: v['no-map'] ?? false,
    junit: v.junit ?? false,
    ...(v['junit-file'] !== undefined ? { junitFile: v['junit-file'] } : {}),
    singleFile: v['single-file'] ?? false,
    update: v.update ?? false,
    all: v.all ?? false,
    json: v.json ?? false,
    quiet: v.quiet ?? false,
    help: v.help ?? false,
    version: v.version ?? false,
  }
}

const OPTIONS = {
  out: { type: 'string' },
  config: { type: 'string' },
  name: { type: 'string' },
  threshold: { type: 'string' },
  'fail-on': { type: 'string' },
  viewport: { type: 'string' },
  'full-page': { type: 'boolean' },
  'wait-for': { type: 'string' },
  hide: { type: 'string', multiple: true },
  'no-map': { type: 'boolean' },
  junit: { type: 'boolean' },
  'junit-file': { type: 'string' },
  'single-file': { type: 'boolean' },
  update: { type: 'boolean' },
  all: { type: 'boolean' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const
