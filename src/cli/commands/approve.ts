import { stat } from 'node:fs/promises'

import { createElastishot } from '../../node/elastishot.ts'
import { UsageError, type ParsedArgs } from '../args.ts'
import type { CliIo } from '../main.ts'

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

export async function approveCommand(args: ParsedArgs, io: CliIo): Promise<number> {
  const [what, extra] = args.positionals
  if (extra !== undefined) throw new UsageError('approve takes at most one argument: a target, target/viewport, or a run folder')
  const app = await createElastishot({ cwd: io.cwd, ...(args.config ? { configPath: args.config } : {}) })
  try {
    const runDir = what && (await isDir(what)) ? what : undefined
    const target = what && !runDir ? what : undefined
    const result = await app.approve({ ...(runDir ? { runDir } : {}), ...(target ? { target } : {}), all: args.all })
    if (args.json) io.stdout(JSON.stringify(result))
    else io.stdout(result.approved.length ? `approved ${result.approved.join(', ')}` : 'nothing approved')
    return 0
  } finally {
    await app.close()
  }
}
