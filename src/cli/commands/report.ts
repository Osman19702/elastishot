import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { ElastishotError } from '../../core/errors.ts'
import { createElastishot } from '../../node/elastishot.ts'
import { htmlReporter, jsonReporter, junitReporter } from '../../node/reporters.ts'
import { isReportJson } from '../../report/schema.ts'
import { UsageError, type ParsedArgs } from '../args.ts'
import { printReport, type CliIo } from '../main.ts'

/** Re-render index.html (and junit.xml) from an existing run folder's report.json. */
export async function reportCommand(args: ParsedArgs, io: CliIo): Promise<number> {
  const [dir, extra] = args.positionals
  if (!dir || extra !== undefined) throw new UsageError('report needs exactly one run folder')
  const runDir = path.resolve(io.cwd, dir)
  let report: unknown
  try {
    report = JSON.parse(await readFile(path.join(runDir, 'report.json'), 'utf8'))
  } catch (cause) {
    throw new ElastishotError('E_INPUT_NOT_FOUND', `no report.json in ${runDir}`, { cause })
  }
  if (!isReportJson(report)) throw new ElastishotError('E_DECODE', `${runDir}/report.json is not an elastishot report`)
  const app = await createElastishot({ cwd: io.cwd, ...(args.config ? { configPath: args.config } : {}) })
  const reporters = [jsonReporter(), htmlReporter({ title: app.config.report.title })]
  if (args.junit || args.junitFile || app.config.report.junit) reporters.push(junitReporter(args.junitFile ?? 'junit.xml'))
  for (const r of reporters) await r.report(report, { runDir })
  printReport(report, runDir, args, io)
  return report.totals.errors ? 2 : report.totals.failed || report.totals.new ? 1 : 0
}
