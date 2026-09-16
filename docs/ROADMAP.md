# Elastishot roadmap

Elastishot compares two screenshots of a UI the way a person does: it lines
them up first, works out which sections moved, grew or collapsed, diffs what
is left, and names the DOM element behind every change. This roadmap says
where it goes from here. Dates are targets, not promises; the order is the
commitment.

## Principles that do not change

- **The core stays MIT.** Engine, CLI, reports, viewer, capture and locators
  are open source now and will not be relicensed, gated or thinned out to
  sell them back.
- **No telemetry.** The CLI talks only to the URLs you give it.
- **Local first.** Baselines are files in your repo; reports open from disk.
- **Honest output.** Every warning the engine raises reaches the report. A
  comparison that had to fall back says so.

## 0.1 — Foundation (September 2026, done)

The first release candidate exists and is field-tested.

- Feature alignment (ORB + RANSAC, snapped to a similarity or a whole-pixel
  shift) so zoomed, cropped and shifted captures line up before any pixel is
  compared.
- Structural alignment: horizontal strips matched by sequence alignment, so
  a collapsed FAQ or an inserted banner does not turn everything below it
  into a change.
- Region kinds: added, removed, changed, moved; move detection by template
  matching.
- Element maps from Playwright captures; every region named by the smallest
  element covering it (test id, id, role and name, then a CSS path).
- Reports: summary page, pair page with the embeddable viewer (slider,
  flip, blink, overlay, diff), JSON, JUnit XML.
- CLI: `compare`, `snapshot`, `run`, `approve`, `report`; config file with
  targets × viewports; exit codes for CI.
- Four test tiers: 90 unit, 26 engine, 16 browser, 28 Gherkin acceptance
  scenarios; a field test on 13 real public pages; the Lumen UI lab
  (`examples/ui-lab`) with ground truth that scores every run.

Remaining for the tag: NOTICE and provenance in the release workflow, npm
publish, repository public.

## 0.2 — Trust (October 2026)

Make every result easier to believe and harder to misread.

- **Exact row alignment** (shipped ahead of 0.2): same-scale captures are
  aligned row by row from row hashes, so insertions of any height keep the
  rows below them exact. The lab's noise count went from 19 regions to 1.

- **Column-axis structural alignment.** Sidebars that widen and columns that
  reorder are today's biggest source of noise; the strip alignment gains a
  horizontal pass.
- **Move naming.** Moved blocks name both the element that left and the
  element that arrived; swapped cards read as "moved", not "changed".
- **Resized elements in the report** (already in the element maps) shown in
  the changed-elements table with their old and new size.
- **Ignore by selector**, not only by box: `ignore: ['[data-testid=clock]']`
  masks the element wherever it lands.
- **Flaky-region memory.** Regions that flip between consecutive runs of the
  same target are flagged as unstable instead of failing the run again.
- **GitHub Action** with a job summary and the run folder as an artifact.
- **Performance:** worker threads for multi-target runs, optional WASM SIMD
  build of opencv.js.

## 0.3 — Teams (November to December 2026)

Make the workflow shared rather than personal.

- **Approve from the report.** A button on a failed pair writes an approval
  file the CLI applies with `approve --from-report`; reviewers never touch
  the baselines folder.
- **History.** A run knows its predecessor; the summary shows what changed
  since the last run, not since the baseline.
- **Component mode.** Capture every story of a Storybook (or any list of
  URLs with a selector) as its own target.
- **Firefox and WebKit** captures through Playwright, with per-browser
  baselines.
- **Reporters as plugins:** PR comment reporter, Slack reporter, S3 upload,
  each a small package using the public `Reporter` contract.

## 1.0 — Stable (first quarter 2027)

Freeze what people build on.

- `elastishot.report/1` and `elastishot.element-map/1` schemas declared
  stable; the plugin, reporter and `comparePair` APIs frozen with a
  deprecation policy.
- A published benchmark: the UI lab and the field-test set run against
  pixelmatch and BackstopJS with false positives and misses counted.
- Documentation site with the live demo, the lab report and the field test.
- Report accessibility: keyboard paths through the viewer, screen-reader
  labels for regions, reduced-motion blink.

## Beyond 1.0 — Hosted (2027)

The open core stays complete; a hosted service adds what a team cannot keep
in a repo: baselines per branch with retention, history across runs,
shareable report links with access control, checks and comments through a
GitHub App, approval in the browser. It consumes the same public report
format and is an opt-in reporter; the CLI never contacts it unless
configured.

## How to influence this

Open an issue with a pair of screenshots that Elastishot gets wrong. Real
pairs move items up this list faster than anything else.
