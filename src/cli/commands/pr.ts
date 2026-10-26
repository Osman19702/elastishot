import { createElastishot } from '../../node/elastishot.ts'
import type { ParsedArgs } from '../args.ts'
import { printReport, type CliIo } from '../main.ts'
import { captureOptionsFromArgs } from './compare.ts'

export async function prCommand(args: ParsedArgs, io: CliIo): Promise<number> {
  const app = await createElastishot({ cwd: io.cwd, ...(args.config ? { configPath: args.config } : {}) })
  // The first Ctrl-C stops the run and cleans up: servers, the worktree, the
  // temporary folder. A second one quits at once; child process trees still
  // go, the worktree is pruned by the next run.
  const controller = new AbortController()
  const onSignal = () => {
    if (controller.signal.aborted) process.exit(130)
    io.stderr('elastishot: stopping and cleaning up (press Ctrl-C again to quit now)')
    controller.abort()
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  try {
    const capture = captureOptionsFromArgs(args)
    const result = await app.pr({
      targets: args.positionals,
      ...(args.base ? { base: args.base } : {}),
      ...(args.keep ? { keep: true } : {}),
      ...(Object.keys(capture).length ? { capture } : {}),
      ...(args.threshold !== undefined ? { threshold: args.threshold } : {}),
      ...(args.failOn !== undefined ? { failOn: args.failOn } : {}),
      ...(args.out ? { out: args.out } : {}),
      ...(args.singleFile ? { images: 'inline' as const } : {}),
      ...(args.junitFile ? { junit: args.junitFile } : args.junit ? { junit: true } : {}),
      signal: controller.signal,
      // Progress goes to stderr, so stdout stays the summary (or the one JSON object).
      log: (line) => {
        if (!args.quiet && !args.json) io.stderr(line)
      },
    })
    printReport(result.report, result.runDir, args, io)
    return result.exitCode
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    await app.close()
  }
}
