# Data formats

All documents carry a `schema` field with a version; consumers should check it.

## Element map: `elastishot.element-map/1`

Written next to a capture as `<image>.map.json` (`baseline.map.json`, `candidate.map.json`). Boxes are in image pixels: CSS pixels times the device pixel ratio, plus the scroll offset, so they are directly comparable with the PNG and with diff regions.

```json
{
  "schema": "elastishot.element-map/1",
  "url": "http://127.0.0.1:4173/v1/",
  "capturedAt": "2026-09-11T18:00:00.000Z",
  "viewport": { "width": 1280, "height": 800 },
  "dpr": 1,
  "fullPage": true,
  "image": { "width": 1280, "height": 1642 },
  "truncated": false,
  "elements": [
    {
      "i": 12,
      "locator": "[data-testid=\"cta\"]",
      "strategy": "testid",
      "tag": "button",
      "name": "Get started",
      "text": "Get started",
      "box": { "x": 60, "y": 306, "w": 143, "h": 47 },
      "parent": 10,
      "fixed": false
    }
  ]
}
```

- `locator` is Playwright-selector compatible. Strategy priority: `testid` (`data-testid`, `data-test`, `data-cy`; `>> nth=k` when repeated), `id` (hand-written, unique ids only; framework-generated ids are rejected), `role` (implicit or explicit role plus accessible name, only when unique), `css` (`tag:nth-of-type(n)` segments anchored at the nearest ancestor with a test id or id, else `body`).
- `name` is the accessible name, else the text, else `tag#id`, else the tag. `text` is the element's own text (direct text nodes), omitted when empty or when capture ran with `elementMap: { text: false }`.
- `parent` is the index of the nearest ancestor that is itself in the map, or `null`.
- `fixed` marks `position: fixed` or `sticky` elements, whose full-page position is where the browser painted them first.
- Elements are skipped when invisible (no client rects, `visibility: hidden`, `opacity: 0`) or smaller than `minSize` (4 px). `truncated` is true when `maxElements` (5000) was hit.

## Snapshot meta: `elastishot.snapshot/1`

`meta.json` in a baseline or candidate folder.

```json
{
  "schema": "elastishot.snapshot/1",
  "url": "http://127.0.0.1:4173/v1/",
  "capturedAt": "2026-09-11T18:00:00.000Z",
  "viewport": { "width": 1280, "height": 800, "deviceScaleFactor": 1 },
  "dpr": 1,
  "fullPage": true,
  "elastishotVersion": "0.1.0",
  "target": "home",
  "viewportName": "desktop",
  "approvedAt": "2026-09-12T09:00:00.000Z",
  "approvedFrom": "C:/work/.elastishot/runs/2026-09-12T08-59-10Z"
}
```

## Report: `elastishot.report/1`

`report.json` in a run folder. Paths are relative to the run folder; thumbnails are data URIs.

```json
{
  "schema": "elastishot.report/1",
  "createdAt": "2026-09-12T09:00:00.000Z",
  "elastishotVersion": "0.1.0",
  "runId": "2026-09-12T09-00-00Z",
  "config": { "threshold": 0.98, "failOn": ["added", "removed", "changed", "moved"] },
  "totals": { "pairs": 1, "passed": 0, "failed": 1, "new": 0, "errors": 0 },
  "pairs": [
    {
      "id": "home--desktop",
      "name": "home",
      "target": "home",
      "viewport": { "name": "desktop", "width": 1280, "height": 800 },
      "status": "failed",
      "failReasons": ["similarity 0.876 is below the threshold 0.98", "2 removed regions at or above score 0.05"],
      "baseline": { "source": "baselines/home/desktop", "image": "pairs/home--desktop/baseline.png", "map": true, "size": { "width": 1280, "height": 1642 } },
      "candidate": { "source": "http://127.0.0.1:4173/v2/", "image": "pairs/home--desktop/candidate.png", "map": true, "size": { "width": 1280, "height": 1476 } },
      "summary": { "passed": false, "similarity": 0.876, "counts": { "added": 1, "removed": 2, "changed": 3, "moved": 0 }, "alignMethod": "features-similarity", "scale": 1, "warnings": [] },
      "alignment": { "method": "features-similarity", "transform": { "kind": "translation", "m": [1, 0, 0, 0, 1, 0, 0, 0, 1] }, "scale": 1, "confidence": 0.93, "bandMap": [] },
      "regions": [
        { "id": "r5", "kind": "removed", "boxBaseline": { "x": 52, "y": 1041, "w": 1176, "h": 99 }, "boxCandidate": null, "anchorCandidate": { "x": 52, "y": 1041 }, "score": 1, "confidence": 0.97, "tags": ["deleted-rows"] }
      ],
      "locators": {
        "coverage": "both",
        "changedLocators": [
          { "locator": "#faq > dl:nth-of-type(1)", "name": "Does it need a baseline? ...", "strategy": "css", "kinds": ["removed"], "regions": ["r5"], "presence": "baseline-only", "evidence": ["pixels", "map"], "score": 1 }
        ],
        "byRegion": [],
        "unmapped": [],
        "warnings": []
      },
      "artifacts": { "diff": "pairs/home--desktop/diff.png", "overlay": "pairs/home--desktop/overlay.png", "warped": "pairs/home--desktop/warped.png", "report": "pairs/home--desktop/report.html", "thumbs": { "baseline": "data:image/jpeg;base64,..." } },
      "durationMs": 2310
    }
  ]
}
```

Region kinds: `added` (present only in the candidate; `boxBaseline` is null and `anchorBaseline` says where it would sit), `removed` (the mirror), `changed`, `moved` (same content at another position). `score` is a severity 0..1; regions below `minRegionScore` (0.05) never fail a comparison.

Coordinates: `boxBaseline` in baseline pixels, `boxCandidate` in candidate pixels, `alignment.transform` maps candidate pixels to baseline pixels as a 3x3 row-major matrix. Band ranges in `alignment.bandMap` are baseline rows; a band's candidate range is the candidate after warping into baseline space.
