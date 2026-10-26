import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { isElastishotError } from '../core/errors.ts'
import { addWorktree, chooseBase, gitIn, headState, removeWorktree, type GitRunner } from './git.ts'

/** A git that answers from a table; anything else fails like an unknown ref. */
function fakeGit(answers: Record<string, string>): GitRunner {
  return async (args) => {
    const key = args.join(' ')
    if (key in answers) return answers[key]!
    throw new Error(`unknown: ${key}`)
  }
}

const verify = (ref: string, sha: string) => ({ [`rev-parse --verify --quiet ${ref}^{commit}`]: sha })

test('--base wins, and must be a commit', async () => {
  const git = fakeGit({ ...verify('v1.2.0', 'aaa111') })
  assert.deepEqual(await chooseBase(git, { base: 'v1.2.0' }), { ref: 'v1.2.0', sha: 'aaa111', rule: 'given with --base' })
  await assert.rejects(chooseBase(git, { base: 'nope' }), (e: unknown) => isElastishotError(e, 'E_GIT') && /--base nope is not a commit/.test((e as Error).message))
})

test('in a pull request job the base side of the merge commit is the base', async () => {
  const env = { GITHUB_BASE_REF: 'main' }
  const merge = fakeGit({ 'rev-list --parents -n 1 HEAD': 'mmm basesha headsha', ...verify('basesha', 'basesha') })
  assert.deepEqual(await chooseBase(merge, { env }), { ref: 'origin/main', sha: 'basesha', rule: 'the base side of the pull request merge commit' })
  const shallow = fakeGit({ 'rev-list --parents -n 1 HEAD': 'mmm basesha headsha' })
  await assert.rejects(chooseBase(shallow, { env }), (e: unknown) => isElastishotError(e, 'E_GIT') && /fetch-depth: 2/.test((e as Error).message))
  const branch = fakeGit({ 'rev-list --parents -n 1 HEAD': 'hhh ppp', ...verify('origin/main', 'tip'), 'merge-base HEAD origin/main': 'forkpoint' })
  assert.deepEqual(await chooseBase(branch, { env }), { ref: 'origin/main', sha: 'forkpoint', rule: 'where this branch left origin/main' })
})

test('locally the base is where the branch left the default branch', async () => {
  const remote = fakeGit({ ...verify('origin/HEAD', 'tip'), 'merge-base HEAD origin/HEAD': 'fork', 'rev-parse --abbrev-ref origin/HEAD': 'origin/master' })
  assert.deepEqual(await chooseBase(remote, { env: {} }), { ref: 'origin/master', sha: 'fork', rule: 'where this branch left origin/master' })
  const local = fakeGit({ ...verify('main', 'tip'), 'merge-base HEAD main': 'fork' })
  assert.deepEqual(await chooseBase(local, { env: {} }), { ref: 'main', sha: 'fork', rule: 'where this branch left main' })
  await assert.rejects(chooseBase(fakeGit({}), { env: {} }), (e: unknown) => isElastishotError(e, 'E_GIT') && /pass --base/.test((e as Error).message))
})

let repo = ''
before(async () => {
  repo = await mkdtemp(path.join(os.tmpdir(), 'elastishot-git-'))
  const run = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
  run('init', '-q', '-b', 'main')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'test')
  await writeFile(path.join(repo, 'a.txt'), 'one\n')
  run('add', '-A')
  run('commit', '-q', '-m', 'one')
})
after(() => rm(repo, { recursive: true, force: true }))

test('a worktree of the base comes and goes, and a changed file makes the tree dirty', async () => {
  const git = gitIn(repo)
  const base = await chooseBase(git, { env: {} })
  assert.equal(base.ref, 'main')
  assert.equal((await headState(git)).dirty, false)
  await writeFile(path.join(repo, 'a.txt'), 'two\n')
  assert.equal((await headState(git)).dirty, true)
  const dir = path.join(repo, '..', `${path.basename(repo)}-wt`)
  await addWorktree(git, dir, base.sha)
  await access(path.join(dir, 'a.txt'))
  assert.match(await git(['worktree', 'list']), /-wt/)
  await removeWorktree(git, dir)
  assert.doesNotMatch(await git(['worktree', 'list']), /-wt/)
  await assert.rejects(access(dir))
})
