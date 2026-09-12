export const MODES = ['slider', 'slider-h', 'flip', 'blink', 'overlay', 'diff'] as const
export type ViewerMode = (typeof MODES)[number]

const MODE_LABELS: Record<ViewerMode, string> = {
  slider: 'Slider',
  'slider-h': 'Slider (horizontal)',
  flip: 'Flip',
  blink: 'Blink',
  overlay: 'Overlay',
  diff: 'Diff',
}

export function viewerTemplate(): string {
  const buttons = MODES.map((m, i) => `<button type="button" data-mode="${m}" aria-pressed="${i === 0}" title="${i + 1}">${MODE_LABELS[m]}</button>`).join('')
  return `
<div class="toolbar" part="toolbar" role="group" aria-label="comparison mode">
${buttons}
<label class="opacity" hidden>Opacity <input type="range" min="0" max="100" value="50" aria-label="Candidate opacity"></label>
<label class="blink" hidden><button type="button" class="pause" aria-pressed="false">Pause</button></label>
</div>
<div class="viewport" part="stage" tabindex="0" aria-label="comparison">
<div class="stage">
<div class="layer baseline"><img alt="baseline" draggable="false"></div>
<div class="layer candidate"><div class="xform"><img alt="candidate" draggable="false"></div></div>
<canvas class="diff-tint" aria-hidden="true"></canvas>
<div class="regions" role="list" aria-label="changed regions"></div>
</div>
<div class="handle v" part="handle" role="slider" tabindex="0" aria-label="Reveal candidate" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"></div>
<div class="handle h" part="handle" role="slider" tabindex="0" aria-label="Reveal candidate" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"></div>
<div class="chip" part="chip" aria-live="polite"></div>
</div>`
}
