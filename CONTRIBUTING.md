# Contributing

Thank you for looking under the hood. The fastest way to improve Elastishot
is a pair of screenshots it gets wrong: open an issue with both images (or
both URLs) and what you expected. Real pairs move the roadmap.

## Developer Certificate of Origin

Contributions are accepted under the MIT licence of this repository. Every
commit must carry a `Signed-off-by` line certifying the
[Developer Certificate of Origin](https://developercertificate.org/) (the
full text is in the `DCO` file):

```
git commit -s -m "fix: describe the change"
```

The sign-off says that you wrote the change or have the right to submit it
under the project licence. Pull requests with unsigned commits are not
merged. There is no contributor licence agreement.

## Setting up

```
npm ci
npx playwright install chromium   # for the browser and acceptance tiers
npm run test:all                  # typecheck, layering, all four tiers, trace
```

Node 22.18 or newer runs the TypeScript sources directly for the tests; the
published package supports Node 20.

| Tier | Command | What it covers |
|---|---|---|
| unit | `npm test` | pure modules under `src/**/*.test.ts` |
| engine | `npm run test:engine` | comparisons through opencv.js on synthetic pages |
| browser | `npm run test:browser` | capture, viewer and CLI workflow in Chromium |
| acceptance | `npm run test:acceptance` | Gherkin scenarios in `acceptance/features` driving the built CLI |

`npm run test:trace` fails when a scenario has no test, so a new scenario
needs a test with the same id (see `docs/ATDD.md`).

## Style

ESM, two-space indent, no semicolons, single quotes, `node:test`, no linter
or formatter. Comments explain why, not what. Keep the browser-safe packages
(`src/core`, `src/engine`, `src/locators`, `src/report`, `src/viewer`) free
of Node built-ins; `npm run check:layering` enforces it.

## Pull requests

- One change per pull request, with a test where the change is testable.
- Update `CHANGELOG.md` under "Unreleased".
- Do not bump the version; releases are cut by the maintainer.
