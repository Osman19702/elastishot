/**
 * The elastishot command line. Returns the exit code; bin/elastishot.js
 * applies it. Human output goes to stdout, errors to stderr; --json prints one
 * JSON object and nothing else.
 */
import { ElastishotError } from '../core/errors.ts'
import type { PairReport, ReportJson } from '../report/schema.ts'
import { ELASTISHOT_VERSION } from '../node/version.ts'
import { parseCliArgs, USAGE, UsageError, type ParsedArgs } from './args.ts'
import { approveCommand } from './commands/approve.ts'
import { compareCommand } from './commands/compare.ts'
import { reportCommand } from './commands/report.ts'
import { runCommand } from './commands/run.ts'
import { snapshotCommand } from './commands/snapshot.ts'

export interface CliIo {
  stdout(line: string): void
  stderr(line: string): void
  cwd: string
}

export const defaultIo: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  cwd: process.cwd(),
}

const KIND_SIGN = { added: '+', removed: '-', changed: '~', moved: '>' } as const

/** One line per pair: FAIL home [desktop]  score 91.2%  +0 -2 ~1 >3  -> #faq, [data-testid="cta"] */
export function pairLine(p: PairReport): string {
  const status = p.status === 'passed' ? 'PASS' : p.status === 'failed' ? 'FAIL' : p.status === 'new' ? 'NEW ' : 'ERR '
  const vp = p.viewport ? ` [${p.viewport.name ?? `${p.viewport.width}x${p.viewport.height}`}]` : ''
  const score = p.summary ? `  score ${(p.summary.similarity * 100).toFixed(1)}%` : ''
  const counts = p.summary ? `  ${(Object.keys(KIND_SIGN) as Array<keyof typeof KIND_SIGN>).map((k) => `${KIND_SIGN[k]}${p.summary!.counts[k]}`).join(' ')}` : ''
  const top = p.locators?.changedLocators.filter((l) => l.evidence.includes('pixels')).slice(0, 3).map((l) => l.locator) ?? []
  const locators = top.length ? `  -> ${top.join(', ')}` : ''
  const error = p.error ? `  ${p.error}` : ''
  return `${status} ${p.name}${vp}${score}${counts}${locators}${error}`
}

export function printReport(report: ReportJson, runDir: string, args: ParsedArgs, io: CliIo): void {
  if (args.json) {
    io.stdout(JSON.stringify(report))
    return
  }
  if (!args.quiet) for (const p of report.pairs) io.stdout(pairLine(p))
  const t = report.totals
  io.stdout(`${t.pairs} pair${t.pairs === 1 ? '' : 's'}: ${t.passed} passed, ${t.failed} failed, ${t.new} new, ${t.errors} errors`)
  if (!args.quiet) io.stdout(`report: ${runDir.replace(/\\/g, '/')}/index.html`)
}

export async function main(argv: string[], io: CliIo = defaultIo): Promise<number> {
  let args: ParsedArgs
  try {
    args = parseCliArgs(argv)
  } catch (e) {
    io.stderr(`elastishot: ${(e as Error).message}`)
    io.stderr(USAGE)
    return 2
  }
  if (args.version) {
    io.stdout(ELASTISHOT_VERSION)
    return 0
  }
  if (args.help || !args.command) {
    io.stdout(USAGE)
    return args.help ? 0 : 2
  }
  try {
    switch (args.command) {
      case 'compare':
        return await compareCommand(args, io)
      case 'snapshot':
        return await snapshotCommand(args, io)
      case 'run':
        return await runCommand(args, io)
      case 'approve':
        return await approveCommand(args, io)
      case 'report':
        return await reportCommand(args, io)
    }
  } catch (e) {
    const error = e as Error
    const message = error instanceof ElastishotError ? `${error.message}${error.stage ? ` (stage ${error.stage})` : ''}` : error.message
    if (args.json) io.stdout(JSON.stringify({ error: message, code: (error as ElastishotError).code ?? 'E_UNKNOWN' }))
    io.stderr(`elastishot: ${message}`)
    if (e instanceof UsageError) io.stderr(USAGE)
    return 2
  }
}
