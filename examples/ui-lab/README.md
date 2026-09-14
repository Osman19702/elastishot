# Lumen UI lab

A localhost test bed for Elastishot. `site.mjs` renders "Lumen", a small
product page for a fictional product (any resemblance to a real company or
product is accidental), in seven builds:

| Build | Scenario | What changes |
|---|---|---|
| 1 | baseline | the approved page |
| 2 | new-elements | promo banner, fifth feature card, new nav link, Enterprise plan |
| 3 | text-changes | one digit in the version badge, a price, a renamed button, an appended sentence, a fixed typo, a stat |
| 4 | shifts | illustration to the left, two cards swapped, pricing above features, stat cards spread out |
| 5 | expansions | every FAQ answer open, three more changelog rows, taller hero, a feature text that wraps |
| 6 | images | recoloured illustration with a new shape, a swapped icon, new sparkline data |
| 7 | release | banner, bumped version, one FAQ opened, new sparkline and a renamed button, on desktop and on a 390 px phone |

Every build's changes are listed in `BUILDS` with the `data-testid` of the
element and the kind of change a tester expects. That list is the ground
truth the lab scores Elastishot against.

## Run it

```
npm run build                      # the CLI the lab drives
node examples/ui-lab/run-lab.mjs   # add --no-video to skip the recording
```

The script builds the site into `dist/`, serves it on `http://127.0.0.1:4321`,
approves build 1 as the baseline of every scenario (`elastishot run --update`
with `LAB_BASELINE=1`), runs the scenarios against their "after" builds
(`elastishot run --junit`), scores the run (`verify.mjs`), records the
walkthrough (`record.mjs`, Playwright's WebM recorder) and writes
`report/index.html` (`make-report.mjs`). The Elastishot reports themselves
are in `.elastishot/runs/<run>/`.

Everything under `dist/`, `.elastishot/` and `report/` is generated and
ignored by git.
