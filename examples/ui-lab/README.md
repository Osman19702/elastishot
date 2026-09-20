# Lumen UI lab

A localhost test bed for Elastishot. `site.mjs` renders "Lumen", a small
product page for a fictional product (any resemblance to a real company or
product is accidental), in ten builds:

| Build | Scenario | What changes |
|---|---|---|
| 1 | baseline | the approved page |
| 2 | new-elements | promo banner, fifth feature card, new nav link, Enterprise plan |
| 3 | text-changes | one digit in the version badge, a price, a renamed button, an appended sentence, a fixed typo, a stat |
| 4 | shifts | illustration to the left, two cards swapped, pricing above features, stat cards spread out |
| 5 | expansions | every FAQ answer open, three more changelog rows, taller hero, a feature text that wraps |
| 6 | images | recoloured illustration with a new shape, a swapped icon, new sparkline data |
| 7 | release | banner, bumped version, one FAQ opened, new sparkline and a renamed button, on desktop and on a 390 px phone |
| 8 | columns | the hero copy wraps to one more line while the illustration beside it stays |
| 9 | card-added | a "Latest release" section: a card with a picture across it and two columns of text below the picture |
| 10 | card-columns | against build 9: the card's picture redrawn in place, a list item and a note more in the left column, a line more and two edits in place in the right column |

Every build's changes are listed in `BUILDS` with the `data-testid` of the
element and the kind of change a tester expects. That list is the ground
truth the lab scores Elastishot against, and it is also where the scenarios
come from: `elastishot.config.js` derives its targets from `BUILDS`, and
`verify.mjs` refuses to score a pair whose captured URL is not the build the
ground truth names, so a build number cannot be right in one file and wrong
in another.

A build is compared with build 1 unless its entry says `before`. Build 10
changes the card that build 9 introduced, so it is compared with build 9.
The card is not part of build 1 on purpose: a region's score is relative to
the page's area, so a taller build 1 would move the numbers of every other
scenario (the one noise region of `shifts` drops from 0.21 to 0.19, under
the lab's cut, with no change to the engine).

Build 10 is the page that 0.1.7 got wrong: the picture changed in place, so
the rows above the columns looked unsettled as a whole, the columns were
never separated, and the new lines came out as two stripes across the whole
card with unchanged text reported as changed beside them. The picture is
dense where the card's gutter runs, like a real screenshot; with a picture
that is flat there the page's own middle gutter hides the defect.

## Run it

```
npm run build                      # the CLI the lab drives
node examples/ui-lab/run-lab.mjs   # add --no-video to skip the recording
```

The script builds the site into `dist/`, serves it on `http://127.0.0.1:4321`,
approves every scenario's "before" build as its baseline (`elastishot run
--update` with `LAB_BASELINE=1`), runs the scenarios against their "after"
builds (`elastishot run --junit`), scores the run (`verify.mjs`), records the
walkthrough (`record.mjs`, Playwright's WebM recorder) and writes
`report/index.html` (`make-report.mjs`). The Elastishot reports themselves
are in `.elastishot/runs/<run>/`.

Everything under `dist/`, `.elastishot/` and `report/` is generated and
ignored by git.
