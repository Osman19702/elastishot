import { createElastishot } from '../../node/elastishot.ts'
import type { ParsedArgs } from '../args.ts'
import { printReport, type CliIo } from '../main.ts'

export async function runCommand(args: ParsedArgs, io: CliIo): Promise<number> {
  const app = await createElastishot({ cwd: io.cwd, ...(args.config ? { configPath: args.config } : {}) })
  try {
    const result = await app.run({
      targets: args.positionals,
      update: args.update,
      ...(args.threshold !== undefined ? { threshold: args.threshold } : {}),
      ...(args.failOn !== undefined ? { failOn: args.failOn } : {}),
      ...(args.out ? { out: args.out } : {}),
      ...(args.singleFile ? { images: 'inline' as const } : {}),
      ...(args.junitFile ? { junit: args.junitFile } : args.junit ? { junit: true } : {}),
    })
    printReport(result.report, result.runDir, args, io)
    return result.exitCode
  } finally {
    await app.close()
  }
}
