/**
 * Run folders and baseline folders on disk.
 *
 *   <baselineDir>/<target>/<viewport>/baseline.png ...
 *   <outDir>/<runId>/report.json, index.html, junit.xml, pairs/<pairId>/...
 *   <outDir>/latest                      text file naming the newest run folder
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function makeRunId(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-')
}

export function slug(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return out.slice(0, 80) || 'pair'
}

export function pairId(target: string, viewport?: string): string {
  return viewport ? `${slug(target)}--${slug(viewport)}` : slug(target)
}

export function baselineDirFor(baselineDir: string, target: string, viewport: string): string {
  return path.join(baselineDir, slug(target), slug(viewport))
}

export function pairDirFor(runDir: string, id: string): string {
  return path.join(runDir, 'pairs', id)
}

export async function writeLatest(outDir: string, runDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'latest'), `${runDir}\n`)
}

export async function readLatest(outDir: string): Promise<string | null> {
  try {
    const text = (await readFile(path.join(outDir, 'latest'), 'utf8')).trim()
    return text || null
  } catch {
    return null
  }
}
