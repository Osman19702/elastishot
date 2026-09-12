/**
 * The Node façade: snapshot, compare, run and approve with files, folders,
 * Playwright captures, reporters and plugin hooks wired together. The CLI is
 * a thin layer over this; a larger tool can drive it directly.
 */
import { cp, mkdir, readFile } from 'node:fs/promises'
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

export interface Elastishot {
  readonly config: ResolvedConfig
  use(plugin: Plugin): Elastishot
  snapshot(target: string | CaptureTarget, options?: SnapshotCallOptions): Promise<{ snapshot: Snapshot; dir: string }>
  compare(baseline: SideInput, candidate: SideInput, options?: CompareCallOptions): Promise<RunResult>
  run(options?: RunCallOptions): Promise<RunResult>
  approve(options?: ApproveCallOptions): Promise<{ approved: string[]; candidates: string[] }>
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
    return {
      ...this.config.capture,
      ...(viewport ? { viewport: { width: viewport.width, height: viewport.height }, ...(viewport.deviceScaleFactor ? { deviceScaleFactor: viewport.deviceScaleFactor } : {}) } : {}),
      ...extra,
    }
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
      { threshold: o.threshold ?? this.config.threshold, failOn: o.failOn ?? this.config.failOn },
      started,
      o.images ?? this.config.report.images,
    )
    return this.#finish([pair], runDir, runId, o.junit, false, o.failOn)
  }

  async run(o: RunCallOptions = {}): Promise<RunResult> {
    const targets = resolveTargets(this.config, o.targets ?? [])
    if (!targets.length) throw new ElastishotError('E_USAGE', this.config.configPath ? `no targets in ${this.config.configPath}` : 'no config file found; create elastishot.config.js with targets')
    const runId = o.runId ?? makeRunId()
    const runDir = path.resolve(this.config.rootDir, o.out ?? path.join(this.config.outDir, runId))
    const pairs: PairReport[] = []
    for (const t of targets) pairs.push(await this.#runTarget(runDir, t, o))
    return this.#finish(pairs, runDir, runId, o.junit, o.update ?? false)
  }

  async #runTarget(runDir: string, t: ResolvedTarget, o: RunCallOptions): Promise<PairReport> {
    const started = performance.now()
    const dir = baselineDirFor(this.config.baselineDir, t.name, t.viewport.name)
    const id = pairId(t.name, t.viewport.name)
    const meta = { id, name: t.name, target: t.name, viewport: t.viewport }
    const captureOptions = this.#captureOptions(t.viewport, t.capture)
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
    return this.#comparePair(runDir, meta, baseline, candidate, t.compare, { threshold: this.config.threshold, failOn: this.config.failOn }, started, o.images ?? this.config.report.images)
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
    thresholds: { threshold: number; failOn: RegionKind[] | 'none' },
    started: number,
    images: 'files' | 'inline',
  ): Promise<PairReport> {
    let status: PairStatus
    let outcome: Awaited<ReturnType<typeof comparePair>> | null = null
    let error: string | undefined
    try {
      outcome = await comparePair(baseline, candidate, {
        ...(this.#engine ? { engine: this.#engine } : {}),
        compare: { ...compareOptions, artifacts: { diffMask: true, overlay: true, warpedCandidate: true, candidateOverlay: false, ...compareOptions.artifacts } },
        locators: this.config.locators,
        threshold: thresholds.threshold,
        failOn: thresholds.failOn,
        minRegionScore: this.config.minRegionScore,
      })
      status = outcome.pass ? 'passed' : 'failed'
    } catch (e) {
      status = 'error'
      error = (e as Error).message
    }
    const pair = await writePairArtifacts(
      runDir,
      {
        ...meta,
        baseline,
        candidate,
        result: outcome?.result ?? null,
        locators: outcome?.locators ?? null,
        status,
        failReasons: outcome?.failReasons ?? [],
        ...(error ? { error } : {}),
        durationMs: performance.now() - started,
      },
      { images },
    )
    for (const p of this.#plugins) await p.onCompared?.({ pair, result: outcome?.result ?? null, locators: outcome?.locators ?? null })
    return pair
  }

  async #finish(pairs: PairReport[], runDir: string, runId: string, junit: boolean | string | undefined, update: boolean, failOn?: RegionKind[] | 'none'): Promise<RunResult> {
    const report = buildReport(pairs, {
      runId,
      elastishotVersion: ELASTISHOT_VERSION,
      config: { threshold: this.config.threshold, failOn: failOn ?? this.config.failOn },
    })
    await mkdir(runDir, { recursive: true })
    const reporters: Reporter[] = [jsonReporter(), htmlReporter({ title: this.config.report.title })]
    const wantJunit = junit ?? this.config.report.junit
    if (wantJunit) reporters.push(junitReporter(typeof wantJunit === 'string' ? wantJunit : 'junit.xml'))
    reporters.push(...this.#reporters)
    const outputs: ReporterOutput[] = []
    for (const r of reporters) outputs.push(...((await r.report(report, { runDir })) ?? []))
    await writeLatest(this.config.outDir, runDir)
    for (const p of this.#plugins) await p.onReported?.({ report, outputs })
    const exitCode: 0 | 1 | 2 = report.totals.errors ? 2 : report.totals.failed || (report.totals.new && !update) ? 1 : 0
    return { report, runDir, outputs, exitCode }
  }

  async approve(o: ApproveCallOptions = {}): Promise<{ approved: string[]; candidates: string[] }> {
    const runDir = o.runDir ? path.resolve(this.config.rootDir, o.runDir) : await readLatest(this.config.outDir)
    if (!runDir) throw new ElastishotError('E_USAGE', 'no run to approve from; run a comparison first or pass a run folder')
    let report: unknown
    try {
      report = JSON.parse(await readFile(path.join(runDir, 'report.json'), 'utf8'))
    } catch (cause) {
      throw new ElastishotError('E_INPUT_NOT_FOUND', `no report.json in ${runDir}`, { cause })
    }
    if (!isReportJson(report)) throw new ElastishotError('E_DECODE', `${runDir}/report.json is not an elastishot report`)
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
      snapshot.meta = { ...snapshot.meta, approvedAt: new Date().toISOString(), approvedFrom: runDir, target, viewportName }
      const to = baselineDirFor(this.config.baselineDir, target, viewportName)
      await mkdir(to, { recursive: true })
      await writeSnapshotDir(to, snapshot, BASELINE_FILES)
      await cp(path.join(from, CANDIDATE_FILES.image), path.join(to, BASELINE_FILES.image))
      approved.push(`${target}/${viewportName}`)
    }
    return { approved, candidates }
  }
}
