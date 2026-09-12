import type { ResolvedCompareOptions } from '../core/options.ts'
import type { CompareResult, DiffRegion, Warning, WarningCode } from '../core/types.ts'
import type { CV } from './cv/cv-types.ts'
import type { MatScope } from './cv/mat-scope.ts'
import type {
  ClassifyOutput,
  DiffOutput,
  GlobalAlignOutput,
  PreprocessInput,
  PreprocessOutput,
  StructuralAlignOutput,
} from './model.ts'

export interface StageContext {
  cv: CV
  options: ResolvedCompareOptions
  /** Every Mat created for this compare; disposed when the compare ends. */
  mats: MatScope
  warn(code: WarningCode, message: string, data?: Record<string, unknown>): void
  warnings: Warning[]
  /** Time a step; the result lands in summary.timingsMs. */
  time<T>(label: string, fn: () => T): T
  timings: Record<string, number>
  /** Throws ElastishotError E_ABORTED when the caller's signal fired. */
  checkAborted(): void
  /** Plugin filters applied to regions (in original coordinates) before the verdict. */
  regionFilters: Array<(region: DiffRegion) => boolean>
}

export interface Stage<I, O> {
  readonly name: string
  run(input: I, ctx: StageContext): O | Promise<O>
}

export interface PipelineStages {
  preprocess: Stage<PreprocessInput, PreprocessOutput>
  globalAlign: Stage<PreprocessOutput, GlobalAlignOutput>
  structuralAlign: Stage<GlobalAlignOutput, StructuralAlignOutput>
  diff: Stage<StructuralAlignOutput, DiffOutput>
  classify: Stage<DiffOutput, ClassifyOutput>
  verdict: Stage<ClassifyOutput, CompareResult>
}

export type StageName = keyof PipelineStages

export interface EnginePlugin {
  name: string
  /** Replace whole stages. */
  stages?: Partial<PipelineStages>
  /** Observe (or mutate) a stage's output. */
  afterStage?(name: StageName, output: unknown, ctx: StageContext): void
  /** Return false to drop a region before the verdict. */
  regionFilter?(region: DiffRegion, ctx: StageContext): boolean
}
