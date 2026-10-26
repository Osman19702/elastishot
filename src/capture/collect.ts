/**
 * The in-page element collector. `collectMain` runs inside the browser via
 * page.evaluate, so it may only use what is passed to it and the helpers
 * inlined next to it by buildCollectScript.
 */
import { collapseWhitespace, escapeAttributeValue, implicitRole, isStableId } from './locator-strategy.ts'

export interface CollectOptions {
  /** Attributes that count as test ids, in priority order. */
  testAttributes: string[]
  maxElements: number
  /** Elements smaller than this in CSS pixels are skipped. */
  minSize: number
  includeText: boolean
  /** When false, elements outside the viewport are dropped and boxes are clipped. */
  fullPage: boolean
  viewportWidth: number
  viewportHeight: number
  dpr: number
}

export interface CollectedElement {
  locator: string
  strategy: 'testid' | 'id' | 'role' | 'css'
  tag: string
  name: string
  text?: string
  box: { x: number; y: number; w: number; h: number }
  parent: number | null
  fixed: boolean
}

export interface CollectResult {
  elements: CollectedElement[]
  truncated: boolean
}

function collectMain(opts: CollectOptions): CollectResult {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'BR', 'WBR'])
  const doc = document
  const all: Element[] = []
  // An aria-hidden or inert subtree that another layer covers, such as an
  // inactive tab scene mounted under the active one, is not what the
  // screenshot shows. One that is visible (a decorative icon) stays in.
  const covered = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    if (r.width === 0 || r.height === 0 || cx < 0 || cy < 0 || cx >= window.innerWidth || cy >= window.innerHeight) return false
    const top = doc.elementFromPoint(cx, cy)
    return top !== null && !el.contains(top) && !top.contains(el)
  }
  // An inline <svg> is one element (an icon, a logo); its paths are not.
  const walk = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toUpperCase()
      if (SKIP.has(tag)) continue
      if ((child.getAttribute('aria-hidden') === 'true' || child.hasAttribute('inert')) && covered(child)) continue
      all.push(child)
      if (tag !== 'SVG') walk(child)
    }
  }
  walk(doc.body)

  const ownText = (el: Element): string => {
    let t = ''
    for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) t += n.textContent ?? ''
    return collapseWhitespace(t)
  }
  const nameOf = (el: Element): string => {
    const aria = el.getAttribute('aria-label')
    if (aria) return collapseWhitespace(aria)
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const t = collapseWhitespace(
        by
          .split(/\s+/)
          .map((id) => doc.getElementById(id)?.textContent ?? '')
          .join(' '),
      )
      if (t) return t
    }
    for (const attr of ['alt', 'title', 'placeholder']) {
      const v = el.getAttribute(attr)
      if (v) return collapseWhitespace(v)
    }
    const t = collapseWhitespace(el.textContent ?? '')
    return t.length > 80 ? `${t.slice(0, 77)}...` : t
  }
  const roleOf = (el: Element): string | null =>
    el.getAttribute('role') || implicitRole(el.tagName.toLowerCase(), { type: el.getAttribute('type'), href: el.getAttribute('href') })
  const testIdOf = (el: Element): { attr: string; value: string } | null => {
    for (const attr of opts.testAttributes) {
      const v = el.getAttribute(attr)
      if (v) return { attr, value: v }
    }
    return null
  }

  // Pass 1: uniqueness counts.
  const testIdCount = new Map<string, number>()
  const idCount = new Map<string, number>()
  const roleNameCount = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  const meta = all.map((el) => {
    const tid = testIdOf(el)
    const id = el.getAttribute('id')
    const role = roleOf(el)
    const name = nameOf(el)
    if (tid) bump(testIdCount, `${tid.attr}=${tid.value}`)
    if (id) bump(idCount, id)
    if (role && name) bump(roleNameCount, `${role}|${name}`)
    return { tid, id, role, name }
  })

  const ancestorAnchor = (el: Element): { anchor: string; from: Element } | null => {
    let cur = el.parentElement
    while (cur && cur !== doc.body) {
      const tid = testIdOf(cur)
      if (tid && testIdCount.get(`${tid.attr}=${tid.value}`) === 1) return { anchor: `[${tid.attr}="${escapeAttributeValue(tid.value)}"]`, from: cur }
      const id = cur.getAttribute('id')
      if (id && isStableId(id) && idCount.get(id) === 1) return { anchor: `#${CSS.escape(id)}`, from: cur }
      cur = cur.parentElement
    }
    return null
  }
  const nthOfType = (el: Element): number => {
    let n = 1
    let sib = el.previousElementSibling
    while (sib) {
      if (sib.tagName === el.tagName) n++
      sib = sib.previousElementSibling
    }
    return n
  }
  const cssPath = (el: Element): string => {
    const found = ancestorAnchor(el)
    const segs: string[] = []
    let cur: Element | null = el
    const stop = found ? found.from : doc.body
    while (cur && cur !== stop) {
      segs.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${nthOfType(cur)})`)
      cur = cur.parentElement
    }
    return `${found ? found.anchor : 'body'} > ${segs.join(' > ')}`
  }

  // Pass 2: visibility, boxes, locators.
  const seenTestIds = new Map<string, number>()
  const included = new Map<Element, number>()
  const elements: CollectedElement[] = []
  const sx = window.scrollX
  const sy = window.scrollY
  let truncated = false
  for (let i = 0; i < all.length; i++) {
    if (elements.length >= opts.maxElements) {
      truncated = true
      break
    }
    const el = all[i]!
    const m = meta[i]!
    if (el.getClientRects().length === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < opts.minSize || rect.height < opts.minSize) continue
    let left = rect.left + sx
    let top = rect.top + sy
    let right = rect.right + sx
    let bottom = rect.bottom + sy
    if (!opts.fullPage) {
      left = Math.max(left, 0)
      top = Math.max(top, 0)
      right = Math.min(right, opts.viewportWidth)
      bottom = Math.min(bottom, opts.viewportHeight)
      if (right - left < opts.minSize || bottom - top < opts.minSize) continue
    }
    const x = Math.round(left * opts.dpr)
    const y = Math.round(top * opts.dpr)
    const box = { x, y, w: Math.round(right * opts.dpr) - x, h: Math.round(bottom * opts.dpr) - y }

    let locator: string
    let strategy: CollectedElement['strategy']
    if (m.tid) {
      const key = `${m.tid.attr}=${m.tid.value}`
      const nth = seenTestIds.get(key) ?? 0
      seenTestIds.set(key, nth + 1)
      locator = `[${m.tid.attr}="${escapeAttributeValue(m.tid.value)}"]${(testIdCount.get(key) ?? 1) > 1 ? ` >> nth=${nth}` : ''}`
      strategy = 'testid'
    } else if (m.id && isStableId(m.id) && idCount.get(m.id) === 1) {
      locator = `#${CSS.escape(m.id)}`
      strategy = 'id'
    } else if (m.role && m.name && roleNameCount.get(`${m.role}|${m.name}`) === 1) {
      locator = `role=${m.role}[name="${escapeAttributeValue(m.name)}"]`
      strategy = 'role'
    } else {
      locator = cssPath(el)
      strategy = 'css'
    }

    let parent: number | null = null
    let up = el.parentElement
    while (up) {
      const idx = included.get(up)
      if (idx !== undefined) {
        parent = idx
        break
      }
      up = up.parentElement
    }
    const tag = el.tagName.toLowerCase()
    const name = m.name || (m.id ? `${tag}#${m.id}` : tag)
    const entry: CollectedElement = {
      locator,
      strategy,
      tag,
      name: name.length > 120 ? `${name.slice(0, 117)}...` : name,
      box,
      parent,
      fixed: cs.position === 'fixed' || cs.position === 'sticky',
    }
    if (opts.includeText) {
      const text = ownText(el)
      if (text) entry.text = text.length > 200 ? `${text.slice(0, 197)}...` : text
    }
    included.set(el, elements.length)
    elements.push(entry)
  }
  return { elements, truncated }
}

/**
 * Clip element boxes (image pixels) at the right and bottom edges of the
 * captured image, dropping the ones left smaller than minPx. A page that
 * scrolls inside a fixed body is captured at viewport height while its
 * elements run further down. Parent links skip dropped elements. A map that
 * fits the image comes back unchanged.
 */
export function clipElements(elements: CollectedElement[], width: number, height: number, minPx: number): CollectedElement[] {
  const kept = new Map<number, number>()
  const out: CollectedElement[] = []
  elements.forEach((e, i) => {
    const w = Math.min(width, e.box.x + e.box.w) - e.box.x
    const h = Math.min(height, e.box.y + e.box.h) - e.box.y
    if (w < minPx || h < minPx) return
    // Parents come before their children, so a kept parent is already in `kept`.
    let parent = e.parent
    while (parent !== null && !kept.has(parent)) parent = elements[parent]?.parent ?? null
    const newParent = parent === null ? null : kept.get(parent)!
    kept.set(i, out.length)
    out.push(w === e.box.w && h === e.box.h && newParent === e.parent ? e : { ...e, box: { ...e.box, w, h }, parent: newParent })
  })
  return out
}

/** The script to pass to page.evaluate: helpers and the collector, inlined by source. */
export function buildCollectScript(opts: CollectOptions): string {
  const parts = [isStableId, implicitRole, escapeAttributeValue, collapseWhitespace, collectMain].map((fn) => fn.toString())
  return `(() => {\n${parts.join('\n')}\nreturn collectMain(${JSON.stringify(opts)});\n})()`
}
