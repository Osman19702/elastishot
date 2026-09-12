import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** The version from package.json (dist/node and src/node sit at the same depth). */
export const ELASTISHOT_VERSION: string = (require('../../package.json') as { version: string }).version
