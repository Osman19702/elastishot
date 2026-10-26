/**
 * The git side of `pr`: which commit to compare against, and a worktree of
 * it to build and serve next to the working tree.
 */
import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'

import { ElastishotError } from '../core/errors.ts'

export type GitRunner = (args: string[]) => Promise<string>

/** git in a folder; a failure is E_GIT with git's own message. */
export function gitIn(cwd: string): GitRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile('git', args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
          reject(new ElastishotError('E_GIT', missing ? 'git is not installed or not on PATH' : `git ${args.join(' ')}: ${(stderr || error.message).trim()}`, { cause: error }))
        } else resolve(stdout.trim())
      })
    })
}

export interface BaseChoice {
  /** What to call it: origin/main, a tag, a sha. */
  ref: string
  sha: string
  /** Why this commit: shown in the output and kept in report.json. */
  rule: string
}

/**
 * The commit a pr run compares against:
 * - `--base` when given;
 * - in a GitHub pull request job, the base side of the merge commit the
 *   checkout made (HEAD^1), or failing that where HEAD left the base branch;
 * - elsewhere, where HEAD left the default branch (origin/HEAD, then main,
 *   then master), so a feature branch shows only its own changes.
 */
export async function chooseBase(git: GitRunner, o: { base?: string; env?: Record<string, string | undefined> } = {}): Promise<BaseChoice> {
  const verify = (ref: string) => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => '')
  if (o.base) {
    const sha = await verify(o.base)
    if (!sha) throw new ElastishotError('E_GIT', `--base ${o.base} is not a commit in this repository (fetch it first?)`)
    return { ref: o.base, sha, rule: 'given with --base' }
  }
  const prBase = o.env?.GITHUB_BASE_REF
  if (prBase) {
    const remote = `origin/${prBase}`
    const parents = (await git(['rev-list', '--parents', '-n', '1', 'HEAD'])).split(/\s+/)
    if (parents.length === 3) {
      const sha = parents[1]!
      // A shallow checkout names the parent without having it.
      if (!(await verify(sha))) throw new ElastishotError('E_GIT', `the base commit ${sha.slice(0, 7)} of this pull request is not fetched: check out with fetch-depth: 2, or run git fetch --depth=2 origin HEAD`)
      return { ref: remote, sha, rule: 'the base side of the pull request merge commit' }
    }
    if (await verify(remote)) return { ref: remote, sha: await git(['merge-base', 'HEAD', remote]), rule: `where this branch left ${remote}` }
    throw new ElastishotError('E_GIT', `GITHUB_BASE_REF is ${prBase}, but HEAD is not a merge commit and ${remote} is not fetched; check out with fetch-depth: 2, or pass --base`)
  }
  for (const ref of ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) {
    if (!(await verify(ref))) continue
    const sha = await git(['merge-base', 'HEAD', ref]).catch(() => '')
    if (!sha) continue
    const name = ref === 'origin/HEAD' ? await git(['rev-parse', '--abbrev-ref', 'origin/HEAD']).catch(() => ref) : ref
    return { ref: name, sha, rule: `where this branch left ${name}` }
  }
  throw new ElastishotError('E_GIT', 'no default branch to compare against (origin/HEAD, main, master); pass --base <ref>')
}

export async function headState(git: GitRunner): Promise<{ sha: string; dirty: boolean }> {
  const [sha, status] = await Promise.all([git(['rev-parse', 'HEAD']), git(['status', '--porcelain'])])
  return { sha, dirty: status.length > 0 }
}

export async function addWorktree(git: GitRunner, dir: string, sha: string): Promise<void> {
  // Long paths: a project's node_modules nests deeper than Windows' default limit.
  await git(['-c', 'core.longpaths=true', 'worktree', 'add', '--detach', dir, sha])
}

/** Remove a worktree; files a build or a server still holds on Windows get a few retries. */
export async function removeWorktree(git: GitRunner, dir: string): Promise<void> {
  await git(['worktree', 'remove', '--force', dir]).catch(() => undefined)
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  await git(['worktree', 'prune']).catch(() => undefined)
}
