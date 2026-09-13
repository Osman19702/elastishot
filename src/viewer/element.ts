/**
 * <elastishot-viewer>: compare two images in place.
 *
 * Attributes: baseline-src, candidate-src, diff-src, warped-src, mode
 * (slider | flip | blink | overlay | diff), position (0-100),
 * opacity (0-1), flip-side (baseline | candidate), blink-ms, zoom (fit | number),
 * show-regions, no-toolbar. Properties: regions, locators, alignment.
 * A light-DOM <script type="application/json"> child may carry
 * { regions, locators, alignment }. Events: elastishot-ready,
 * elastishot-mode-change, elastishot-region-select.
 */
import type { AlignmentResult, Box, DiffRegion } from '../core/types.ts'
import type { LocatorReport, RegionLocators } from '../locators/index.ts'
import { VIEWER_CSS } from './styles.ts'
import { MODES, viewerTemplate, type ViewerMode } from './template.ts'
import { matrixToCss } from './transform.ts'

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const isMode = (v: string | null): v is ViewerMode => MODES.includes(v as ViewerMode)

export interface ViewerData {
  regions?: DiffRegion[]
  locators?: LocatorReport | null
  alignment?: AlignmentResult | null
}

export class ElastishotViewer extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['baseline-src', 'candidate-src', 'diff-src', 'warped-src', 'mode', 'position', 'opacity', 'flip-side', 'blink-ms', 'zoom', 'show-regions']
  }

  #regions: DiffRegion[] = []
  #locators: LocatorReport | null = null
  #alignment: AlignmentResult | null = null
  #selected: string | null = null
  #position = 50
  #scale = 1
  #blinkTimer: ReturnType<typeof setInterval> | null = null
  #blinkPaused = false
  #blinkOn = true
  #observer: ResizeObserver | null = null
  #baselineLoaded = false
  #candidateLoaded = false
  #objectUrls: string[] = []
  #initialized = false

  readonly #root: ShadowRoot
  readonly #viewport: HTMLElement
  readonly #stage: HTMLElement
  readonly #baselineLayer: HTMLElement
  readonly #candidateLayer: HTMLElement
  readonly #xform: HTMLElement
  readonly #baselineImg: HTMLImageElement
  readonly #candidateImg: HTMLImageElement
  readonly #tint: HTMLCanvasElement
  #diffUrl: string | null = null
  readonly #regionsEl: HTMLElement
  readonly #handleV: HTMLElement
  readonly #chip: HTMLElement
  readonly #opacityLabel: HTMLElement
  readonly #opacityInput: HTMLInputElement
  readonly #blinkLabel: HTMLElement
  readonly #pauseButton: HTMLButtonElement

  constructor() {
    super()
    this.#root = this.attachShadow({ mode: 'open' })
    this.#root.innerHTML = `<style>${VIEWER_CSS}</style>${viewerTemplate()}`
    const q = <T extends Element>(sel: string): T => this.#root.querySelector(sel) as T
    this.#viewport = q('.viewport')
    this.#stage = q('.stage')
    this.#baselineLayer = q('.layer.baseline')
    this.#candidateLayer = q('.layer.candidate')
    this.#xform = q('.xform')
    this.#baselineImg = q('.layer.baseline img')
    this.#candidateImg = q('.layer.candidate img')
    this.#tint = q('.diff-tint')
    this.#regionsEl = q('.regions')
    this.#handleV = q('.handle.v')
    this.#chip = q('.chip')
    this.#opacityLabel = q('label.opacity')
    this.#opacityInput = q('label.opacity input')
    this.#blinkLabel = q('label.blink')
    this.#pauseButton = q('button.pause')

    this.#baselineImg.addEventListener('load', () => {
      this.#baselineLoaded = true
      this.#layout()
      this.#maybeReady()
    })
    this.#candidateImg.addEventListener('load', () => {
      this.#candidateLoaded = true
      this.#layout()
      this.#maybeReady()
    })
    for (const b of this.#root.querySelectorAll<HTMLButtonElement>('.toolbar button[data-mode]')) {
      b.addEventListener('click', () => this.setMode(b.dataset.mode as ViewerMode))
    }
    this.#opacityInput.addEventListener('input', () => this.setAttribute('opacity', String(Number(this.#opacityInput.value) / 100)))
    this.#pauseButton.addEventListener('click', () => this.#setBlinkPaused(!this.#blinkPaused))
    this.#handleV.addEventListener('keydown', (e) => this.#handleKey(e))
    this.#handleV.addEventListener('pointerdown', (e) => this.#startDrag(e))
    this.#viewport.addEventListener('pointerdown', (e) => {
      // Clicks on regions and the handle have their own handlers; a drag from
      // there would move the handle under the pointer and swallow the click.
      const target = e.target as Element | null
      if (target?.closest('.region, .handle, .chip')) return
      if (this.mode === 'slider') this.#startDrag(e)
    })
    this.#viewport.addEventListener('keydown', (e) => this.#viewportKey(e))
  }

  // --------------------------------------------------------------- public API

  get mode(): ViewerMode {
    const m = this.getAttribute('mode')
    return isMode(m) ? m : 'slider'
  }
  set mode(value: ViewerMode) {
    this.setAttribute('mode', value)
  }

  setMode(mode: ViewerMode): void {
    this.mode = mode
  }

  get position(): number {
    return this.#position
  }
  set position(value: number) {
    this.setAttribute('position', String(clamp(Math.round(value), 0, 100)))
  }

  get regions(): DiffRegion[] {
    return this.#regions
  }
  set regions(value: DiffRegion[] | null | undefined) {
    this.#regions = Array.isArray(value) ? value : []
    this.#renderRegions()
  }

  get locators(): LocatorReport | null {
    return this.#locators
  }
  set locators(value: LocatorReport | null | undefined) {
    this.#locators = value ?? null
    this.#renderRegions()
  }

  get alignment(): AlignmentResult | null {
    return this.#alignment
  }
  set alignment(value: AlignmentResult | null | undefined) {
    this.#alignment = value ?? null
    this.#layout()
  }

  /** Image sources may also be set as Blobs. */
  set baseline(value: string | Blob) {
    this.setAttribute('baseline-src', this.#toUrl(value))
  }
  set candidate(value: string | Blob) {
    this.setAttribute('candidate-src', this.#toUrl(value))
  }

  get selectedRegion(): string | null {
    return this.#selected
  }

  selectRegion(id: string | null): void {
    this.#selected = id
    for (const el of this.#regionsEl.querySelectorAll<HTMLElement>('.region')) el.classList.toggle('selected', el.dataset.id === id)
    const region = id ? this.#regions.find((r) => r.id === id) ?? null : null
    const locators = id ? this.#locators?.byRegion.find((l) => l.regionId === id) ?? null : null
    this.#showChip(region, locators)
    this.dispatchEvent(new CustomEvent('elastishot-region-select', { detail: { region, locators }, bubbles: true, composed: true }))
  }

  // ------------------------------------------------------------- lifecycle

  connectedCallback(): void {
    this.#readJsonChild()
    if (!this.hasAttribute('mode')) this.setAttribute('mode', 'slider')
    this.#applySources()
    this.#applyMode()
    this.#observer = new ResizeObserver(() => this.#layout())
    this.#observer.observe(this)
    this.#layout()
    this.#initialized = true
  }

  disconnectedCallback(): void {
    this.#stopBlink()
    this.#observer?.disconnect()
    this.#observer = null
    for (const u of this.#objectUrls) URL.revokeObjectURL(u)
    this.#objectUrls = []
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    switch (name) {
      case 'baseline-src':
      case 'candidate-src':
      case 'warped-src':
      case 'diff-src':
        this.#applySources()
        break
      case 'mode':
        this.#applyMode()
        if (this.#initialized && value !== _old) {
          this.dispatchEvent(new CustomEvent('elastishot-mode-change', { detail: { mode: this.mode }, bubbles: true, composed: true }))
        }
        break
      case 'position':
        this.#position = clamp(Number(value ?? 50) || 0, 0, 100)
        this.#applyPosition()
        break
      case 'opacity':
      case 'flip-side':
      case 'blink-ms':
        this.#applyMode()
        break
      case 'zoom':
        this.#layout()
        break
      case 'show-regions':
        this.#renderRegions()
        break
    }
  }

  // --------------------------------------------------------------- internals

  #toUrl(value: string | Blob): string {
    if (typeof value === 'string') return value
    const url = URL.createObjectURL(value)
    this.#objectUrls.push(url)
    return url
  }

  #readJsonChild(): void {
    const script = this.querySelector('script[type="application/json"]')
    if (!script?.textContent) return
    try {
      const data = JSON.parse(script.textContent) as ViewerData
      if (data.regions) this.#regions = data.regions
      if (data.locators !== undefined) this.#locators = data.locators
      if (data.alignment !== undefined) this.#alignment = data.alignment
    } catch {
      // malformed data: keep going with what was set programmatically
    }
  }

  #applySources(): void {
    const baseline = this.getAttribute('baseline-src')
    const warped = this.getAttribute('warped-src')
    const candidate = warped ?? this.getAttribute('candidate-src')
    const diff = this.getAttribute('diff-src')
    if (baseline && this.#baselineImg.getAttribute('src') !== baseline) {
      this.#baselineLoaded = false
      this.#baselineImg.src = baseline
    }
    if (candidate && this.#candidateImg.getAttribute('src') !== candidate) {
      this.#candidateLoaded = false
      this.#candidateImg.src = candidate
    }
    if (!candidate) this.#candidateLoaded = true
    if (diff !== this.#diffUrl) this.#loadDiff(diff)
  }

  /**
   * The diff mask (white where pixels changed) becomes a tint drawn on a
   * canvas: white stays white, changed pixels take the tint colour, and the
   * canvas multiplies over the baseline. A CSS mask-image would do, but
   * Chromium refuses to fetch it from a file:// report.
   */
  #loadDiff(url: string | null): void {
    this.#diffUrl = url
    if (!url) {
      this.#tint.width = 0
      this.#tint.height = 0
      return
    }
    const img = new Image()
    img.onload = () => {
      if (this.#diffUrl !== url) return
      const c = this.#tint
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.globalCompositeOperation = 'difference'
      ctx.drawImage(img, 0, 0)
      ctx.globalCompositeOperation = 'lighten'
      ctx.fillStyle = getComputedStyle(this).getPropertyValue('--es-diff').trim() || '#dc2626'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.globalCompositeOperation = 'source-over'
    }
    img.src = url
  }

  #maybeReady(): void {
    if (this.#baselineLoaded && this.#candidateLoaded && !this.hasAttribute('ready')) {
      this.setAttribute('ready', '')
      this.dispatchEvent(new CustomEvent('elastishot-ready', { bubbles: true, composed: true }))
    }
  }

  #baselineSize(): { w: number; h: number } {
    const w = this.#baselineImg.naturalWidth
    const h = this.#baselineImg.naturalHeight
    if (w && h) return { w, h }
    const r = this.#regions.find((x) => x.boxBaseline)
    return r?.boxBaseline ? { w: r.boxBaseline.x + r.boxBaseline.w, h: r.boxBaseline.y + r.boxBaseline.h } : { w: 800, h: 600 }
  }

  #layout(): void {
    const { w, h } = this.#baselineSize()
    const zoom = this.getAttribute('zoom') ?? 'fit'
    const hostWidth = this.clientWidth || w
    this.#scale = zoom === 'fit' ? Math.min(1, hostWidth / w) : clamp(Number(zoom) || 1, 0.05, 10)
    const s = this.#scale
    this.#stage.style.width = `${w}px`
    this.#stage.style.height = `${h}px`
    this.#stage.style.transform = `scale(${s})`
    this.#viewport.style.height = `${Math.round(h * s)}px`
    this.#viewport.style.width = zoom === 'fit' ? '100%' : `${Math.round(w * s)}px`
    for (const layer of [this.#baselineLayer, this.#candidateLayer, this.#tint]) {
      layer.style.width = `${w}px`
      layer.style.height = `${h}px`
    }
    this.#baselineImg.style.width = `${w}px`
    this.#baselineImg.style.height = `${h}px`

    const usingWarped = this.hasAttribute('warped-src')
    if (usingWarped) {
      this.#xform.style.transform = 'none'
      this.#candidateImg.style.width = `${w}px`
      this.#candidateImg.style.height = 'auto'
    } else {
      const nw = this.#candidateImg.naturalWidth || w
      const nh = this.#candidateImg.naturalHeight || h
      this.#candidateImg.style.width = `${nw}px`
      this.#candidateImg.style.height = `${nh}px`
      this.#xform.style.transform = this.#alignment ? matrixToCss(this.#alignment.transform.m) : 'none'
    }
    this.#applyPosition()
    this.#renderRegions()
  }

  #applyPosition(): void {
    const p = this.#position
    if (this.mode === 'slider') {
      this.#candidateLayer.style.clipPath = `inset(0 0 0 ${p}%)`
      this.#handleV.style.left = `${p}%`
    } else {
      this.#candidateLayer.style.clipPath = 'none'
    }
    this.#handleV.setAttribute('aria-valuenow', String(p))
  }

  #applyMode(): void {
    const mode = this.mode
    for (const b of this.#root.querySelectorAll<HTMLButtonElement>('.toolbar button[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode))
    this.#stopBlink()
    this.#candidateLayer.style.opacity = ''
    this.#candidateLayer.style.transform = ''
    this.#baselineLayer.style.transform = ''
    this.#candidateLayer.style.visibility = ''
    this.#opacityLabel.hidden = mode !== 'overlay'
    this.#blinkLabel.hidden = mode !== 'blink'
    if (mode === 'overlay') {
      const o = clamp(Number(this.getAttribute('opacity') ?? 0.5), 0, 1)
      this.#candidateLayer.style.opacity = String(o)
      this.#opacityInput.value = String(Math.round(o * 100))
    } else if (mode === 'flip') {
      const side = this.getAttribute('flip-side') === 'baseline' ? this.#baselineLayer : this.#candidateLayer
      side.style.transform = 'scaleY(-1)'
      this.#candidateLayer.style.opacity = '0.5'
    } else if (mode === 'blink') {
      this.#startBlink()
    }
    this.#applyPosition()
  }

  #startBlink(): void {
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    this.#setBlinkPaused(reduced)
  }

  #setBlinkPaused(paused: boolean): void {
    this.#blinkPaused = paused
    this.#pauseButton.setAttribute('aria-pressed', String(paused))
    this.#pauseButton.textContent = paused ? 'Resume' : 'Pause'
    if (this.#blinkTimer) clearInterval(this.#blinkTimer)
    this.#blinkTimer = null
    if (paused || this.mode !== 'blink') return
    const ms = clamp(Number(this.getAttribute('blink-ms') ?? 600) || 600, 100, 10_000)
    this.#blinkTimer = setInterval(() => {
      this.#blinkOn = !this.#blinkOn
      this.#candidateLayer.style.visibility = this.#blinkOn ? 'visible' : 'hidden'
    }, ms)
  }

  #stopBlink(): void {
    if (this.#blinkTimer) clearInterval(this.#blinkTimer)
    this.#blinkTimer = null
    this.#candidateLayer.style.visibility = ''
  }

  #startDrag(e: PointerEvent): void {
    if (e.button !== 0) return
    const move = (ev: PointerEvent) => {
      const rect = this.#viewport.getBoundingClientRect()
      const p = ((ev.clientX - rect.left) / rect.width) * 100
      this.position = p
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    move(e)
    e.preventDefault()
  }

  #handleKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 10 : 1
    let p: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') p = this.#position + step
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') p = this.#position - step
    else if (e.key === 'Home') p = 0
    else if (e.key === 'End') p = 100
    if (p === null) return
    e.preventDefault()
    this.position = p
  }

  #viewportKey(e: KeyboardEvent): void {
    const digit = Number(e.key)
    if (digit >= 1 && digit <= MODES.length) {
      this.setMode(MODES[digit - 1]!)
      e.preventDefault()
      return
    }
    if (e.key === 'f' && this.mode === 'flip') {
      this.setAttribute('flip-side', this.getAttribute('flip-side') === 'baseline' ? 'candidate' : 'baseline')
      e.preventDefault()
    } else if (e.key === ' ' && this.mode === 'blink') {
      this.#setBlinkPaused(!this.#blinkPaused)
      e.preventDefault()
    } else if (e.key === 'Escape') {
      this.selectRegion(null)
    }
  }

  #regionBox(r: DiffRegion): Box | null {
    if (r.boxBaseline) return r.boxBaseline
    if (r.anchorBaseline) return { x: r.anchorBaseline.x, y: r.anchorBaseline.y - 2, w: r.boxCandidate?.w ?? 40, h: 4 }
    return null
  }

  #renderRegions(): void {
    this.#regionsEl.replaceChildren()
    for (const r of this.#regions) {
      const box = this.#regionBox(r)
      if (!box) continue
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `region k-${r.kind}${r.id === this.#selected ? ' selected' : ''}`
      b.setAttribute('part', 'region')
      b.setAttribute('role', 'listitem')
      b.dataset.id = r.id
      b.style.left = `${box.x}px`
      b.style.top = `${box.y}px`
      b.style.width = `${box.w}px`
      b.style.height = `${box.h}px`
      const owner = this.#ownerOf(r.id)
      b.setAttribute('aria-label', `${r.kind} region ${r.id}${owner ? `: ${owner.name} (${owner.locator})` : ''}`)
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        this.selectRegion(r.id)
      })
      this.#regionsEl.appendChild(b)
    }
  }

  #ownerOf(id: string): { name: string; locator: string } | null {
    const l = this.#locators?.byRegion.find((x) => x.regionId === id)
    const ref = l?.baseline ?? l?.candidate
    return ref ? { name: ref.name, locator: ref.locator } : null
  }

  #showChip(region: DiffRegion | null, locators: RegionLocators | null): void {
    if (!region) {
      this.#chip.classList.remove('on')
      this.#chip.textContent = ''
      return
    }
    const ref = locators?.baseline ?? locators?.candidate
    this.#chip.replaceChildren()
    const strong = document.createElement('strong')
    strong.textContent = `${region.kind} ${region.id}`
    this.#chip.appendChild(strong)
    if (ref) {
      this.#chip.appendChild(document.createTextNode(` ${ref.name} `))
      const code = document.createElement('code')
      code.textContent = ref.locator
      this.#chip.appendChild(code)
    }
    this.#chip.appendChild(document.createTextNode(` score ${region.score.toFixed(2)}`))
    this.#chip.classList.add('on')
  }
}
