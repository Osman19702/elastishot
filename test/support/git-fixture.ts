/**
 * A throwaway git repository for pr runs: the fixture site's page at version
 * 1 committed on main, version 2 in the working tree.
 */
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const SITE = path.resolve('test/fixtures/site')

/** A static server a pr config can start as its serve.command: files from its folder on $PORT. */
export const SERVE_SCRIPT = [
  "import fs from 'node:fs'",
  "import http from 'node:http'",
  "import path from 'node:path'",
  "const types = { '.html': 'text/html', '.css': 'text/css' }",
  'http',
  '  .createServer((req, res) => {',
  "    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)",
  "    if (p.endsWith('/')) p += 'index.html'",
  '    fs.readFile(path.join(process.cwd(), p), (error, body) => {',
  '      if (error) return res.writeHead(404).end()',
  "      res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }).end(body)",
  '    })',
  '  })',
  "  .listen(Number(process.env.PORT), '127.0.0.1', () => console.log('ready'))",
  '',
].join('\n')

export interface PrFixture {
  dir: string
  git(...args: string[]): string
  write(file: string, content: string): Promise<void>
  /** Copy a version of the fixture page into a folder of the working tree. */
  page(version: 'v1' | 'v2', folder: string): Promise<void>
  remove(): Promise<void>
}

export async function prFixture(config: object): Promise<PrFixture> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'elastishot-prfix-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  const write = (file: string, content: string) => writeFile(path.join(dir, file), content)
  const page = (version: 'v1' | 'v2', folder: string) => cp(path.join(SITE, version), path.join(dir, folder), { recursive: true, force: true })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  git('config', 'core.autocrlf', 'false')
  await cp(path.join(SITE, 'shared'), path.join(dir, 'shared'), { recursive: true })
  await page('v1', 'page')
  await write('elastishot.config.json', JSON.stringify(config, null, 2))
  await write('.gitignore', '.elastishot/\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'version 1')
  await page('v2', 'page')
  return { dir, git, write, page, remove: () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
}
