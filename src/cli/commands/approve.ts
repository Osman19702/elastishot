import { stat } from 'node:fs/promises'
import path from 'node:path'

import { createElastishot } from '../../node/elastishot.ts'
import { UsageError, type ParsedArgs } from '../args.ts'
import type { CliIo } from '../main.ts'

/** A run folder holds a report.json; anything else is taken as a target name. */
async function isRunDir(p: string): Promise<boolean> {
  try {
    return (await stat(path.join(p, 'report.json'))).isFile()
  } catch {
    return false
  }
}

export async function approveCommand(args: ParsedArgs, io: CliIo): Promise<number> {
  const [what, extra] = args.positionals
  if (extra !== undefined) throw new UsageError('approve takes at most one argument: a target, target/viewport, or a run folder')
  const app = await createElastishot({ cwd: io.cwd, ...(args.config ? { configPath: args.config } : {}) })
  try {
    const runDir = what && (await isRunDir(path.resolve(io.cwd, what))) ? path.resolve(io.cwd, what) : undefined
    const target = what && !runDir ? what : undefined
    const result = await app.approve({ ...(runDir ? { runDir } : {}), ...(target ? { target } : {}), all: args.all })
    for (const note of result.notes) io.stderr(`elastishot: note: ${note}`)
    if (args.json) io.stdout(JSON.stringify(result))
    else io.stdout(result.approved.length ? `approved ${result.approved.join(', ')}` : 'nothing approved')
    return 0
  } finally {
    await app.close()
  }
}
