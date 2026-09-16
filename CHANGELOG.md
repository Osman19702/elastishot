# Changelog

All notable changes to Elastishot are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/Osman19702/elastishot/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/Osman19702/elastishot/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Osman19702/elastishot/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Osman19702/elastishot/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Osman19702/elastishot/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Osman19702/elastishot/releases/tag/v0.1.0
