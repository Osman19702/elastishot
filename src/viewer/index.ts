/**
 * elastishot/viewer: importing this module registers <elastishot-viewer>.
 * Use defineElastishotViewer('my-tag') to register under another name.
 */
import { ElastishotViewer } from './element.ts'

export { ElastishotViewer, type ViewerData } from './element.ts'
export { MODES, type ViewerMode } from './template.ts'
export { matrixToCss } from './transform.ts'

export function defineElastishotViewer(tag = 'elastishot-viewer'): void {
  if (typeof customElements === 'undefined') return
  if (!customElements.get(tag)) customElements.define(tag, ElastishotViewer)
}

defineElastishotViewer()
