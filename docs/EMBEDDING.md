# Embedding Elastishot in a larger tool

The package is split so a host application takes only what it needs.

| Import | Runs in | Contains |
|---|---|---|
| `elastishot` | Node and browser | Types, geometry, image helpers, `compare()`, `comparePair()`, option resolution, `evaluate()` |
| `elastishot/engine` | Node and browser | `createEngine({ cv, stages, plugins, defaults })`, `loadOpenCV()`, `MatScope` |
| `elastishot/locators` | Node and browser | `mapLocators()`, element map parsing |
| `elastishot/report` | Node and browser | `buildReport()`, `renderSummaryReport()`, `renderPairReport()`, `renderJUnit()` |
| `elastishot/viewer` | Browser | Registers `<elastishot-viewer>` (`defineElastishotViewer(tag)` for another name) |
| `elastishot/capture` | Node | `capture()`, `createCaptureAdapter()` (Playwright, optional peer dependency) |
| `elastishot/node` | Node | Files and URLs, snapshot folders, config, run folders, `createElastishot()` |

## The engine in a browser

opencv.js is 12 MB and is never bundled. Load it yourself, lazily, and hand it to the engine:

```js
import { createEngine } from 'elastishot/engine'

// a) let the loader fetch a script URL (main thread or worker)
const engine = createEngine({ cv: 'https://cdn.example/opencv.js' })

// b) or load the module any way you like and pass the object or a function returning it
const engine = createEngine({ cv: () => import('@techstark/opencv-js').then((m) => m.default) })

const result = await engine.compare(baselineImage, candidateImage, { workingWidth: 800 })
```

Images are plain `{ width, height, data: Uint8ClampedArray }` (RGBA). From a canvas: `ctx.getImageData(0, 0, w, h)` already has that shape. Run the compare in a Web Worker for pages larger than a few hundred thousand pixels; everything the engine returns is structured-clone friendly, and image buffers are transferable.

## comparePair: engine, locators and verdict in one call

```js
import { comparePair } from 'elastishot'

const { result, locators, pass, failReasons } = await comparePair(
  { image: baselineImage, elementMap: baselineMap, source: 'v1' },
  { image: candidateImage, elementMap: candidateMap, source: 'v2' },
  { threshold: 0.98, failOn: ['added', 'removed', 'changed'], compare: { ignoreRegions: [{ x: 0, y: 0, w: 1280, h: 64 }] } },
)
```

`locators.changedLocators` is what to show people; `result.regions` is what to draw.

## The viewer element

```html
<script type="module" src="node_modules/elastishot/dist/viewer/elastishot-viewer.js"></script>
<elastishot-viewer baseline-src="a.png" candidate-src="b.png" diff-src="diff.png" warped-src="warped.png" mode="slider" show-regions>
  <script type="application/json">{ "regions": [...], "locators": {...}, "alignment": {...} }</script>
</elastishot-viewer>
```

- Attributes: `baseline-src`, `candidate-src`, `diff-src`, `warped-src`, `mode` (`slider`, `flip`, `blink`, `overlay`, `diff`), `position` (0-100), `opacity` (0-1), `flip-side` (`baseline` | `candidate`), `blink-ms`, `zoom` (`fit` or a number), `show-regions`, `hide-regions` (hides the region boxes in every mode, so the pixels can be read; the toolbar's "Hide regions" checkbox and the `r` key toggle it), `no-toolbar`.
- Properties: `regions`, `locators`, `alignment` (objects), `baseline` and `candidate` (string or Blob). Method: `selectRegion(id | null)`.
- Events: `elastishot-ready`, `elastishot-mode-change` (`detail.mode`), `elastishot-region-select` (`detail.region`, `detail.locators`).
- Keyboard: focus the stage and press 1-5 for modes, `f` to change the flipped side, space to pause blinking, `r` to hide or show the region boxes, Escape to clear the selection; the slider handle takes arrows, Home and End.
- Theming: `--es-bg`, `--es-fg`, `--es-line`, `--es-accent`, `--es-handle`, `--es-diff`, `--es-chip-bg`, `--es-region-added`, `--es-region-removed`, `--es-region-changed`, `--es-region-moved`, `--es-gap-added`, `--es-gap-removed`, `--es-font`; parts `toolbar`, `stage`, `handle`, `region`, `chip`.

When `warped-src` is given the candidate is shown pixel-exact in baseline space (the engine's `artifacts.warpedCandidate`). Without it the candidate image is placed with a CSS transform built from `alignment.transform`.

When `alignment.bandMap` has inserted or deleted rows (a section that appeared or collapsed), both sides are redrawn band by band into one row space: an inserted block is a tinted gap on the baseline side, a deleted one a gap on the candidate side, and the rows below line up again in every mode. Added regions are drawn as full boxes over the gap. The gap colours are `--es-gap-added` and `--es-gap-removed`. Bands that carry `columns` come from a stretch of the page aligned lane by lane (side-by-side columns that moved independently); each lane is drawn in its own row space, and boxes map through the lane that holds them.

React:

```jsx
import 'elastishot/viewer'
function Diff({ pair }) {
  const ref = useRef(null)
  useEffect(() => { Object.assign(ref.current, { regions: pair.regions, locators: pair.locators, alignment: pair.alignment }) }, [pair])
  return <elastishot-viewer ref={ref} baseline-src={pair.baseline.image} candidate-src={pair.candidate.image} mode="slider" show-regions />
}
```

Vue: `<elastishot-viewer :regions.prop="regions" :locators.prop="locators" baseline-src="..." />` and add `elastishot-viewer` to `compilerOptions.isCustomElement`. Angular: `CUSTOM_ELEMENTS_SCHEMA`.

## Plugins and reporters

`createElastishot()` from `elastishot/node` runs the workflow and calls, in order, `onCaptured`, `onCompared` (the pair report is mutable there: change `status`, add `failReasons`) and `onReported`. Reporters receive the finished `report.json` object and return where they put it. A reporter is any object with a `name` and a `report(report, { runDir })` function, so a Slack or ticket integration needs no core change.

```js
const app = await createElastishot({
  plugins: [{ name: 'ignore-dates', onCompared({ pair }) { pair.regions = pair.regions.filter((r) => !isDateArea(r)) } }],
  reporters: [{ name: 'stdout', report(report) { console.log(JSON.stringify(report.totals)); return [] } }],
})
```

For engine-level customisation use `createEngine({ plugins: [{ name, regionFilter(region) { ... }, afterStage(name, output) { ... } }] })` or replace a stage with `createEngine({ stages: { globalAlign: myAligner } })`.
