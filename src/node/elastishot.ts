/**
 * The Node façade: snapshot, compare, run and approve with files, folders,
 * Playwright captures, reporters and plugin hooks wired together. The CLI is
 * a thin layer over this; a larger tool can drive it directly.
 */
import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { createCaptureAdapter, type CaptureAdapter, type CaptureOptions, type CaptureTarget } from '../capture/index.ts'
import type { Engine } from '../core/engine-seam.ts'
import { ElastishotError } from '../core/errors.ts'
import type { CompareOptions, RegionKind, Snapshot } from '../core/types.ts'
import { comparePair, type Plugin, type Reporter, type ReporterOutput } from '../pipeline.ts'
import { buildReport, isReportJson, type PairReport, type PairStatus, type ReportJson } from '../report/schema.ts'
import { writePairArtifacts } from './artifacts.ts'
import { BASELINE_FILES, CANDIDATE_FILES, isSnapshotDir, readSnapshotDir, writeSnapshotDir } from './baselines.ts'
import { loadConfig, resolveConfig, resolveTargets, validateConfig, type ElastishotConfig, type ResolvedConfig, type ResolvedTarget, type ViewportConfig } from './config.ts'
import { resolveInput, type ResolvedSide, type SideInput } from './inputs.ts'
import { htmlReporter, jsonReporter, junitReporter } from './reporters.ts'
import { baselineDirFor, makeRunId, pairId, readLatest, slug, writeLatest } from './runs.ts'
import { ELASTISHOT_VERSION } from './version.ts'

export interface ElastishotOptions {
  /** A config object, a resolved config, or nothing (discovered from cwd). */
  config?: ElastishotConfig | ResolvedConfig
  configPath?: string
  cwd?: string
  engine?: Engine
  capture?: CaptureAdapter
  plugins?: Plugin[]
  reporters?: Reporter[]
}

export interface RunResult {
  report: ReportJson
  runDir: string
  outputs: ReporterOutput[]
  exitCode: 0 | 1 | 2
}

export interface CompareCallOptions {
  /** Run folder; default <outDir>/<runId>. */
  out?: string
  runId?: string
  name?: string
  viewport?: ViewportConfig
  capture?: CaptureOptions
  compare?: CompareOptions
  threshold?: number
  failOn?: RegionKind[] | 'none'
  images?: 'files' | 'inline'
  junit?: boolean | string
}

export interface RunCallOptions {
  targets?: string[]
  /** Write missing baselines instead of reporting them as new. */
  update?: boolean
  /** With update: also replace baselines this run found different. */
  force?: boolean
  /** Minimum similarity to pass; overrides the config for this run. */
  threshold?: number
  failOn?: RegionKind[] | 'none'
  /** Capture options applied to every target, over the config's. */
  capture?: CaptureOptions
  out?: string
  runId?: string
  images?: 'files' | 'inline'
  junit?: boolean | string
}

export interface SnapshotCallOptions {
  out?: string
  name?: string
  viewport?: ViewportConfig
  capture?: CaptureOptions
}

export interface ApproveCallOptions {
  /** target or target/viewport; default: every failed or new pair with --all. */
  target?: string
  runDir?: string
  all?: boolean
}

export interface ApproveResult {
  approved: string[]
  candidates: string[]
  /** The run folder the candidates came from. */
  runDir: string
  /** Things worth telling the user: which run was used and why, mismatched baseline folders. */
  notes: string[]
}

export interface Elastishot {
  readonly config: ResolvedConfig
  use(plugin: Plugin): Elastishot
  snapshot(target: string | CaptureTarget, options?: SnapshotCallOptions): Promise<{ snapshot: Snapshot; dir: string }>
  compare(baseline: SideInput, candidate: SideInput, options?: CompareCallOptions): Promise<RunResult>
  run(options?: RunCallOptions): Promise<RunResult>
  approve(options?: ApproveCallOptions): Promise<ApproveResult>
  close(): Promise<void>
}

const isResolvedConfig = (c: ElastishotConfig | ResolvedConfig): c is ResolvedConfig => 'rootDir' in c && 'configPath' in c

/** A pair name from the candidate: the last URL segment or host, or the file name without extension. */
function deriveName(input: SideInput): string {
  if (typeof input !== 'string') return 'compare'
  if (/^https?:\/\//i.test(input)) {
    try {
      const u = new URL(input)
      const last = u.pathname.split('/').filter(Boolean).pop()
      return last ?? u.hostname
    } catch {
      return 'page'
    }
  }
  const trimmed = input.replace(/[/\\]+$/, '')
  return path.parse(trimmed).name || path.basename(trimmed) || 'compare'
}

export async function createElastishot(options: ElastishotOptions = {}): Promise<Elastishot> {
  const cwd = options.cwd ?? process.cwd()
  let config: ResolvedConfig
  if (options.config) config = isResolvedConfig(options.config) ? options.config : resolveConfig(validateConfig(options.config), cwd)
  else config = await loadConfig(cwd, options.configPath)
  return new ElastishotImpl(config, options)
}

class ElastishotImpl implements Elastishot {
  readonly config: ResolvedConfig
  readonly #plugins: Plugin[]
  readonly #reporters: Reporter[]
  readonly #engine: Engine | undefined
  #adapter: CaptureAdapter | null
  readonly #ownsAdapter: boolean

  constructor(config: ResolvedConfig, options: ElastishotOptions) {
    this.config = config
    this.#plugins = [...(options.plugins ?? [])]
    this.#reporters = [...config.reporters, ...(options.reporters ?? [])]
    this.#engine = options.engine
    this.#adapter = options.capture ?? null
    this.#ownsAdapter = !options.capture
  }

  use(plugin: Plugin): Elastishot {
    this.#plugins.push(plugin)
    return this
  }

  async close(): Promise<void> {
    if (this.#ownsAdapter && this.#adapter) await this.#adapter.close()
    this.#adapter = null
  }

  #adapterOrCreate(): CaptureAdapter {
    this.#adapter ??= createCaptureAdapter(this.config.capture)
    return this.#adapter
  }

  #captureOptions(viewport?: ViewportConfig, extra?: CaptureOptions): CaptureOptions {
    const options: CaptureOptions = {
      ...this.config.capture,
      ...(viewport ? { viewport: { width: viewport.width, height: viewport.height }, ...(viewport.deviceScaleFactor ? { deviceScaleFactor: viewport.deviceScaleFactor } : {}) } : {}),
      ...extra,
    }
    // A storage state file named in the config is relative to the config, wherever the command runs.
    if (typeof options.storageState === 'string') options.storageState = path.resolve(this.config.rootDir, options.storageState)
    return options
  }

  async #capture(target: CaptureTarget, captureOptions: CaptureOptions): Promise<Snapshot> {
    const snapshot = await this.#adapterOrCreate().capture(target, captureOptions)
    for (const p of this.#plugins) await p.onCaptured?.({ target, snapshot })
    return snapshot
  }

  async snapshot(target: string | CaptureTarget, o: SnapshotCallOptions = {}): Promise<{ snapshot: Snapshot; dir: string }> {
    const t = typeof target === 'string' ? { url: target, ...(o.name ? { name: o.name } : {}) } : target
    const viewport = o.viewport ?? this.config.viewports[0]!
    const snapshot = await this.#capture({ ...t, name: t.name ?? o.name ?? slug(t.url) }, this.#captureOptions(viewport, o.capture))
    snapshot.meta.viewportName = viewport.name
    const dir = o.out ? path.resolve(this.config.rootDir, o.out) : baselineDirFor(this.config.baselineDir, t.name ?? o.name ?? slug(t.url), viewport.name)
    await writeSnapshotDir(dir, snapshot)
    return { snapshot, dir }
  }

  async compare(baselineInput: SideInput, candidateInput: SideInput, o: CompareCallOptions = {}): Promise<RunResult> {
    const runId = o.runId ?? makeRunId()
    const runDir = path.resolve(this.config.rootDir, o.out ?? path.join(this.config.outDir, runId))
    const started = performance.now()
    const baseline = await resolveInput(baselineInput, { capture: (url) => this.#capture({ url }, this.#captureOptions(o.viewport, o.capture)) })
    // A URL candidate is captured like the baseline was, unless told otherwise.
    const inherited = !o.viewport && baseline.meta?.viewport ? { ...baseline.meta.viewport, name: baseline.meta.viewportName ?? 'baseline' } : o.viewport
    const candidateCapture: CaptureOptions = { ...(baseline.meta ? { fullPage: baseline.meta.fullPage } : {}), ...o.capture }
    const candidate = await resolveInput(candidateInput, { capture: (url) => this.#capture({ url }, this.#captureOptions(inherited, candidateCapture)) })
    const name = o.name ?? deriveName(candidateInput)
    const pair = await this.#comparePair(
      runDir,
      { id: pairId(name), name, ...(inherited ? { viewport: inherited } : {}) },
      baseline,
      candidate,
      { ...this.config.compare, ...o.compare },
      { threshold: o.threshold ?? this.config.threshold, failOn: o.failOn ?? this.config.failOn, ignore: this.config.ignore },
      started,
      o.images ?? this.config.report.images,
    )
    return this.#finish([pair], runDir, runId, { command: 'compare', ...(o.junit !== undefined ? { junit: o.junit } : {}), ...(o.failOn !== undefined ? { failOn: o.failOn } : {}) })
  }

  async run(o: RunCallOptions = {}): Promise<RunResult> {
    const targets = resolveTargets(this.config, o.targets ?? [])
    if (!targets.length) throw new ElastishotError('E_USAGE', this.config.configPath ? `no targets in ${this.config.configPath}` : 'no config file found; create elastishot.config.js with targets')
    const runId = o.runId ?? makeRunId()
    const runDir = path.resolve(this.config.rootDir, o.out ?? path.join(this.config.outDir, runId))
    const pairs: PairReport[] = []
    for (const t of targets) pairs.push(await this.#runTarget(runDir, t, o))
    return this.#finish(pairs, runDir, runId, {
      command: 'run',
      update: o.update ?? false,
      force: o.force ?? false,
      ...(o.junit !== undefined ? { junit: o.junit } : {}),
      ...(o.failOn !== undefined ? { failOn: o.failOn } : {}),
    })
  }

  async #runTarget(runDir: string, t: ResolvedTarget, o: RunCallOptions): Promise<PairReport> {
    const started = performance.now()
    const dir = baselineDirFor(this.config.baselineDir, t.name, t.viewport.name)
    const id = pairId(t.name, t.viewport.name)
    const meta = { id, name: t.name, target: t.name, viewport: t.viewport }
    const captureOptions = this.#captureOptions(t.viewport, { ...t.capture, ...o.capture })
    let candidate: ResolvedSide
    try {
      const snapshot = await this.#capture({ url: t.url, name: t.name }, captureOptions)
      snapshot.meta.viewportName = t.viewport.name
      snapshot.meta.target = t.name
      candidate = await resolveInput(snapshot)
      candidate = { ...candidate, source: t.url }
    } catch (error) {
      const message = (error as Error).message
      const baselineSide = (await isSnapshotDir(dir)) ? await resolveInput(dir) : null
      return this.#errorPair(runDir, meta, baselineSide, null, message, started, t.url)
    }
    if (!(await isSnapshotDir(dir))) {
      if (o.update) await writeSnapshotDir(dir, candidate.snapshot!)
      return writePairArtifacts(
        runDir,
        { ...meta, baseline: { ...candidate, source: o.update ? dir : '(no baseline)' }, candidate, result: null, locators: null, status: 'new', failReasons: o.update ? [] : ['no baseline; run with --update to create one'], durationMs: performance.now() - started },
        { images: o.images ?? this.config.report.images },
      )
    }
    const baseline = await resolveInput(dir)
    // --update --force accepts this capture as the new baseline when it differs.
    const replace = o.update && o.force && candidate.snapshot
      ? async (status: PairStatus): Promise<string[]> => {
          if (status !== 'failed') return []
          await this.#promote(candidate.snapshot!, dir, runDir, t.name, t.viewport.name)
          return ['baseline replaced by this capture (--update --force)']
        }
      : undefined
    return this.#comparePair(runDir, meta, baseline, candidate, t.compare, { threshold: o.threshold ?? this.config.threshold, failOn: o.failOn ?? this.config.failOn, ignore: t.ignore }, started, o.images ?? this.config.report.images, replace)
  }

  /** Make a captured snapshot the baseline of a target and viewport, recording where it was approved from. */
  async #promote(snapshot: Snapshot, to: string, runDir: string, target: string, viewportName: string): Promise<void> {
    const meta = { ...snapshot.meta, approvedAt: new Date().toISOString(), approvedFrom: runDir, target, viewportName }
    await mkdir(to, { recursive: true })
    await writeSnapshotDir(to, { ...snapshot, meta }, BASELINE_FILES)
  }

  async #errorPair(runDir: string, meta: { id: string; name: string; target?: string; viewport?: ViewportConfig }, baseline: ResolvedSide | null, candidate: ResolvedSide | null, message: string, started: number, source: string): Promise<PairReport> {
    const placeholder: ResolvedSide = { kind: 'image', source, image: { width: 1, height: 1, data: new Uint8ClampedArray(4) }, elementMap: null }
    const pair = await writePairArtifacts(
      runDir,
      { ...meta, baseline: baseline ?? placeholder, candidate: candidate ?? placeholder, result: null, locators: null, status: 'error', failReasons: [], error: message, durationMs: performance.now() - started },
      { images: 'inline' },
    )
    if (!baseline) delete pair.baseline.image
    if (!candidate) delete pair.candidate.image
    for (const p of this.#plugins) await p.onCompared?.({ pair, result: null, locators: null })
    return pair
  }

  async #comparePair(
    runDir: string,
    meta: { id: string; name: string; target?: string; viewport?: ViewportConfig },
    baseline: ResolvedSide,
    candidate: ResolvedSide,
    compareOptions: CompareOptions,
    rules: { threshold: number; failOn: RegionKind[] | 'none'; ignore?: string[] },
    started: number,
    images: 'files' | 'inline',
    /** Runs once the verdict is known, before the pair is written; its lines join failReasons. */
    afterVerdict?: (status: PairStatus) => Promise<string[]>,
  ): Promise<PairReport> {
    let status: PairStatus
    let outcome: Awaited<ReturnType<typeof comparePair>> | null = null
    let error: string | undefined
    try {
      outcome = await comparePair(baseline, candidate, {
        ...(this.#engine ? { engine: this.#engine } : {}),
        compare: { ...compareOptions, artifacts: { diffMask: true, overlay: true, warpedCandidate: true, candidateOverlay: false, ...compareOptions.artifacts } },
        locators: this.config.locators,
        threshold: rules.threshold,
        failOn: rules.failOn,
        minRegionScore: this.config.minRegionScore,
        ...(rules.ignore?.length ? { ignore: rules.ignore } : {}),
      })
      status = outcome.pass ? 'passed' : 'failed'
    } catch (e) {
      status = 'error'
      error = (e as Error).message
    }
    const extraReasons = afterVerdict && status !== 'error' ? await afterVerdict(status) : []
    const pair = await writePairArtifacts(
      runDir,
      {
        ...meta,
        baseline,
        candidate,
        result: outcome?.result ?? null,
        locators: outcome?.locators ?? null,
        ...(outcome?.ignored.length ? { ignored: outcome.ignored } : {}),
        status,
        failReasons: [...(outcome?.failReasons ?? []), ...extraReasons],
        ...(error ? { error } : {}),
        durationMs: performance.now() - started,
      },
      { images },
    )
    for (const p of this.#plugins) await p.onCompared?.({ pair, result: outcome?.result ?? null, locators: outcome?.locators ?? null })
    return pair
  }

  async #finish(pairs: PairReport[], runDir: string, runId: string, o: FinishOptions): Promise<RunResult> {
    const report = buildReport(pairs, {
      runId,
      elastishotVersion: ELASTISHOT_VERSION,
      config: { threshold: this.config.threshold, failOn: o.failOn ?? this.config.failOn, command: o.command, baselineDir: this.config.baselineDir },
    })
    await mkdir(runDir, { recursive: true })
    const reporters: Reporter[] = [jsonReporter(), htmlReporter({ title: this.config.report.title })]
    const wantJunit = o.junit ?? this.config.report.junit
    if (wantJunit) reporters.push(junitReporter(typeof wantJunit === 'string' ? wantJunit : 'junit.xml'))
    reporters.push(...this.#reporters)
    const outputs: ReporterOutput[] = []
    for (const r of reporters) outputs.push(...((await r.report(report, { runDir })) ?? []))
    // `latest` follows the newest run of any kind so its report is one path
    // away; approve checks which command made it before promoting from it.
    await writeLatest(this.config.outDir, runDir)
    for (const p of this.#plugins) await p.onReported?.({ report, outputs })
    const update = o.update ?? false
    // Failed pairs of a run --update --force had their baselines replaced on purpose.
    const failed = report.totals.failed && !(update && o.force)
    const exitCode: 0 | 1 | 2 = report.totals.errors ? 2 : failed || (report.totals.new && !update) ? 1 : 0
    return { report, runDir, outputs, exitCode }
  }

  async approve(o: ApproveCallOptions = {}): Promise<ApproveResult> {
    const notes: string[] = []
    let runDir: string
    let report: ReportJson
    if (o.runDir) {
      runDir = path.resolve(this.config.rootDir, o.runDir)
      report = await readRunReport(runDir)
      if (report.config.command && report.config.command !== 'run') throw new ElastishotError('E_USAGE', `${runDir} was made by ${report.config.command}; only pairs made by run can be approved`)
    } else {
      let found: { runDir: string; report: ReportJson }
      try {
        found = await this.#latestApprovableRun(notes)
      } catch (error) {
        // Without a target or --all the usage is the first thing to fix.
        if (!o.target && !o.all) throw new ElastishotError('E_USAGE', `approve needs a target or --all; ${(error as Error).message}`)
        throw error
      }
      runDir = found.runDir
      report = found.report
    }
    if (report.config.baselineDir && path.resolve(report.config.baselineDir) !== this.config.baselineDir) {
      notes.push(`that run compared against baselines in ${report.config.baselineDir}; approving into ${this.config.baselineDir}`)
    }
    const promotable = report.pairs.filter((p) => p.target && p.viewport?.name && p.status !== 'error')
    const candidates = promotable.map((p) => `${p.target}/${p.viewport!.name}`)
    let chosen: PairReport[]
    if (o.target) {
      chosen = promotable.filter((p) => p.target === o.target || `${p.target}/${p.viewport!.name}` === o.target)
      if (!chosen.length) throw new ElastishotError('E_USAGE', `nothing to approve for "${o.target}" in ${runDir} (candidates: ${candidates.join(', ') || 'none'})`)
    } else if (o.all) {
      chosen = promotable.filter((p) => p.status === 'failed' || p.status === 'new')
    } else {
      throw new ElastishotError('E_USAGE', `approve needs a target or --all; candidates in ${runDir}: ${candidates.join(', ') || 'none'}`)
    }
    const approved: string[] = []
    for (const p of chosen) {
      const target = p.target!
      const viewportName = p.viewport!.name!
      const from = path.join(runDir, 'pairs', p.id)
      if (!(await isSnapshotDir(from, CANDIDATE_FILES))) throw new ElastishotError('E_INPUT_NOT_FOUND', `${from} has no candidate.png to promote`)
      const snapshot = await readSnapshotDir(from, CANDIDATE_FILES)
      await this.#promote(snapshot, baselineDirFor(this.config.baselineDir, target, viewportName), runDir, target, viewportName)
      approved.push(`${target}/${viewportName}`)
    }
    return { approved, candidates, runDir, notes }
  }

  /**
   * The run approve works from by default: `latest`, unless another command
   * made it (an ad-hoc compare between run and approve, say); then the newest
   * run folder in outDir that `run` made, with a note saying so.
   */
  async #latestApprovableRun(notes: string[]): Promise<{ runDir: string; report: ReportJson }> {
    const latest = await readLatest(this.config.outDir)
    if (!latest) throw new ElastishotError('E_USAGE', 'no run to approve from; run a comparison first or pass a run folder')
    const report = await readRunReport(latest)
    if (!report.config.command || report.config.command === 'run') return { runDir: latest, report }
    let names: string[] = []
    try {
      names = (await readdir(this.config.outDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
    } catch {
      /* no outDir: nothing older to fall back to */
    }
    // Run ids are UTC timestamps, so the names sort in time order.
    for (const name of names.sort().reverse()) {
      const runDir = path.join(this.config.outDir, name)
      if (path.resolve(runDir) === path.resolve(latest)) continue
      const candidate = await readRunReport(runDir).catch(() => null)
      if (candidate?.config.command === 'run') {
        notes.push(`the latest run (${path.basename(latest)}) was made by ${report.config.command}; approving from ${name}, the latest run made by run`)
        return { runDir, report: candidate }
      }
    }
    throw new ElastishotError('E_USAGE', `the latest run (${latest}) was made by ${report.config.command}, and no run made by run is left in ${this.config.outDir}; pass the run folder to approve`)
  }
}

interface FinishOptions {
  command: 'compare' | 'run' | 'pr'
  junit?: boolean | string
  update?: boolean
  force?: boolean
  failOn?: RegionKind[] | 'none'
}

async function readRunReport(runDir: string): Promise<ReportJson> {
  let report: unknown
  try {
    report = JSON.parse(await readFile(path.join(runDir, 'report.json'), 'utf8'))
  } catch (cause) {
    throw new ElastishotError('E_INPUT_NOT_FOUND', `no report.json in ${runDir}`, { cause })
  }
  if (!isReportJson(report)) throw new ElastishotError('E_DECODE', `${runDir}/report.json is not an elastishot report`)
  return report
}
