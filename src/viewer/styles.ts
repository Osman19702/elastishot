export const VIEWER_CSS = `
:host { display: block; position: relative; font: 13px/1.4 var(--es-font, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); color: var(--es-fg, #1f2937); --_accent: var(--es-accent, #2563eb); --_line: var(--es-line, #d1d5db); --_bg: var(--es-bg, #ffffff); }
:host([hidden]) { display: none; }
* { box-sizing: border-box; }
.toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
.toolbar button { font: inherit; padding: 4px 10px; border: 1px solid var(--_line); border-radius: 6px; background: var(--_bg); color: inherit; cursor: pointer; }
.toolbar button[aria-pressed="true"] { background: var(--_accent); color: #fff; border-color: var(--_accent); }
.toolbar label { display: inline-flex; align-items: center; gap: 6px; }
.toolbar label[hidden] { display: none; }
.toolbar input[type="range"] { width: 120px; }
:host([no-toolbar]) .toolbar { display: none; }
.frame { position: relative; max-width: 100%; }
.viewport { position: relative; overflow: auto; background: var(--_bg); border: 1px solid var(--_line); border-radius: 8px; outline: none; max-width: 100%; }
.viewport:focus-visible { outline: 2px solid var(--_accent); }
.stage-box { position: relative; overflow: hidden; }
.stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.layer { position: absolute; left: 0; top: 0; overflow: hidden; transform-origin: 50% 50%; }
.layer img { display: block; position: absolute; left: 0; top: 0; max-width: none; }
.layer img[hidden], .layer canvas.aligned[hidden] { display: none; }
.layer canvas.aligned { display: block; position: absolute; left: 0; top: 0; }
.xform { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.layer.candidate { display: none; }
.diff-tint { position: absolute; left: 0; top: 0; mix-blend-mode: multiply; display: none; pointer-events: none; }
.regions { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; display: none; }
:host([show-regions]) .regions, :host([mode="diff"]) .regions { display: block; }
.region { position: absolute; margin: 0; padding: 0; background: transparent; border: 2px solid var(--_c); pointer-events: auto; cursor: pointer; }
.region:focus-visible, .region.selected { box-shadow: 0 0 0 3px var(--_c), 0 0 0 5px #fff; }
.region.k-added { --_c: var(--es-region-added, #16a34a); }
.region.k-removed { --_c: var(--es-region-removed, #dc2626); }
.region.k-changed { --_c: var(--es-region-changed, #c026d3); }
.region.k-moved { --_c: var(--es-region-moved, #2563eb); }
.handle { position: absolute; display: none; z-index: 2; }
.handle.v { top: 0; bottom: 0; width: 0; border-left: 2px solid var(--es-handle, #fff); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45); cursor: ew-resize; }
.handle::after { content: ''; position: absolute; top: 50%; left: 50%; width: 28px; height: 28px; margin: -14px 0 0 -14px; border-radius: 50%; background: var(--es-handle, #fff); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45); }
.handle.v::after { margin-left: -15px; }
.handle:focus-visible { outline: 2px solid var(--_accent); }
.chip { position: absolute; left: 8px; bottom: 8px; z-index: 3; background: var(--es-chip-bg, rgba(17, 24, 39, 0.92)); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 12px; max-width: calc(100% - 16px); display: none; pointer-events: none; }
.chip code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.chip.on { display: block; }
:host([mode="slider"]) .layer.candidate, :host([mode="flip"]) .layer.candidate, :host([mode="blink"]) .layer.candidate, :host([mode="overlay"]) .layer.candidate { display: block; }
:host([mode="slider"]) .handle.v { display: block; }
:host([mode="diff"]) .diff-tint { display: block; }
`
