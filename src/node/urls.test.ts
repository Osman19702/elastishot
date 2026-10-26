import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isElastishotError } from '../core/errors.ts'
import { hasScheme, isHttpUrl, resolveTargetUrl, sharedOrigin, withOrigin } from './urls.ts'

test('relative target URLs resolve like links; absolute ones stay', () => {
  assert.equal(resolveTargetUrl('/pricing', 'https://a.test/', 'p'), 'https://a.test/pricing')
  assert.equal(resolveTargetUrl('pricing', 'https://a.test/docs/', 'p'), 'https://a.test/docs/pricing')
  assert.equal(resolveTargetUrl('/pricing', 'https://a.test/docs/', 'p'), 'https://a.test/pricing')
  assert.equal(resolveTargetUrl('https://b.test/x', 'https://a.test/', 'p'), 'https://b.test/x')
  assert.throws(() => resolveTargetUrl('/pricing', undefined, 'pricing'), (e: unknown) => isElastishotError(e, 'E_CONFIG') && /target "pricing": the relative url "\/pricing" needs baseUrl/.test((e as Error).message))
})

test('origins: moved with path and query kept, shared only when every URL agrees', () => {
  assert.equal(withOrigin('https://a.test/docs/x?q=1#h', 'http://127.0.0.1:4173'), 'http://127.0.0.1:4173/docs/x?q=1#h')
  assert.equal(sharedOrigin(['https://a.test/', 'https://a.test/x']), 'https://a.test')
  assert.equal(sharedOrigin(['https://a.test/', 'https://b.test/']), null)
  assert.equal(sharedOrigin(['https://a.test/', '/x']), null)
  assert.equal(sharedOrigin([]), null)
  assert.ok(isHttpUrl('HTTPS://a.test') && !isHttpUrl('/x'))
  assert.ok(hasScheme('ftp://x') && hasScheme('file:///x') && !hasScheme('/x') && !hasScheme('pricing'))
})
