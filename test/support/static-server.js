/**
 * The static file server the tests and the UI lab use; it ships in
 * src/node/static-server.ts, where `elastishot pr` serves built sites with it.
 *
 *   const server = await startStaticServer('test/fixtures/site')
 *   ... fetch(`${server.url}/v1/`) ...
 *   await server.close()
 */
export { startStaticServer } from '../../src/node/static-server.ts'
