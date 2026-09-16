# Elastishot

[![CI](https://github.com/Osman19702/elastishot/actions/workflows/ci.yml/badge.svg)](https://github.com/Osman19702/elastishot/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/elastishot)](https://www.npmjs.com/package/elastishot) [![licence: MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

Elastic screenshot comparison for UI change detection. Compare two screenshots, or two versions of a page by URL, and get a report of what changed even when the layout zoomed, a section collapsed, or the viewport changed size. Every difference is named by the DOM locator behind it, not just drawn.

- **Aligns before it compares.** ORB feature matching and RANSAC recover the zoom, shift and stretch between the two images; a band alignment then maps sections that collapsed or expanded. Pixels are only compared where they correspond.
- **Any two sizes.** 320x320 against 1080x1350 works. The candidate is warped onto the baseline.
- **Names the change.** A Playwright capture records an element map (test id, id, role and name, or CSS path) next to each screenshot; regions are attributed to the smallest element that covers them.
- **Reports that travel.** A summary page with one card per pair, a detail page per pair with an embeddable `<elastishot-viewer>` (slider, flip, blink, overlay, diff), `report.json` and JUnit XML.
- **Tracks a URL across deployments.** `snapshot` / `run` / `approve` keep a baseline per target and viewport; the CLI exits non-zero when a deployment drifted.
- **Modular.** Isomorphic core (runs in Node and the browser through opencv.js WASM), Node-only capture and file layers behind subpath exports, plugin hooks and pluggable reporters.

Elastishot is a Node 20+ library and CLI written in TypeScript, MIT licensed, with no telemetry: the CLI contacts only the URLs you pass it. The install is about 13 MB, nearly all of it the opencv.js WebAssembly build; there is no native compile step.

## Quick start

```bash
npm install -D elastishot
npm install -D playwright && npx playwright install chromium   # only needed for page URLs
npx elastishot compare https://staging.example.com/ https://example.com/ --full-page
npx elastishot compare before.png after.png
open .elastishot/runs/<run-id>/index.html
```

The first command captures both pages, compares them and writes a run folder. The last line of the output is the path of the summary page. Exit code 1 means differences were found.

## What's inside

```
elastishot/
├── bin/elastishot.js                 CLI entry (imports dist/cli/main.js)
├── src/
│   ├── index.ts                      Public entry: types, geometry, image helpers, compare(), comparePair()
│   ├── pipeline.ts                   comparePair(): engine + locators + verdict; Plugin and Reporter contracts
│   ├── core/                         Isomorphic: types, geometry, image utilities, options, thresholds, engine seam
│   ├── engine/                       opencv.js pipeline: preprocess, global align, structural align, diff, classify, verdict
│   │   ├── cv/                       Loader, Mat lifetime scope, typed subset of the opencv.js API
│   │   ├── pure/                     No-WASM algorithms: sequence alignment, colour distance, box merging, scoring
│   │   └── stages/                   One file per stage; every stage is replaceable
│   ├── locators/                     Regions x element maps -> changed locators
│   ├── capture/                      Playwright capture with the in-page element collector
│   ├── report/                       report.json schema, summary page, pair page, JUnit
│   ├── viewer/                       <elastishot-viewer> custom element (bundled by scripts/build-viewer.mjs)
│   ├── node/                         Files, URLs, snapshot folders, config, run folders, artifacts, the Node façade
│   └── cli/                          Argument parsing and the five commands
├── scripts/                          build-viewer, make-fixtures, check-layering, check-package, changelog-section, spike-opencv
├── test/                             Engine, capture, viewer and workflow tests; synthetic fixtures; fixture site v1/v2
├── acceptance/                       Gherkin features A-G with matching *.acceptance.test.js and trace.js
├── docs/                             ATDD.md, ELEMENT-MAP.md, EMBEDDING.md, ROADMAP.md, RELEASING.md
├── examples/ui-lab/                  A localhost page in seven builds with ground truth; scores every run
├── site/                             The landing page builder (site/dist is generated)
└── elastishot.config.example.js      Named targets and viewports for the run workflow
```

## Commands

| Command | What it does |
|---|---|
| `elastishot compare <baseline> <candidate>` | Each side is a baseline folder, a PNG/JPEG path, an image URL or a page URL. Writes a run folder. |
| `elastishot snapshot <url>` | Captures a page (PNG + element map + meta) as a baseline folder. |
| `elastishot run [target...]` | Captures and compares every target x viewport from `elastishot.config.*`. |
| `elastishot approve [target[/viewport]\|runDir]` | Promotes a run's candidate to the baseline; `--all` takes every failed or new pair. |
| `elastishot report <runDir>` | Re-renders `index.html` and `junit.xml` from a run's `report.json`. |

Options: `--out <dir>`, `--config <file>`, `--name <name>`, `--threshold <0..1>`, `--fail-on added,removed,changed,moved|none`, `--viewport WxH[@dpr]`, `--full-page`, `--wait-for <selector|ms>`, `--hide <selector>` (repeatable), `--no-map`, `--junit`, `--junit-file <file>`, `--single-file`, `--update`, `--all`, `--json`, `--quiet`, `--help`, `--version`. Run `elastishot --help` for the full text.

| npm script | What it does |
|---|---|
| `npm test` | Unit tests (`src/**/*.test.ts`), no browser, no WASM |
| `npm run test:engine` | Engine tests against opencv.js with synthetic pages, plus a timing and a leak check |
| `npm run test:browser` | Capture, viewer and workflow tests in Chromium |
| `npm run test:acceptance` | Builds, then drives the CLI as a subprocess through the Gherkin scenarios |
| `npm run test:trace` | Every scenario in `acceptance/features` must have a test |
| `npm run test:all` | All of the above plus `typecheck` and `check:layering` |
| `npm run build` | Bundles the viewer, then compiles `src/` to `dist/` |

## How it works

```
baseline (png | url) ─┐                                             ┌─ report.json
                      ├─► capture ─► PNG + element map ─┐           ├─ index.html (one card per pair)
candidate (png | url) ┘                                 │           ├─ pairs/<id>/report.html (viewer, regions, locators)
                                                        ▼           ├─ junit.xml
        preprocess ─► global align ─► structural align ─► diff ─► classify ─► verdict ─► locators ─┤
        (working     (ORB + RANSAC   (strips + sequence  (YIQ    (moved =   (score,      (regions x  └─ plugins / reporters
         scale)       similarity or   alignment: matched,  delta,  template   pass/fail)   element maps)
                      affine, fall-   inserted, deleted    shift   match)
                      backs)          bands)               tolerant)
```

1. **Preprocess.** Both images are brought to the same working width (never upscaled) and converted to grey.
2. **Global align.** ORB keypoints are matched with a ratio test, RANSAC estimates an affine transform, and it is snapped to a similarity (scale + translation) when the fit is uniform. Flat pages fall back to edge-profile correlation, then to a plain resize. The candidate is warped onto a canvas in baseline space, padded so nothing is lost.
3. **Structural align.** When both captures are the same size and the global transform is a whole-pixel shift, every row is hashed and the two sequences are aligned like lines of text: unique rows anchor the alignment, common prefix and suffix are trimmed, and rows nothing distinguishes are substitutions for the differ. Otherwise, and whenever it explains more pixels, both images are cut into 8 px strips with small signatures and a Needleman-Wunsch alignment with affine gap costs maps baseline rows to candidate rows. Deleted runs become `removed` regions, inserted runs `added` regions, matched runs go to the differ with their offset refined to the pixel.
4. **Diff.** Matched rows are compared with pixelmatch's YIQ colour distance, tolerant to one-pixel shifts and resampling blends. Specks are removed, connected components are merged into regions and scored.
5. **Classify.** A removed region whose pixels reappear elsewhere, or a changed region whose baseline content is found at another position, becomes one `moved` region.
6. **Verdict.** A similarity of 0..1 (a low-confidence alignment can never reach 1), counts per kind, warnings, and pass/fail against the threshold and `failOn`.
7. **Locators.** Each region is attributed to the smallest element covering it on each side; elements present in only one map are added with map evidence.

## Measured

The UI lab in `examples/ui-lab` renders one page in seven builds and records what each build changes (35 elements: added, changed, moved, expanded, re-drawn). Every run is scored against that ground truth. On the current engine:

| Measure | Result |
|---|---|
| planted changes found, named by locator or covered by a region | 35 of 35 |
| regions on elements nobody changed, score 0.2 or higher | 1 |

The one remaining region is a stat card whose sparkline was redrawn at a new width after the cards spread out: a real difference, on an element the build did not list. Reproduce it with `node examples/ui-lab/run-lab.mjs --no-video`; the report in `examples/ui-lab/report/index.html` lists every planted change with its verdict and every noise region with its box.

## Tracking a URL across deployments

```bash
cp elastishot.config.example.js elastishot.config.js   # edit targets and viewports
npx elastishot run --update      # first time: writes baselines/<target>/<viewport>/
npx elastishot run               # later: compares every target, exit 1 on drift
npx elastishot approve home      # accept the new look of one target (or --all)
```

```
baselines/<target>/<viewport>/    baseline.png, baseline.map.json, meta.json
.elastishot/runs/<run-id>/        report.json, index.html, junit.xml, pairs/<target>--<viewport>/...
.elastishot/runs/latest           the newest run folder (approve uses it by default)
```

A GitHub Actions job:

```yaml
- run: npm ci && npx playwright install --with-deps chromium
- run: npx elastishot run --junit
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: elastishot, path: .elastishot/runs }
```

## Programmatic use

```js
import { compare, comparePair } from 'elastishot'
import { capture } from 'elastishot/capture'
import { readImageFile, createElastishot } from 'elastishot/node'

// images only
const result = await compare(await readImageFile('a.png'), await readImageFile('b.png'), { workingWidth: 1024 })
console.log(result.summary.similarity, result.regions)

// pages, with named locators
const [v1, v2] = await Promise.all([capture('https://a.test/', { fullPage: true }), capture('https://b.test/', { fullPage: true })])
const { result: r, locators, pass } = await comparePair(v1, v2, { threshold: 0.98 })
console.log(pass, locators.changedLocators.map((l) => `${l.kinds.join('/')} ${l.name} ${l.locator}`))

// the whole workflow, with a custom reporter and a hook
const app = await createElastishot({
  reporters: [{ name: 'slack', async report(report) { /* post report.totals */ return [] } }],
  plugins: [{ name: 'notes', onCompared({ pair }) { if (pair.status === 'failed') pair.failReasons.push('review required') } }],
})
const run = await app.run()
await app.close()
process.exitCode = run.exitCode
```

Subpath exports: `elastishot` (isomorphic core), `elastishot/engine` (create an engine with your own stages, plugins or a pre-loaded `cv`), `elastishot/locators`, `elastishot/report`, `elastishot/viewer` (registers the element), `elastishot/capture` and `elastishot/node` (Node only). See `docs/EMBEDDING.md` for browser and framework use.

## Reports

- `index.html`: one card per pair with status, similarity, counts, thumbnails and the top changed locators; filters by status.
- `pairs/<id>/report.html`: the viewer with mode toolbar, side-by-side images, a region table linked to the viewer, changed locators, warnings and details.
- `report.json`: everything the pages show, schema `elastishot.report/1` (see `docs/ELEMENT-MAP.md`).
- `junit.xml`: one testcase per pair; failures carry the reasons and the changed locators.

Images are written as files next to the pages, thumbnails are inlined so `index.html` is portable on its own. `--single-file` inlines every image for a report that must be a single attachment; expect a few MB per pair.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Every pair at or above the threshold with no region of a `--fail-on` kind |
| 1 | Differences found, or a target without a baseline (unless `--update`) |
| 2 | Usage error, or a runtime error (browser, engine, unreadable input) |

## Troubleshooting

- **"capturing pages needs Playwright"**: `npm install -D playwright && npx playwright install chromium`. Playwright is an optional peer dependency; image-only use does not need it.
- **Strict Content-Security-Policy**: the animation freeze, `hide` and `mask` styles are applied as a constructed stylesheet, which `style-src` does not govern, so pages without `'unsafe-inline'` capture unchanged.
- **Dark and light themes**: give a target `capture: { colorScheme: 'dark' }` (emulated `prefers-color-scheme`) and another `'light'`; each becomes its own baseline.
- **Flaky captures**: freeze what moves. `--hide .cookie-banner`, `--wait-for "[data-testid=ready]"`, `capture.mask` in the config; animations and transitions are already disabled during capture.
- **A full-page capture is wider than the viewport**: the page itself is wider (a fixed-width layout); Playwright captures the scrollable area. Use a viewport at least as wide as the page or accept the width.
- **Too many small regions**: raise `diff.threshold` (default 0.1) in the config `compare` section, or lower `diff.maxRegions`. `diff.antialiasTolerance` defaults to `auto`: 1 px when the candidate had to be resampled (zoom, rotation, fallback alignment) and 0 on same-scale pages, so a changed digit in small text is reported. Set it to a number to force one behaviour.
- **A captured page was an error page**: the pair carries a `CAPTURE_ERROR_PAGE` warning when the response status was 4xx/5xx, the title looks like an error or redirect notice, or fewer than five elements were found. Check the URL, the wait settings and authentication before trusting the score.
- **Everything below a change is reported**: the structural alignment could not find the shift. Check the `STRUCT_WEAK_MATCH` and `ALIGN_*` warnings in the pair page; long identical lists and pages without texture are the usual causes.
- **Memory**: opencv.js keeps a few copies of the working images. Full-page captures at device pixel ratio 2 are large. Two captures of the same width are compared at their own size up to 1920 px, so their rows stay exact; wider or unequal pairs are brought to `workingWidth` (default 1280), below which whole-pixel shifts become fractional and the antialiasing tolerance switches on. `--max-old-space-size` helps Node with the decoded PNGs.
- **TypeScript without Playwright installed**: the `elastishot/capture` and `elastishot/node` type declarations reference Playwright's types. Install `playwright` (it is the optional peer dependency anyway) or set `skipLibCheck` in your tsconfig.
- **Windows**: paths in reports always use forward slashes; `.elastishot/runs/latest` is a text file, not a symlink.

## Limits

- Feature-based alignment needs texture. A blank or highly repetitive page falls back to edge profiles or to a plain resize and says so in the warnings; the similarity is capped below 1 in that case.
- One global transform plus one vertical band map. Responsive reflow (columns becoming rows, different line breaks) is reported as large changed or added regions, not aligned. Horizontal collapses are not modelled in this version.
- Scale changes above about 2x in one step, rotations, and perspective are unreliable; screenshots are assumed to be axis-aligned.
- Text edits of a few pixels fall below the default colour threshold, and one-pixel line shifts are tolerated on purpose.
- Locators exist only for DOM content. Canvas, WebGL and cross-origin iframes are opaque; ids generated by frameworks are rejected and those elements fall back to CSS paths, which are brittle across DOM changes.
- Fixed and sticky elements in a full-page capture sit where the browser painted them at the first position.
- opencv.js is a 12 MB download in the browser; load it lazily or in a worker, and pass it to `createEngine({ cv })`.

## Contributing and security

Pull requests are welcome under the Developer Certificate of Origin; see [CONTRIBUTING.md](CONTRIBUTING.md). Vulnerabilities go through [SECURITY.md](SECURITY.md), not the issue tracker. Releases are cut as described in [docs/RELEASING.md](docs/RELEASING.md) and recorded in [CHANGELOG.md](CHANGELOG.md); the [roadmap](docs/ROADMAP.md) says what comes next.
