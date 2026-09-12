import type { CaptureOptions } from '../../capture/index.ts'
import { createElastishot } from '../../node/elastishot.ts'
import { UsageError, type ParsedArgs } from '../args.ts'
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
  const app = await createElastishot({ cwd: io.cwd, ...(args.config ? { configPath: args.config } : {}) })
  try {
    const result = await app.compare(baseline, candidate, {
      ...(args.out ? { out: args.out } : {}),
      ...(args.name ? { name: args.name } : {}),
      ...(args.viewport ? { viewport: args.viewport } : {}),
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
