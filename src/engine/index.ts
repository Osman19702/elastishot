/**
 * Elastishot engine: the opencv.js comparison pipeline.
 *
 *   preprocess -> globalAlign -> structuralAlign -> diff -> classify -> verdict
 *
 * Every stage can be replaced through createEngine({ stages }) or a plugin;
 * opencv.js is loaded lazily and can be injected for the browser.
 */
import type { Engine, EngineLoadOptions } from '../core/engine-seam.ts'
import { ElastishotError } from '../core/errors.ts'
import { resolveCompareOptions, type ResolvedCompareOptions } from '../core/options.ts'
import type { CompareOptions, CompareResult, DiffRegion, RasterImage, Warning, WarningCode } from '../core/types.ts'
import type { CV } from './cv/cv-types.ts'
import { loadOpenCV, type CvSource } from './cv/loader.ts'
import { MatScope } from './cv/mat-scope.ts'
import type { EnginePlugin, PipelineStages, Stage, StageContext, StageName } from './stage.ts'
import { classifyStage } from './stages/classify.ts'
import { diffStage } from './stages/diff.ts'
import { globalAlignStage } from './stages/global-align.ts'
import { preprocessStage } from './stages/preprocess.ts'
import { structuralAlignStage } from './stages/structural-align.ts'
import { verdictStage } from './stages/verdict.ts'

export type { CV } from './cv/cv-types.ts'
export { loadOpenCV, resetOpenCV, type CvSource } from './cv/loader.ts'
export { MatScope, withMats } from './cv/mat-scope.ts'
export type { EnginePlugin, PipelineStages, Stage, StageContext, StageName } from './stage.ts'
export type * from './model.ts'

export interface EngineOptions extends EngineLoadOptions {
  stages?: Partial<PipelineStages>
  plugins?: EnginePlugin[]
}

export const defaultStages: PipelineStages = {
  preprocess: preprocessStage,
  globalAlign: globalAlignStage,
  structuralAlign: structuralAlignStage,
  diff: diffStage,
  classify: classifyStage,
  verdict: verdictStage,
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function createContext(cv: CV, options: ResolvedCompareOptions, mats: MatScope, regionFilters: Array<(r: DiffRegion) => boolean>): StageContext {
  const warnings: Warning[] = []
  const timings: Record<string, number> = {}
  return {
    cv,
    options,
    mats,
    warnings,
    timings,
    regionFilters,
    warn(code: WarningCode, message: string, data?: Record<string, unknown>) {
      if (warnings.some((w) => w.code === code && w.message === message)) return
      warnings.push(data ? { code, message, data } : { code, message })
    },
    time<T>(label: string, fn: () => T): T {
      const t = now()
      try {
        return fn()
      } finally {
        timings[label] = (timings[label] ?? 0) + (now() - t)
      }
    },
    checkAborted() {
      if (options.signal?.aborted) throw new ElastishotError('E_ABORTED', 'compare aborted by the caller')
    },
  }
}

export function createEngine(options: EngineOptions = {}): Engine {
  const plugins = options.plugins ?? []
  const stages: PipelineStages = { ...defaultStages }
  for (const p of plugins) Object.assign(stages, p.stages ?? {})
  Object.assign(stages, options.stages ?? {})
  const regionFilters = plugins.flatMap((p) => (p.regionFilter ? [p.regionFilter] : []))
  let cvPromise: Promise<CV> | null = null
  const getCv = (): Promise<CV> => (cvPromise ??= loadOpenCV(options.cv as CvSource | undefined))

  async function runStage<I, O>(name: StageName, stage: Stage<I, O>, input: I, ctx: StageContext): Promise<O> {
    const t = now()
    let output: O
    try {
      output = await stage.run(input, ctx)
    } catch (cause) {
      if (cause instanceof ElastishotError) throw cause
      throw new ElastishotError('E_STAGE', `${name} failed: ${(cause as Error).message ?? String(cause)}`, { cause, stage: name })
    }
    ctx.timings[name] = now() - t
    for (const p of plugins) p.afterStage?.(name, output, ctx)
    ctx.checkAborted()
    return output
  }

  return {
    async warmup() {
      await getCv()
    },
    dispose() {
      cvPromise = null
    },
    async compare(baseline: RasterImage, candidate: RasterImage, callOptions?: CompareOptions): Promise<CompareResult> {
      const resolved = resolveCompareOptions(options.defaults, callOptions)
      const cv = await getCv()
      const mats = new MatScope(cv)
      const context: StageContext = createContext(
        cv,
        resolved,
        mats,
        regionFilters.map((f) => (r: DiffRegion) => f(r, context)),
      )
      try {
        context.checkAborted()
        const pre = await runStage('preprocess', stages.preprocess, { baseline, candidate }, context)
        const aligned = await runStage('globalAlign', stages.globalAlign, pre, context)
        const structured = await runStage('structuralAlign', stages.structuralAlign, aligned, context)
        const diffed = await runStage('diff', stages.diff, structured, context)
        const classified = await runStage('classify', stages.classify, diffed, context)
        return await runStage('verdict', stages.verdict, classified, context)
      } finally {
        mats.dispose()
      }
    },
  }
}
