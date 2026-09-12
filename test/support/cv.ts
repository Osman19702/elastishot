import { createEngine } from '../../src/engine/index.ts'
import { loadOpenCV } from '../../src/engine/cv/loader.ts'

/** One opencv.js runtime per test process. */
export const cvReady = loadOpenCV()

/** One engine shared by a test file, warmed up in a before() hook. */
export const engine = createEngine({ cv: () => cvReady })
