import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'

import { isElastishotError } from '../core/errors.ts'
import { portAnswers } from './processes.ts'
import { startSide } from './serve.ts'

const servers = 'test/fixtures/servers'

test('a folder is served in-process, and stopping twice is harmless', async () => {
  const side = await startSide('head', path.resolve('test/fixtures/site'), { dir: '.' })
  assert.equal((await fetch(new URL('/v1/', side.origin))).status, 200)
  await side.stop()
  await side.stop()
})

test('a command server is ready on the port it was given, and its process tree goes with it', async () => {
  const side = await startSide('base', process.cwd(), { command: `node ${servers}/listen.mjs`, ready: { log: 'listening on' }, timeoutMs: 20_000 })
  const port = Number(new URL(side.origin).port)
  assert.equal(await (await fetch(side.origin)).text(), 'side base')
  await side.stop()
  assert.equal(await portAnswers(port), false)
})

test('a server the shell started as a child of its own is gone too once stop resolves', async () => {
  // A second command keeps the shell as the server's parent instead of
  // letting it hand over to node; the shell can then die before the server.
  const keepShell = process.platform === 'win32' ? ' & exit /b 0' : '; exit 0'
  const side = await startSide('head', process.cwd(), { command: `node ${servers}/listen.mjs${keepShell}`, ready: { log: 'listening on' }, timeoutMs: 20_000 })
  const port = Number(new URL(side.origin).port)
  assert.equal(await (await fetch(side.origin)).text(), 'side head')
  await side.stop()
  assert.equal(await portAnswers(port), false)
})

test('a command that exits early, or never answers on its port, fails with E_SERVE', async () => {
  await assert.rejects(
    startSide('head', process.cwd(), { command: `node ${servers}/exit.mjs`, timeoutMs: 20_000 }),
    (e: unknown) => isElastishotError(e, 'E_SERVE') && /exited before its server was ready/.test((e as Error).message) && /Cannot find module "vite"/.test((e as Error).message),
  )
  await assert.rejects(
    startSide('head', process.cwd(), { command: `node ${servers}/wrong-port.mjs`, timeoutMs: 3_000 }),
    (e: unknown) => isElastishotError(e, 'E_SERVE') && /Does the command listen on \{port\}/.test((e as Error).message),
  )
})
