# Changelog

All notable changes to Elastishot are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **`run` no longer ignores capture flags.** `--full-page`, `--wait-for`,
  `--hide` and `--no-map` now apply to every target, over the config.
- **A flag a command does not use is now a usage error** (exit 2) instead of
  being parsed and dropped. Examples: `run --viewport`, `run --name`, and
  `--all` anywhere but `approve`. Scripts that passed such flags got nothing
  from them before; now they are told.
- **A run made with `--single-file` can be approved.** Candidate files are
  written for every pair `approve` accepts; the pages still inline every
  image.
- **An ad-hoc `compare` no longer breaks a pending `approve`.**
  - `report.json` now records the command that made the run and the baseline
    folder it used (`config.command`, `config.baselineDir`).
  - `approve` without a run folder skips a `latest` that `compare` made, uses
    the newest run that `run` made, and says so.
  - It also notes when the run compared against a different baseline folder.
  - `latest` still points at the newest run of any kind.
- **`approve <name>` treats a folder as a run only when it holds a
  `report.json`,** so a target named like a folder in the project is no longer
  misread.
- **A delay can carry a unit.** `--wait-for 2000ms` and `waitFor: '2000ms'`
  are delays; before, they were taken as CSS selectors and timed out.

### Added

- **`run --update --force`** also replaces baselines that differ from the new
  capture. Those pairs keep their diff and a "baseline replaced" reason, and
  the run exits 0.
- **`compare --no-config`** ignores any config file, so an ad-hoc comparison
  inside a project neither takes its thresholds nor runs its reporters.
- **`--viewport` accepts a configured viewport's name.** A `snapshot
  --viewport 390x844@2` that matches a configured viewport also takes its name,
  so the baseline lands in the folder `run` reads.
- **Config discovery:** the config file is found in the current folder or the
  nearest parent folder, and `elastishot.config.cjs` is recognised.

### Changed

- **opencv.js 5.0** (`@techstark/opencv-js` 5.0.0-release.1, up from 4.12). The
  UI lab's `report.json` is identical on both versions, region for region and
  score for score, and stage timings are within run-to-run noise. The install
  grows from about 13 MB to about 16 MB, and the browser download from 12 MB
  to 13 MB.
- The package is now built with TypeScript 7. Apart from quote style on import
  paths, the emitted JavaScript and type declarations are the same as
  TypeScript 5.9's.
- Development and tests use Playwright 1.64.1; the peer range is unchanged.

### Documentation

- `docs/MOBILE.md` is now a general guide to native and React Native
  screenshots. The native roadmap and the smaller items found in field use are
  in `docs/ROADMAP.md`.

## [0.2.0] - 2026-09-20

Comparison results move in this release. Pages where side-by-side columns grow
by different amounts are reported differently, and almost always better: over a
230-pair corpus of real captures, 25 pairs changed for the better, 201 are
identical to 0.1.7, and 4 lost a little (all of them comparisons of two
unrelated screens, already below 0.75 similarity). If you gate a pipeline on a
similarity threshold, or keep approved baselines, re-check them once after
upgrading.

### Fixed

- **A card whose columns grow unevenly is no longer reported as stripes across
  the whole card.** Take a card with a picture on top and two columns of text
  below it, where the picture is redrawn at the same size and the columns grow
  by different amounts. Where both columns grew, the report showed full-width
  bands of added and removed rows straight across the card, seven and eighteen
  rows at a time. Where only one grew, its growth became a single added block
  the width of both columns at the foot of the card, and the lines above it —
  which had only moved down — were reported as one changed block.

  Each column now gets a lane of its own: the new lines are added regions in
  their own column where they stand, lines edited in place are small changed
  regions, nothing is reported as removed, and the picture's change stays
  inside the picture.

  The cause was that the stretch of rows treated as a column conflict grew
  upward too far. It was judged over a whole band at a time, and the redrawn
  picture dragged that band below the threshold, so the conflict was taken to
  reach the top of the page. Over that height the heading and the picture lie
  across the card's gutter, so the only blank columns left were the ones beside
  a fixed nav rail, and the lane to the left of it still held both columns.
  A conflict now ends at the nearest run of 48 unchanged rows, wherever that
  run sits.

  Such a run is not always the end of a conflict, though: one appears inside a
  card whenever the shorter column has ended while the other still moves. Where
  cutting there would leave the parts unable to explain the change, the whole
  conflict is measured a second time as one, and the two readings are compared
  on how many pixels each actually accounts for.

  Scenario A6 holds this case at the command line. Its committed pair comes out
  of the released 0.1.7 as three 22-row stripes across the card — added, then
  removed, then added — and comes out here as three added blocks, each inside
  its own column, with nothing removed. The UI lab gained builds 9 and 10 for
  the same case. No other lab pair moved.

- **The page below such a card is no longer torn along the lane cut.** When one
  column gained more rows than the card around it grew, the viewer drew
  everything below the card lower on one side of the cut than the other — 15
  rows on the lab's hero, and 103 rows on the card above once its columns had a
  lane each. The lanes are now brought level again where the last gap of the
  stretch ends, with padding that carries no tint and no region box, so the card
  has one bottom edge and the page below it is one picture.

  Two stretches of a page whose lanes are cut at different columns no longer
  draw over each other; a pixel of difference was enough. Gap fills are also
  drawn unsmoothed now, so a fill no longer fades the neighbouring gaps' colours
  in at its top and bottom edge.

- **Blank rows that a column closes up or opens up are no longer shown as
  changes.** At the foot of the card above, the candidate side showed a red
  103-row block across the left lane and the baseline side a green 62-row block
  across the right one — neither with a box to click, in a report whose header
  said `removed 0`. The diff view painted the green one as solid changed, and
  the Structure list called them "103 rows removed" and "62 rows inserted" with
  no element behind either.

  Those rows are only what the two columns need to end level. They are now drawn
  like the padding beside them: filled, untinted, not marked changed, and listed
  as "103 blank rows closed up". Content the page really gained or lost keeps its
  tint, its diff colour and its box.

- **A highlight box is no longer drawn over the block beneath it.** Whenever a
  changed line ended on the row a gap starts at — the common case, because the
  gap is cut directly below the line that changed — the box's bottom edge was
  measured one row too far and swallowed the whole gap. On the pages this
  release was written for, a 33-row changed box was drawn 52 rows tall over the
  added block below it, and a 15-row box was drawn 108 rows tall. A box that
  genuinely spans a gap still keeps both edges.

- **A narrow sliver of content no longer joins the wrong side.** A strip too
  narrow to be a lane of its own — the tail of a long line, or a column of list
  markers — joins the span after it, since a marker precedes the text it belongs
  to and may stand further from it than a gutter is wide. It joins the span
  behind it only where the gap behind is clearly narrower, by a factor of three.
  Below that margin the answer is guesswork, and the guess used to cut a
  paragraph in two.

### Added

- **`blank: true` on a band in `alignment.bandMap`.** A column that grows more
  than the card around it leaves fewer rows of padding under it, and the column
  beside it more. Those rows are real and they are in the band map, but nothing
  was added or removed there. The engine has always refused them a region; now
  it says so, and a consumer can tell padding a lane closed up from a block that
  went away. Blank rows across the full width are not marked — nothing else can
  have moved them, so they remain a spacing change and keep their
  `whitespace-only` region. The field is omitted when it does not apply and the
  schema stays `elastishot.report/1`.

- **`ELASTISHOT_BIN` points the acceptance suite at another build**, so a new
  scenario can be shown to fail against an installed release before it is
  trusted here. It prints the binary it is using, and `npm run test:all` refuses
  to run while it is set.

### Known limitations

- Where the first line of text under the card changed in place as well, and only
  blank rows lie between that line and the card's foot, the insertion floats past
  it, the line falls inside the conflict, and the columns stay in one lane. The
  result is what 0.1.7 reported. The engine suite carries this as a `todo` that
  prints its symptom on every run.
- A column that grows with no net change to the page height still forms no
  conflict at all, so its columns are not separated.
- On a page with a side rail, where a block is inserted across the full width
  of a card but not of the page, the second reading can be preferred on the
  strength of the full-width block alone and assign the new rows to the rail's
  lane. The rail is then reported as changed and moved although it only shifted
  down. The result is what 0.1.7 reports, so nothing regressed, but the
  improvement this release brings elsewhere is not reached on that shape.

## [0.1.7] - 2026-09-16

### Fixed

- Two lines of a card's left column changed and two were added while the
  right column stayed: the full-width row alignment paired the changed lines
  and the paragraph below them with the wrong rows and put the insertion two
  paragraphs too low, so the paragraph was reported as changed and the viewer
  showed the gap in the wrong place. The rows beside a gap that did not pair
  exactly now belong to the lane zone, and each column is aligned on its own
  from there: the changed lines are one region, the added lines another, and
  the rows below line up. A lane's rows are now hashed over the rows and
  columns the warp actually covers: the coverage mask is eroded at the
  edges, so a lane's last rows never matched and an insertion above them
  slid to the bottom of the lane.
- The viewer continued the row next to a gap under the gap's tint, which on
  a line of text drew a barcode. Each column of a gap now shows the colour
  it shows most often in the 48 rows on either side (page and card
  backgrounds stay, text goes). The engine writes those colours as
  `gaps.png`, one row per gap, and the pair page passes it as `gaps-src`, so
  a report opened from `file://`, where the browser refuses pixel reads,
  draws the same fill.

## [0.1.6] - 2026-09-16

### Fixed

- Text laid out at fractional positions lands a row lower here and a row
  higher there, and the exact row alignment recorded that as one-row
  deletes and inserts around every line: hairline gaps in the viewer and
  clutter in the Structure list. A one-row gap between bands whose offsets
  differ by one is folded into one band once the map has been chosen, a
  one-row gap at the edge of a lane is taken into its lane, and such a gap
  no longer counts towards opening a lane zone; the differ already treats a
  one-pixel shift as no change.
- The viewer drew inserted and removed rows as a tinted gap with nothing
  under it, so on a dark page the page's own background showed through as a
  bright bar. The row just outside the gap is now continued under the tint.

## [0.1.5] - 2026-09-16

### Added

- Lane alignment: when side-by-side columns move independently (a card
  whose left column gains a line while its right column stays), the row
  alignment leaves a stretch of short bands, inserts and deletes that make
  unchanged text look changed. Such a conflict zone is now cut at its
  gutters into lanes, each lane is aligned on its own, and the lane bands
  replace the zone's bands when they pair at least as many content cells
  exactly. Bands carry `columns` in `report.json`; the viewer draws each
  lane in its own row space and the pair page's Structure section names
  the lane. Padding that grew in a lane that did not (a card's inner
  margin) is not a region. The UI lab gained an eighth build for it.
- The viewer's toolbar has a "Hide regions" checkbox (attribute
  `hide-regions`, key `r`) that hides the region boxes in every mode,
  including Diff, so the pixels underneath can be read; the pair page has
  the same checkbox next to the mode buttons.

### Fixed

- Rows of a gap with no edge whose colour matches the flat rows just
  outside it are padding that grew, whatever the colour; they no longer
  become an "added" or "removed" region of a card's background.

## [0.1.4] - 2026-09-16

### Changed

- Same-scale captures are aligned row by row: every row is hashed and the two
  sequences are aligned like lines of text (unique rows as anchors, common
  prefix and suffix, substitutions where nothing is distinctive). An opened
  FAQ answer is an insertion of exactly its height, the rows below it keep
  their pixels, and a table row appended after look-alike rows is never paired
  with the row above it. The 8 px strip alignment stays for resampled pairs
  and for any page where it explains more pixels; the exact-cell count
  arbitrates. On the UI lab this took the regions on elements nobody changed
  from 19 to 1 with all 35 planted changes still found.
- Pairs of the same width up to 1920 px are compared at their own size
  instead of being brought to `workingWidth`, so a 1440 px capture keeps its
  rows exact below an inserted block.
- A region's density is measured over a box at least 4 px on each side, so a
  border that moved by one pixel no longer scores like a solid block.

### Fixed

- Padding that grew or shrank next to a border line produced an "added" or
  "removed" sliver of one or two rows; gaps made only of such slivers are
  padding.
- A run of flat rows at the top or bottom of both captures (page padding)
  no longer anchors the alignment, so a capture that shows less of the page
  than the other is treated as a crop again, not as content that moved.

## [0.1.3] - 2026-09-15

### Fixed

- The slider handle and the region chip sat inside the viewer's scroll
  container, so on a page taller than the stage they scrolled away with the
  image and the handle covered only the top of it. They now sit in a frame
  around the scroll container and stay in view; the reveal edge follows the
  stage's horizontal scroll under a zoom. The stage is wrapped in a box with
  its scaled layout size, so a vertical scrollbar no longer brings a
  horizontal one, and the stage refits when the scrollbar appears.

## [0.1.2] - 2026-09-15

### Fixed

- The viewer sized its stage to the baseline, so a section the candidate
  inserted (a new card at the bottom of a page) fell outside the stage and an
  added region was drawn as a 4 px line. With a warped candidate and a band
  map that has inserted or deleted rows, both sides are now drawn band by
  band into one row space: inserted rows are a tinted gap on the baseline
  side, deleted rows a gap on the candidate side, region boxes are mapped
  into that space and the diff tint covers the gaps. A warped candidate
  taller than the baseline extends the stage even without a band map.

### Added

- The pair page has a "Structure" section: one line per block of rows that
  exists on one side only, with the element behind it and the height change,
  so a 65% similarity caused by one added card reads as one added card.

## [0.1.1] - 2026-09-14

### Changed

- NOTICE reproduces pixelmatch's ISC licence text for the ported colour
  distance in `src/engine/pure/yiq.ts`; the file header says so too.
- The UI lab's "Lumen" page is labelled as a fictional product.

## [0.1.0] - 2026-09-14

First public release.

### Added

- Feature alignment with ORB keypoints and RANSAC, snapped to a similarity
  transform or to a whole-pixel shift, so zoomed, cropped and shifted
  captures line up before any pixel is compared.
- Structural alignment: the page is cut into horizontal strips that are
  matched by sequence alignment, so inserted banners and collapsed sections
  become one region each instead of moving everything below them.
- Region kinds added, removed, changed and moved, with move detection by
  template matching, a score per region and a box on both sides.
- Element maps recorded by the Playwright capture adapter; every region is
  attributed to the smallest element covering it (test id, id, role and
  name, then a CSS path). Resized elements are reported from the maps.
- Reports: a summary page, a page per pair with the embeddable
  `<elastishot-viewer>` web component (slider, flip, blink, overlay, diff),
  `report.json` (schema `elastishot.report/1`) and JUnit XML.
- CLI: `compare`, `snapshot`, `run`, `approve`, `report`; a config file with
  targets and viewports; exit codes 0, 1 and 2 for CI.
- Capture options for full-page screenshots, waits, hidden and masked
  selectors, a colour scheme and headers; captures record the HTTP status
  and title, and error pages raise a `CAPTURE_ERROR_PAGE` warning.
- Node API (`comparePair`, `createElastishot`, `loadConfig`) and a plugin
  and reporter contract for embedding in larger tools.
- Four test tiers: unit, engine, browser and Gherkin acceptance scenarios
  driving the built CLI; a UI lab with ground truth under `examples/ui-lab`.

[Unreleased]: https://github.com/Osman19702/elastishot/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Osman19702/elastishot/compare/v0.1.7...v0.2.0
[0.1.7]: https://github.com/Osman19702/elastishot/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Osman19702/elastishot/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Osman19702/elastishot/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Osman19702/elastishot/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Osman19702/elastishot/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Osman19702/elastishot/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Osman19702/elastishot/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Osman19702/elastishot/releases/tag/v0.1.0
