/**
 * Load opencv.js once, in Node or in the browser.
 *
 * Emscripten MODULARIZE builds expose a `then` on the module object that
 * resolves with the module itself. Any promise that adopts such a value
 * (an `await`, or returning it from an async function or a then-callback)
 * loops for ever. So the raw module is always carried inside a box
 * ({ value }) across promise boundaries, its `then` is used exactly once to
 * wait for the runtime, and then removed.
 */
import { ElastishotError } from '../../core/errors.ts'
import type { CV } from './cv-types.ts'

export type CvSource = CV | object | string | (() => unknown)

type Loose = Record<string, unknown>
interface Boxed {
  value: unknown
}

const isObject = (v: unknown): v is Loose => typeof v === 'object' && v !== null
const isThenable = (v: unknown): boolean => isObject(v) && typeof v.then === 'function'
const looksLikeModule = (v: unknown): boolean =>
  isObject(v) && (typeof v.Mat === 'function' || 'HEAPU8' in v || 'onRuntimeInitialized' in v || 'calledRun' in v)

/** Wait for the runtime of a raw opencv.js module and hand back the namespace. */
function settle(candidate: unknown): Promise<CV> {
  return new Promise((resolve, reject) => {
    if (!isObject(candidate)) {
      reject(new ElastishotError('E_OPENCV_LOAD', 'opencv.js did not produce a module object'))
      return
    }
    const mod = candidate
    const ready = (value: unknown) => {
      const target = isObject(value) && typeof value.Mat === 'function' ? value : mod
      delete target.then
      if (typeof target.Mat !== 'function') {
        reject(new ElastishotError('E_OPENCV_LOAD', 'the loaded module does not look like opencv.js (no cv.Mat)'))
        return
      }
      resolve(target as unknown as CV)
    }
    if (typeof mod.Mat === 'function') {
      ready(mod)
      return
    }
    if (typeof mod.then === 'function') {
      ;(mod.then as (cb: (v: unknown) => void) => void)(ready)
      return
    }
    if (!looksLikeModule(mod)) {
      reject(new ElastishotError('E_OPENCV_LOAD', 'the provided object is not an opencv.js module'))
      return
    }
    const timer = setTimeout(() => reject(new ElastishotError('E_OPENCV_LOAD', 'opencv.js runtime did not initialise within 60 s')), 60_000)
    mod.onRuntimeInitialized = () => {
      clearTimeout(timer)
      ready(mod)
    }
  })
}

async function fromUrl(url: string): Promise<Boxed> {
  const g = globalThis as Loose
  if (typeof g.importScripts === 'function') {
    ;(g.importScripts as (u: string) => void)(url)
    return { value: g.cv }
  }
  if (typeof document !== 'undefined') {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = url
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error(`failed to load ${url}`))
      document.head.appendChild(script)
    })
    return { value: g.cv }
  }
  const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown }
  return { value: mod.default ?? mod }
}

async function fromPackage(): Promise<Boxed> {
  try {
    const mod = (await import('@techstark/opencv-js')) as { default?: unknown }
    return { value: mod.default ?? mod }
  } catch (cause) {
    throw new ElastishotError(
      'E_OPENCV_LOAD',
      'cannot import @techstark/opencv-js; in the browser pass a loaded cv object or a script URL via createEngine({ cv })',
      { cause },
    )
  }
}

async function produce(source: CvSource): Promise<Boxed> {
  if (typeof source === 'string') return fromUrl(source)
  if (typeof source === 'function') {
    const produced = (source as () => unknown)()
    // A real promise (for example another loadOpenCV() call) is awaited; a raw module is not.
    if (isThenable(produced) && !looksLikeModule(produced)) return { value: await (produced as Promise<unknown>) }
    return { value: produced }
  }
  return { value: source }
}

let shared: Promise<CV> | null = null

/**
 * Resolve an opencv.js namespace from: nothing (the bundled package, memoised),
 * an already loaded `cv` object, a script URL, or a function returning either.
 */
export function loadOpenCV(source?: CvSource): Promise<CV> {
  if (source === undefined) {
    shared ??= fromPackage().then((boxed) => settle(boxed.value))
    return shared
  }
  return produce(source)
    .then((boxed) => settle(boxed.value))
    .catch((cause: unknown) => {
      if (cause instanceof ElastishotError) throw cause
      throw new ElastishotError('E_OPENCV_LOAD', `opencv.js failed to load: ${(cause as Error).message}`, { cause })
    })
}

/** Forget the memoised default module (tests). */
export function resetOpenCV(): void {
  shared = null
}
