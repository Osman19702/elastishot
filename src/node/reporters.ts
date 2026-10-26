import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Reporter, ReporterOutput } from '../pipeline.ts'
import { renderJUnit } from '../report/junit.ts'
import { renderMarkdownSummary, type MarkdownOptions } from '../report/markdown.ts'
import { renderSummaryReport } from '../report/summary.ts'

/**
 * summary.md in the run folder, and the same table appended to the GitHub job
 * summary when the run is a GitHub Actions step ($GITHUB_STEP_SUMMARY).
 */
export function markdownReporter(options: MarkdownOptions = {}): Reporter {
  return {
    name: 'markdown',
    async report(report, ctx) {
      const markdown = renderMarkdownSummary(report, options)
      const outputs: ReporterOutput[] = []
      if (ctx.runDir) {
        await mkdir(ctx.runDir, { recursive: true })
        const file = path.join(ctx.runDir, 'summary.md')
        await writeFile(file, markdown)
        outputs.push({ name: 'markdown', path: file })
      }
      const summary = process.env.GITHUB_STEP_SUMMARY
      if (summary) {
        await appendFile(summary, `${markdown}\n`)
        outputs.push({ name: 'github-step-summary', path: summary })
      }
      return outputs
    },
  }
}

/** report.json in the run folder. */
export function jsonReporter(): Reporter {
  return {
    name: 'json',
    async report(report, ctx) {
      if (!ctx.runDir) return []
      await mkdir(ctx.runDir, { recursive: true })
      const file = path.join(ctx.runDir, 'report.json')
      await writeFile(file, `${JSON.stringify(report, null, 2)}\n`)
      return [{ name: 'json', path: file }]
    },
  }
}

/** index.html (the summary slide page); pair pages are written with the artifacts. */
export function htmlReporter(options: { title?: string } = {}): Reporter {
  return {
    name: 'html',
    async report(report, ctx) {
      if (!ctx.runDir) return []
      await mkdir(ctx.runDir, { recursive: true })
      const file = path.join(ctx.runDir, 'index.html')
      await writeFile(file, renderSummaryReport(report, options.title ? { title: options.title } : {}))
      return [{ name: 'html', path: file }]
    },
  }
}

export function junitReporter(fileName = 'junit.xml'): Reporter {
  return {
    name: 'junit',
    async report(report, ctx) {
      if (!ctx.runDir) return []
      await mkdir(ctx.runDir, { recursive: true })
      const file = path.isAbsolute(fileName) ? fileName : path.join(ctx.runDir, fileName)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, renderJUnit(report))
      return [{ name: 'junit', path: file }]
    },
  }
}
