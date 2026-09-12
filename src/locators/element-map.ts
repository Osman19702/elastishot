import { ElastishotError } from '../core/errors.ts'
import type { Box, ElementMap, ElementMapEntry } from '../core/types.ts'

export const ELEMENT_MAP_SCHEMA = 'elastishot.element-map/1'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function isBoxLike(v: unknown): v is Box {
  return isRecord(v) && ['x', 'y', 'w', 'h'].every((k) => typeof v[k] === 'number' && Number.isFinite(v[k]))
}

export function isElementMapEntry(v: unknown): v is ElementMapEntry {
  return (
    isRecord(v) &&
    typeof v.locator === 'string' &&
    typeof v.name === 'string' &&
    typeof v.tag === 'string' &&
    typeof v.strategy === 'string' &&
    isBoxLike(v.box)
  )
}

export function isElementMap(v: unknown): v is ElementMap {
  return (
    isRecord(v) &&
    v.schema === ELEMENT_MAP_SCHEMA &&
    isRecord(v.image) &&
    typeof v.image.width === 'number' &&
    typeof v.image.height === 'number' &&
    Array.isArray(v.elements) &&
    v.elements.every(isElementMapEntry)
  )
}

/** Parse and validate an element map document. Throws ElastishotError E_DECODE. */
export function parseElementMap(json: string, where = 'element map'): ElementMap {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (cause) {
    throw new ElastishotError('E_DECODE', `${where} is not valid JSON`, { cause })
  }
  if (!isElementMap(value)) {
    throw new ElastishotError('E_DECODE', `${where} is not an ${ELEMENT_MAP_SCHEMA} document`)
  }
  return value
}

export function indexByLocator(map: ElementMap): Map<string, ElementMapEntry> {
  const index = new Map<string, ElementMapEntry>()
  for (const e of map.elements) if (!index.has(e.locator)) index.set(e.locator, e)
  return index
}
