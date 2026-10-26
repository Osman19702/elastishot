import type { CaptureOptions } from '../../capture/index.ts'
import { createElastishot } from '../../node/elastishot.ts'
import { resolveViewportArg, UsageError, type ParsedArgs } from '../args.ts'
import { printReport, type CliIo } from '../main.ts'

export function captureOptionsFromArgs(args: ParsedArgs): CaptureOptions {
  return {
    ...(args.fullPage !== undefined ? { fullPage: args.fullPage } : {}),
    ...(args.waitFor !== undefined ? { waitFor: args.waitFor } : {}),
    ...(args.hide.length ? { hide: args.hide } : {}),
    ...(args.noMap ? { elementMap: false as const } : {}),
  }
}

export async function compareCommand(args: ParsedArgs, io: CliIo): Promise<number> {
  const [baseline, candidate, extra] = args.positionals
  if (!baseline || !candidate || extra !== undefined) throw new UsageError('compare needs exactly two sides: <baseline> <candidate>')
  // --no-config: the defaults, so an ad-hoc compare inside a project neither
  // picks up its thresholds nor fires its reporters.
  const app = await createElastishot({ cwd: io.cwd, ...(args.noConfig ? { config: {} } : args.config ? { configPath: args.config } : {}) })
  try {
    const viewport = resolveViewportArg(args, app.config.viewports)
    const result = await app.compare(baseline, candidate, {
      ...(args.out ? { out: args.out } : {}),
      ...(args.name ? { name: args.name } : {}),
      ...(viewport ? { viewport } : {}),
      capture: captureOptionsFromArgs(args),
      ...(args.threshold !== undefined ? { threshold: args.threshold } : {}),
      ...(args.failOn !== undefined ? { failOn: args.failOn } : {}),
      ...(args.singleFile ? { images: 'inline' as const } : {}),
      ...(args.junitFile ? { junit: args.junitFile } : args.junit ? { junit: true } : {}),
    })
    printReport(result.report, result.runDir, args, io)
    return result.exitCode
  } finally {
    await app.close()
  }
}
