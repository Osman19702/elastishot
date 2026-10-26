import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isElastishotError } from '../core/errors.ts'
import { resolveConfig, validateConfig, type ElastishotConfig } from './config.ts'
import { prTargets } from './pr.ts'

const config = (raw: ElastishotConfig) => resolveConfig(validateConfig(raw), '/project')
const urls = (raw: ElastishotConfig, origin = 'http://127.0.0.1:5001') => prTargets(config(raw), [], origin).map((t) => t.url)

test('baseUrl keeps its path on each side; relative and same-origin targets follow it', () => {
  const raw = { baseUrl: 'https://www.example.com/app/', targets: [{ name: 'home', url: './' },{ name: 'pricing', url: '/app/pricing' }, { name: 'abs', url: 'https://www.example.com/app/about' }] }
  assert.deepEqual(urls(raw), ['http://127.0.0.1:5001/app/', 'http://127.0.0.1:5001/app/pricing', 'http://127.0.0.1:5001/app/about'])
})

test('without baseUrl, the one origin the targets share is moved', () => {
  assert.deepEqual(urls({ targets: [{ name: 'a', url: 'http://127.0.0.1:4174/' }, { name: 'b', url: 'http://127.0.0.1:4174/#about' }] }), ['http://127.0.0.1:5001/', 'http://127.0.0.1:5001/#about'])
  assert.deepEqual(urls({ targets: [{ name: 'a', url: '/page/' }] }), ['http://127.0.0.1:5001/page/'])
})

test('a target on another origin is an error, with or without baseUrl', () => {
  const rejects = (raw: ElastishotConfig, re: RegExp) => assert.throws(() => urls(raw), (e: unknown) => isElastishotError(e, 'E_CONFIG') && re.test((e as Error).message))
  rejects({ targets: [{ name: 'a', url: 'https://a.test/' }, { name: 'b', url: 'https://b.test/' }] }, /every target on one origin/)
  rejects({ baseUrl: 'https://a.test/', targets: [{ name: 'b', url: 'https://b.test/' }] }, /target "b" is on https:\/\/b\.test, not https:\/\/a\.test/)
})
