import { startStaticServer } from '../../test/support/static-server.js'
import { FIXTURE_SITE } from './cli.js'

/** The two-version fixture site on a random port: `${url}/v1/` and `${url}/v2/`. */
export async function startSite() {
  const server = await startStaticServer(FIXTURE_SITE)
  return { url: server.url, v1: `${server.url}/v1/`, v2: `${server.url}/v2/`, close: () => server.close() }
}
