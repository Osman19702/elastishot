import { createElastishot } from '../../node/elastishot.ts'
import { UsageError, type ParsedArgs } from '../args.ts'
import type { CliIo } from '../main.ts'
import { captureOptionsFromArgs } from './compare.ts'

export async function snapshotCommand(args: ParsedArgs, io: CliIo): Promise<number> {
  const [url, extra] = args.positionals
  if (!url || extra !== undefined) throw new UsageError('snapshot needs exactly one page URL')
  if (!/^https?:\/\//i.test(url)) throw new UsageError(`snapshot needs an http(s) URL, got "${url}"`)
  const app = await createElastishot({ cwd: io.cwd, ...(args.config ? { configPath: args.config } : {}) })
  try {
    const { snapshot, dir } = await app.snapshot(url, {
      ...(args.out ? { out: args.out } : {}),
      ...(args.name ? { name: args.name } : {}),
      ...(args.viewport ? { viewport: args.viewport } : {}),
      capture: captureOptionsFromArgs(args),
    })
    const elements = snapshot.elementMap?.elements.length ?? 0
    if (args.json) io.stdout(JSON.stringify({ dir, meta: snapshot.meta, image: { width: snapshot.image.width, height: snapshot.image.height }, elements }))
    else io.stdout(`snapshot ${snapshot.image.width}x${snapshot.image.height}, ${elements} elements -> ${dir.replace(/\\/g, '/')}`)
    return 0
  } finally {
    await app.close()
  }
}
