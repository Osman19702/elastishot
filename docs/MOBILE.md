# Elastishot for mobile and React-Native-web apps: notes

Written 16 Oct 2026 against Elastishot 0.2.0 (`C:\Projects\elastishot`) and Savrendo
(Expo SDK 57, RN 0.86, Expo Router, no native modules, `scheme: savrendo`, no
`android.package` / `ios.bundleIdentifier`, no `eas.json`). Facts about Elastishot come
from its source; facts about Expo, Maestro, Detox and Appium come from the pages listed
under *Sources*. Anything marked **(memory)** was not verified against a document and
should be checked before it is relied on. Every flow and YAML below is **untested**.

## 1. What works today with no change

**Image-pair mode is complete.** `elastishot compare a.png b.png` goes through
`resolveInput` → `resolvePath` (`src/node/inputs.ts`): a PNG/JPEG path, a baseline folder
(`baseline.png` + `baseline.map.json` + `meta.json`) or an image URL. It writes the usual
run folder (`report.json`, `index.html`, `pairs/<id>/report.html` with the viewer, `junit.xml`
with `--junit`) and exits 1 on differences. Nothing in the engine knows about browsers.

**The sidecar map is read for plain PNGs.** `resolvePath` calls `readSidecarMap(p)`:
`shot.png` + `shot.map.json` gives named locators with no core change. `isElementMap`
(`src/locators/element-map.ts`) checks only `schema`, `image.{width,height}` and that every
entry has string `locator`, `name`, `tag`, `strategy` and a `box`; `parent`, `fixed`, `url`
are not validated. So a native accessibility hierarchy converted to
`elastishot.element-map/1` (boxes in device pixels = PNG pixels) already names regions,
drives `presenceDiff` (added/removed/resized elements) and reaches the JUnit failures. The
converter is the missing piece (enhancement E3), not the engine.

**Without a map the report cannot name anything.** `mapLocators` returns
`coverage: 'none'`, the warning "no element maps were supplied, so regions cannot be
named", empty `changedLocators`, and `unmapped` is not even computed. Regions are boxes
with kind, score, tags; the viewer modes (slider, flip, blink, overlay, diff) still work.

**Alignment on device screenshots** (`src/engine/stages/preprocess.ts`, `global-align.ts`,
`structural-align.ts`):

- Same device, same size (e.g. 1080×2400 or 1179×2556): equal widths ≤ 1920 are compared
  at their own size (`workingScales`), no resampling, `antialiasTolerance: 'auto'` = 0.
  Row-hash structural alignment handles the RN case that matters most, a vertical stack
  that gained or lost rows (a list row, a banner, a longer label): rows below stay exact.
  Content pushed off the bottom of the screen is reported as `removed` rows at the bottom;
  the tab bar, fixed on both sides, aligns as a matched band after the gap.
- Different sizes or DPR: both sides go to the smaller width (capped at `workingWidth`
  1280). ORB + RANSAC recovers scale and shift, snapped to a similarity. DPR 2 vs 3 (1.5×)
  and iPhone 1179 vs Pixel 1080 (1.09×) are inside the stated limit (about 2× per step),
  but different platforms also mean different fonts, bars and insets, so the result is
  noisy rather than wrong. The `IMAGE_DOWNSCALED` warning fires only below 50 %.
- Status bar, notch, Dynamic Island, home indicator: the engine has no device awareness.
  The clock, battery and signal glyphs change between captures and come back as small
  `changed` regions at the top; with `failOn` including `changed` and `minRegionScore`
  0.05 they can fail a pair whose similarity is 0.999. The notch / island is static black
  and the home indicator is static, so they cost nothing. What exists today:
  `compare.ignoreRegions` (baseline pixels) and `compare.ignoreRegionsCandidate` in
  `elastishot.config.js`; the `compare` command loads the config from cwd and merges
  `config.compare`, so a status-bar mask works for PNG pairs now, e.g.
  `compare: { ignoreRegions: [{ x: 0, y: 0, w: 1080, h: 64 }], ignoreRegionsCandidate: [{ x: 0, y: 0, w: 1080, h: 64 }] }`
  (64 px ≈ 24 dp × 2.625 on a Pixel 6; measure once in the viewer). There is no
  `--ignore` CLI flag.
- Screens, not pages: Maestro, Detox and Appium capture the screen, so a long screen is
  several screenshots and several pairs; `--viewport`, `--full-page`, `--hide` and
  `--wait-for` only apply to page URLs and are ignored for PNG pairs.
- Memory: an iPhone 15 Pro Max shot is 1290×2796 (3.6 MP), well under what full-page web
  captures already cost.

**Gaps in image-pair mode, to be honest about:** `compare` writes one run folder per pair
(`compare()` in `src/node/elastishot.ts` takes a single baseline/candidate), so N
screenshots = N run folders and N `index.html`; `approve` only promotes pairs that carry a
`target` and `viewport.name`, which compare-mode pairs do not, so "approve" is a file copy;
`snapshot` captures only URLs (`#capture`), so there is no command that turns a PNG into a
baseline folder; `targets[].url` must match `^https?://` (`validateConfig`), so `run` is
closed to native screenshots. Enhancement E1 fixes all four.

**Savrendo on the web works today, unchanged.** `dist/` is a static export with one HTML
file per route; serve it and point a souklore-style config at it
(`viewports: [{ name: 'phone', width: 390, height: 844, deviceScaleFactor: 2 }]`,
`capture: { colorScheme: 'dark' | 'light' }`). react-native-web renders `testID` as
`data-testid` and `accessibilityLabel` as `aria-label` **(memory; confirm once in the
DOM)**, so the Playwright element map gets `testid` and `role` locators for free. That is
also the web half of the cross-platform drift check (E6).

## 2. A recipe Savrendo could use now on Expo

Pipeline: Maestro flow → `takeScreenshot` PNGs → `elastishot compare` per pair → JUnit +
run folders. Expo Go locally (Windows + Android emulator); an EAS-built APK in the cloud.

### What the documents establish

- Maestro `takeScreenshot: name` writes `<name>.png` into the flow's artifact bundle under
  `takeScreenshot/`; `path` may contain subdirectories, not `..`. Default bundle location
  `~/.maestro/tests/<timestamp>/<flow-name>/` (Windows: `%userprofile%\.maestro\tests`);
  the bundle also holds `commands.json`, `logs/`, `screenshots/` (failed steps only),
  `screen-hierarchy/` (view hierarchy JSON) and `startRecording/`. `--test-output-dir`
  moves screenshots, video and `commands.json`; `--flatten-debug-output` drops the
  per-run subfolders and timestamps; `--format junit --output build/report.xml` writes the
  report outside those folders.
- Expo Go cannot be targeted with `launchApp` + the app's own `appId`; the Maestro RN page
  says to `openLink` the dev URL instead (its example still shows port 19000; Expo's own
  linking page uses `exp://127.0.0.1:8081/--/<path>`, and SDK 57 serves on 8081). In Expo
  Go the `/--/` separator carries the route; a development or release build uses the
  app's scheme, `savrendo://<path>`, and needs a new build after the scheme is set.
- Maestro `id` = `accessibilityIdentifier` on iOS and the Android resource id; `text` =
  visible text, `accessibilityLabel` (iOS), `contentDescription` and `hint` (Android);
  all text selectors are regular expressions. RN `testID` is what Maestro maps to `id`.
- `launchApp` has `clearState`, `stopApp`, `permissions`, `arguments`; `openLink` takes a
  custom-scheme link; `waitForAnimationToEnd` waits up to 15 s and then continues even if
  the screen still moves (it never fails).
- Maestro `assertScreenshot` exists (`thresholdPercentage`, default 95, optional
  `cropOn`). It is a plain percentage match of a reference PNG; it does not align, name
  or explain. Elastishot replaces it, it does not compete with `takeScreenshot`.
- EAS Workflows: the `maestro` job takes `build_id` + `flow_path` (file, list or
  directory), optional `device_identifier` (`pixel_6`, `iPhone 16 Plus`, or
  `{ android, ios }`), `android_system_image_package`
  (`system-images;android-36;google_apis;x86_64`), `maestro_version`, `shards`,
  `retries`, `record_screen`, `output_format` (default `junit`), and `hooks`
  (`after_checkout`, `before_maestro_tests`, `after_maestro_tests`) whose steps may `run`
  shell and `uses: eas/upload_artifact` (`path` required; `type`, `name`, `metadata`,
  `ignore_error`). Screenshots and recordings land in the "Maestro Test Results"
  artifact. Android needs `runs_on: linux-large-nested-virtualization`; iOS runs on macOS
  runners. The build profile for E2E is `withoutCredentials: true` + `android.buildType:
  apk`, or `ios.simulator: true`.
- Custom build steps also exist: `eas/install_maestro`, `eas/start_android_emulator`
  (`device_name`, `system_image_package`), `eas/start_ios_simulator`, `eas/maestro_test`
  (`flow_path`, `app_path`), `eas/download_build`; the example uploads
  `${ eas.env.HOME }/.maestro/tests` as a `build-artifact`. That path is the best evidence
  of where the pre-packaged job leaves the PNGs; confirm it from the first job log.
- `npx expo run:ios` needs Xcode, so on Windows iOS is EAS-only (`eas build -p ios
  --profile <simulator profile>`; `eas build:run -p ios --latest` only on a Mac). Android
  locally: `eas build:run -p android --latest` or `adb install`.

### Local run on the Android emulator (Windows)

1. Emulator: Pixel 6, API 34, x86_64 Google APIs, GPU mode pinned (software vs host GPU
   renders differently; keep one). Maestro CLI installed on Windows (the artifacts page
   lists a Windows path, so Windows is supported for Android).
2. Freeze the device before every session (one script, **memory** for the exact
   commands):
   `adb shell settings put global window_animation_scale 0`,
   `... transition_animation_scale 0`, `... animator_duration_scale 0` (RN Android reads
   `transition_animation_scale == 0` as reduce-motion, which also flips Savrendo's
   `useReducedMotion`); demo-mode status bar:
   `adb shell settings put global sysui_demo_allowed 1`, then
   `adb shell am broadcast -a com.android.systemui.demo -e command enter`,
   `... -e command clock -e hhmm 0941`, `... -e command battery -e level 100 -e plugged false`,
   `... -e command network -e wifi show -e level 4 -e mobile show -e datatype none -e level 4`,
   `... -e command notifications -e visible false`; font scale
   `adb shell settings put system font_scale 1.0`; appearance
   `adb shell cmd uimode night no|yes`; locale pinned to en-GB (Savrendo resolves en/tr
   from `expo-localization`).
3. `npx expo start`, then `a` (opens Expo Go in the emulator and sets up `adb reverse`
   for 8081, **memory**). First bundle takes 30–60 s on this machine (the cold jest run
   already showed how slow a first pass is): give the first wait 90 s.
4. Flow, `.maestro/plate-home.yaml` (**untested**; the `id`s do not exist yet, see the
   Savrendo checklist; today only `shopping-row-<key>` is a real testID, the primitives
   accept `testID` but screens rarely pass one):

```yaml
appId: host.exp.exponent            # Expo Go on Android (memory). A built app: android.package from app.json
env:
  APP_URL: exp://127.0.0.1:8081/--/  # Expo Go. Built app: savrendo://   (pass -e APP_URL=... to override)
---
- launchApp:
    stopApp: true
    clearState: false                # true would wipe Expo Go itself; reset through the app instead
- openLink: ${APP_URL}
- extendedWaitUntil:
    visible:
      id: plate-home|onboarding-start   # regex: whichever screen the stored state leads to
    timeout: 90000
- runFlow:                           # first run on a fresh device: get through onboarding
    when:
      visible:
        id: onboarding-start
    file: onboarding.yaml
- waitForAnimationToEnd
- hideKeyboard
- takeScreenshot: plate-home         # -> <output>/plate-home/takeScreenshot/plate-home.png
- tapOn:
    id: tab-shopping
- waitForAnimationToEnd
- takeScreenshot: shopping
- openLink: ${APP_URL}me             # Expo Go: exp://host:8081/--/me ; built app: savrendo://me
- waitForAnimationToEnd
- takeScreenshot: me
- openLink: ${APP_URL}preferences    # a modal: the dimmed plate behind it is in the picture (see 4)
- waitForAnimationToEnd
- takeScreenshot: preferences
```

   Notes: Savrendo's `Stack.Protected` sends any deep link to `/onboarding` until
   `onboarded` is true, so the flow must branch (`runFlow` + `when`) or reset first.
   `extendedWaitUntil` on an element, never a fixed sleep: the splash stays up until
   hydration (`SplashScreen.preventAutoHideAsync` in `src/app/_layout.tsx`) and a sleep
   captures `#FBF6EF` with the icon.
5. Run: `maestro test --test-output-dir .maestro-out --flatten-debug-output --format junit --output .maestro-out/maestro.xml .maestro/plate-home.yaml`
   → expect `.maestro-out/plate-home/takeScreenshot/plate-home.png` (check the actual
   layout once; the docs describe the flags, not the final tree under both flags).
6. Compare, one call per screenshot (until E1 lands):
   `npx elastishot compare baselines/native/pixel_6-api34-light/plate-home.png .maestro-out/plate-home/takeScreenshot/plate-home.png --name plate-home --junit --out .elastishot/runs/native/plate-home`
   with the status-bar masks in `elastishot.config.js` as in section 1. A
   `scripts/visual-native.mjs` (not written) loops the PNGs, aggregates exit codes, and
   with `--update` copies candidates over baselines (compare-mode pairs cannot be
   `approve`d). Baseline folder name = device + API level + appearance; never mix.

### EAS workflow sketch (**untested**)

`eas.json` (new; also set `expo.android.package`, e.g. `com.osman.savrendo`, which
becomes the Maestro `appId` for the built APK):

```json
{
  "build": {
    "e2e-test": { "withoutCredentials": true, "android": { "buildType": "apk" } },
    "e2e-test-ios": { "withoutCredentials": true, "ios": { "simulator": true } }
  }
}
```

`.eas/workflows/visual-android.yml`:

```yaml
name: visual-android
on:
  pull_request:
    branches: ['*']
jobs:
  build_android:
    type: build
    params:
      platform: android
      profile: e2e-test
  maestro:
    needs: [build_android]
    type: maestro
    runs_on: linux-large-nested-virtualization
    params:
      build_id: ${{ needs.build_android.outputs.build_id }}
      flow_path: ['.maestro/plate-home.yaml']
      device_identifier: pixel_6
      android_system_image_package: system-images;android-36;google_apis;x86_64
    hooks:
      before_maestro_tests:
        - name: Freeze the emulator            # animation scales, demo-mode clock, font scale (memory)
          run: bash scripts/freeze-android.sh
      after_maestro_tests:                     # unknown whether this runs after a failed flow: check
        - name: Compare against committed baselines
          run: |
            set -e
            OUT="$HOME/.maestro/tests"          # from the custom-build example; confirm in the job log
            for shot in plate-home shopping me preferences; do
              cand=$(find "$OUT" -path '*takeScreenshot*' -name "$shot.png" | head -1)
              npx --yes elastishot@0.2.0 compare "baselines/native/pixel_6-api36-light/$shot.png" "$cand" \
                --name "$shot" --junit --out ".elastishot/runs/$shot" || true
            done
        - uses: eas/upload_artifact
          with:
            path: .elastishot/runs
            name: elastishot
            type: build-artifact                # value taken from the custom-build schema; check it is accepted here
```

Open points: whether `node_modules` are installed in the maestro job (hence `npx --yes`
with a pinned version, or `npm ci` in `after_checkout`); whether the hook sees the
screenshots before they are packed into the artifact; `|| true` keeps the job green so the
Elastishot run folders upload, and the gate is then a separate step that reads the
`junit.xml` files, or E1's single `run`. iOS: the same job with the `e2e-test-ios` build
and an iPhone `device_identifier`, baselines in `baselines/native/iphone-16-ios18-light/`;
there is no local iOS path from Windows. A custom job
(`eas/download_build` → `eas/install_maestro` → `eas/start_android_emulator` →
`eas/maestro_test`) is the fallback when the output path of the pre-packaged job turns out
to be unreachable from the hook.

## 3. Enhancements for Elastishot, ranked by value/effort

### E1. File and command targets in `run`, `snapshot` and `approve` (high value, low effort)

- Problem: `targets[].url` must be http(s); `snapshot` only captures URLs; `compare`
  handles one pair per run folder; `approve` needs `target`/`viewport`. Native screenshots
  therefore live outside the baseline workflow.
- Change: `TargetConfig` gains `image: string` (a PNG path, sidecar map picked up) or
  `command: { run: string, image: string }` (spawn without a shell, then read the file);
  `url` stays for pages; exactly one of the three. `viewports` get a sibling `devices:
  [{ name, width, height, dpr }]` that a file target selects by name (no capture, only
  naming and the size check). `#runTarget` skips the adapter for file/command targets and
  calls `resolveInput(path)`. `snapshot --from shot.png --name plate-home --device pixel_6`
  writes a baseline folder from a file. `compare --pairs pairs.json` (array of
  `{ name, baseline, candidate }`) writes one run folder with N pairs.
- Modules: `src/node/config.ts` (validation, `TargetConfig`, `ResolvedTarget`),
  `src/node/elastishot.ts` (`#runTarget`, `snapshot`, `compare`), `src/cli/args.ts` and
  `commands/{run,snapshot,compare}.ts`, `docs/`, acceptance feature.
- Risks: baseline path `baselines/<target>/<viewport>/` is web-named; accept `device` as
  the second segment with no format change. `command` targets execute user config in CI:
  no shell, document it, `E_CAPTURE` on non-zero exit.

### E2. Device presets: masks and tolerances per device (medium value, low effort)

- Problem: status-bar glyphs and the home indicator fail every native pair; the only tool
  is raw pixel boxes repeated per target; fractional DPR (Pixel 6 = 2.625) puts hairlines
  on half pixels and produces antialiasing specks on a same-size pair where
  `antialiasTolerance: 'auto'` is 0.
- Change: `devices[]` entries carry `mask: { top, bottom, left, right }` in px (or dp ×
  dpr) and optional `compare` overrides (`diff.antialiasTolerance: 1`,
  `diff.threshold`). The mask expands into `ignoreRegions` and
  `ignoreRegionsCandidate` for the pair; a built-in table of approximate presets
  (`pixel_6`, `iphone-15`, …) marked approximate, with the advice to take the numbers from
  `useSafeAreaInsets()` × dpr or Appium `mobile: deviceScreenInfo.statusBarSize` /
  `mobile: viewportRect`. New warning `DEVICE_SIZE_MISMATCH` when a PNG is not the
  preset's size. The viewer draws masked bands hatched.
- Modules: `src/node/config.ts`, `src/core/options.ts` (boxes exist), `src/core/types.ts`
  (warning code), `src/report/pair.ts`, `src/viewer/`.
- Risks: insets differ by OS version, orientation and model, so presets drift; a full-band
  mask also hides a real change there (Savrendo flips `StatusBar style` with the theme),
  so masks should cover the glyph clusters, not the band, once E4 can do it by selector.

### E3. Native element maps from the accessibility hierarchy (high value, medium effort)

- Problem: no DOM, no names. Every native tool exposes an accessibility tree with frames:
  Maestro's artifact bundle (`screen-hierarchy/*.json`, and `maestro hierarchy` on
  stdout), `adb shell uiautomator dump` XML (`resource-id`, `content-desc`, `text`,
  `class`, `bounds="[l,t][r,b]"`, **memory** for the exact attribute set; Appium's
  UiAutomator2 page source carries the same names), Appium XCUITest `mobile: source`
  (`format: xml | json | description`, `excludedAttributes`; frames in points, scale from
  `mobile: deviceScreenInfo`), Detox `device.generateViewHierarchyXml(shouldInjectTestIds)`
  (string, all platforms), idb `ui describe-all --json` (AXLabel, AXUniqueId, frame;
  macOS only, **memory**: the command page could not be fetched).
- Change: an isomorphic `elastishot/maps` subpath with `fromMaestroHierarchy(json)`,
  `fromUiAutomatorXml(xml)`, `fromAppiumSource(xml | json, { platform, scale })`,
  `fromDetoxXml(xml)`, `fromIdbDescribe(json)` → `elastishot.element-map/1`. Mapping:
  testID / accessibilityIdentifier / resource-id → `strategy: 'testid'`, locator
  `id=<value>` (Maestro spelling, so a report line pastes into a flow); label /
  content-desc / text → `strategy: 'role'`, locator `text=<value>` with the native class
  as `tag`; everything else → `strategy: 'css'` with a `Type[n] > Type[m]` path. Boxes
  in device pixels; `parent` from nesting; `fixed` false. CLI `elastishot map <dump>
  --from maestro|uiautomator|appium-ios|appium-android|detox|idb --image shot.png`
  writes `shot.map.json`; `compare --map-baseline x --map-candidate y` overrides the
  sidecar. Optional `platform` field in the map (schema stays `/1`; `isElementMap`
  ignores unknown keys).
- Modules: new `src/maps/` (no new runtime dependency: a small SAX-style XML reader is
  enough for these flat dumps), `src/locators/element-map.ts` (document the locator
  spellings), `src/cli/`, `docs/ELEMENT-MAP.md`, fixtures from a real Pixel and a real
  iPhone dump under `test/fixtures/native/`.
- Risks: the dump must be taken at the same instant as the PNG (Maestro's
  `screen-hierarchy/` cadence is undocumented; Appium and adb are two calls); RN
  `accessible={true}` on iOS and `importantForAccessibility="no-hide-descendants"` on
  Android (Savrendo's `HIDE_CHILDREN_ANDROID`) collapse children into one node, so
  attribution is coarse inside grouped rows; RN exposes Android `testID` as `resource-id`
  through its accessibility delegate only since 0.64 (**memory**; verify with `maestro
  hierarchy`); FlatList virtualisation and off-screen rows are simply absent; repeated
  ids need `>> nth=k` as the DOM collector does.

### E4. Ignore by selector for native (medium value, low effort once E3 exists)

- Problem: in-app volatile elements (Cook timers, the greeting "Tonight · Friday", the
  shopping badge count) move with layout; pixel boxes do not follow them. Roadmap 0.2
  already lists ignore-by-selector for the web.
- Change: `ignore: ['id=cook-timer', 'text=/^(Tonight|Today) /']` per target; resolved
  through each side's map into `ignoreRegions` (baseline pixels) and
  `ignoreRegionsCandidate` (candidate pixels) before the engine runs; `IGNORE_UNRESOLVED`
  warning when a selector matches nothing; the report lists what was ignored and where.
- Modules: `src/pipeline.ts` (`comparePair` has both maps before `engine.compare`),
  `src/core/options.ts`, `src/node/config.ts`, `src/report/pair.ts`.
- Risks: a selector that also matches a container masks too much; keep exact-string and
  regex-on-name only, no CSS grammar for native.

### E5. Per-device baselines with recorded conditions (medium value, low effort)

- Problem: a baseline from a Pixel 6 API 34 light is silently aligned against a candidate
  from API 36 dark; nothing records why they differ.
- Change: optional `SnapshotMeta` fields `device`, `platform`, `osVersion`, `appVersion`,
  `locale`, `colorScheme`, `fontScale`, `reduceMotion` (schema `/1` keeps working), set
  from the device preset and `--meta key=value`; `run` warns `BASELINE_CONDITIONS_DIFFER`
  when they do not match and the pair page shows both rows; JUnit testcase names include
  the device.
- Modules: `src/core/types.ts`, `src/node/baselines.ts`, `src/report/{pair,junit}.ts`.
- Risks: none worth noting; keep every field optional.

### E6. Cross-platform drift: web vs native, iOS vs Android (lower value, medium effort)

- Problem: a pixel compare across platforms is noise (fonts, bars, insets). The useful
  question is "did this change land on one platform only?".
- Change: `elastishot drift <runA> <runB>` compares the *locator sets* of two runs
  (web before/after vs native before/after): changed locators present in one run and
  absent in the other become `PLATFORM_DRIFT` entries in a small summary; locators are
  normalised to the testID key (`[data-testid="x"]` ≡ `id=x`). A cheaper, map-only
  variant: `compare --maps-only a.map.json b.map.json` runs `presenceDiff` with a
  tolerance in dp (box / dpr) and skips pixels, so structure can be checked between an
  iPhone and a Pixel.
- Modules: new `src/report/drift.ts`, `src/locators/presence.ts` (dp tolerance),
  `src/cli/`.
- Risks: depends on E3 and on consistent testIDs on both platforms; low value until then.

### E7. Gallery and scroll-series mode (medium value, medium effort)

- Problem: a screen is several screenshots; Savrendo has a `/gallery` route of UI pieces
  that would make a natural component suite; fixed headers and tab bars repeat in every
  shot.
- Change: (a) `elastishot stitch s1.png s2.png … -o full.png` reuses the global aligner
  (`createEngine` with `alignMode: 'similarity'`) to find each overlap and compose one
  tall image, after masking the fixed bars from the device preset; (b) a Maestro flow
  pattern `scrollUntilVisible` + `takeScreenshot` with `cropOn: { id }` per gallery
  section, one pair per component, grouped by screen in the summary (`report.json` gains
  an optional `group` per pair; roadmap 0.3's component mode shares the grouping).
- Modules: `src/cli/commands/stitch.ts`, `src/engine/` (expose the alignment estimate
  without a diff), `src/report/summary.ts`.
- Risks: overscroll bounce and fading scroll indicators corrupt overlaps; sticky section
  headers break the single-translation assumption; the stitch should refuse when the
  inlier ratio is low rather than guess.

### E8. Capture adapter contract for native tools (medium value, medium effort)

- Problem: `CaptureAdapter` (`src/capture/index.ts`) is already injectable through
  `createElastishot({ capture })`, but its types import Playwright and the config rejects
  non-http targets, so a Maestro-backed adapter cannot be used from the CLI.
- Change: move `CaptureAdapter`, `CaptureTarget` and a Playwright-free `CaptureOptions`
  subset into `src/core/` or `src/node/`; keep Playwright behind
  `elastishot/capture` as the default adapter; let `url` carry a scheme the adapter
  understands (`maestro:.maestro/plate.yaml#plate-home`) once E1 relaxes validation;
  publish `elastishot-capture-maestro` as a separate package that runs the flow once per
  file (cache by flow path), returns `Snapshot` with the PNG, the map from
  `screen-hierarchy/` via E3 and meta from E5. Same shape later for Appium.
- Modules: `src/capture/index.ts`, `src/node/elastishot.ts`, `src/node/config.ts`,
  `package.json` exports, `scripts/check-layering.mjs`.
- Risks: one flow run per screenshot is slow (the cache matters); the adapter contract
  becomes public API before 1.0, so freeze it deliberately.

### E9. Small report items (low effort)

Show device, OS, appearance and masks on the pair page; use `id=` / `text=` locators in
the changed-elements table unchanged; write `junit.xml` testcase `classname` from the
device so CI dashboards split platforms; document in README *Limits* that native
screenshots are supported as image pairs and what the map converter needs.

## 4. Pitfalls specific to React Native screenshots

- **Animations.** Native animations are not frozen by a stylesheet. Savrendo's
  `useFadeOnChange` (RN Animated) is instant when `AccessibilityInfo.isReduceMotionEnabled`
  is true; Reanimated 4 honours the OS reduce-motion setting by default (**memory**). On
  Android set the three animation scales to 0 (RN reads `transition_animation_scale == 0`
  as reduce motion, **memory**); on iOS enable Reduce Motion in the simulator. Add Maestro
  `waitForAnimationToEnd` before every `takeScreenshot`, but remember it passes on timeout.
  Expo Router transitions (modal slide-up, tab switch) and expo-splash-screen's fade are
  animations too.
- **Keyboard.** A focused `TextInput` raises the keyboard, whose height, suggestion strip
  and theme depend on the OS image and locale; `hideKeyboard` first. The caret blinks on
  native (no `caret-color` trick): blur the field or mask it.
- **System fonts.** Savrendo loads no fonts; Roboto vs SF, and font versions per OS image
  and iOS release, change metrics. Baselines are per OS version. Pin `font_scale 1.0`; the
  tab bar height in `src/app/(tabs)/_layout.tsx` is computed from `fontScale` and the
  in-app text scale (`effectiveTextScale`), so a scaled device changes every screen.
- **Status bar.** Clock, battery, signal, notifications, Wi-Fi, and the `StatusBar style`
  that Savrendo flips with the theme. Android demo mode and iOS
  `xcrun simctl status_bar booted override --time 9:41 --batteryLevel 100 …` (**memory**)
  fix them; Detox has `device.setStatusBar()` on iOS only; Maestro has no command, so do
  it before the flow. Otherwise mask (E2) or ignore by selector (E4).
- **Dynamic Island, notch, corners, home indicator.** Static pixels, but different per
  model, and the safe-area insets move all content: one baseline per model. Rounded
  corners are rendered black in simulator screenshots.
- **Dark mode switching.** `userInterfaceStyle: automatic` follows the OS; iOS crossfades
  the switch, so wait after `adb shell cmd uimode night yes` / `xcrun simctl ui booted
  appearance dark` (**memory**). Maestro has `assertDarkMode` / `assertLightMode` but no
  set command (**memory**). Keep `-dark` and `-light` baselines like souklore does.
- **Expo Go's own UI.** The project loading screen with the progress bar, the first-open
  prompt for an `exp://` link, LogBox toasts at the bottom in `__DEV__`, the dev menu,
  slower dev-mode rendering, and `launchApp.clearState: true` wiping Expo Go itself. Use
  Expo Go locally for quick checks only; the EAS `e2e-test` APK (bundled JS, no Metro) is
  what the baselines should come from. Hide LogBox behind an e2e flag.
- **Splash timing.** `preventAutoHideAsync` holds the splash until stored state is
  hydrated (`AppShell` renders a plain `palette.bg` view meanwhile); Android 12+ also draws
  a system splash. Wait for a testID, never a sleep; first Metro bundle on Expo Go can take
  a minute.
- **Clock-dependent content.** `dayContext` switches "Today" to "Tonight" at 15:00 and
  names the weekday; `HistorySection` groups by `startOfDay(new Date())`; Cook timers tick
  on `Date.now()`; the first-launch seed is `Date.now() >>> 0`, so the generated plates
  differ per device unless seeded. `deps.now` in `src/state/index.tsx` is the one
  injection point; the app needs a test hook (a launch argument via Maestro
  `launchApp.arguments`, which does not reach Expo Go, or a `?clock=` query on the deep
  link like souklore's) before any home-screen baseline is stable.
- **Persisted state.** AsyncStorage survives between runs (and inside Expo Go per
  project); flows must reset through the app (`resetAll` on the Me screen) or branch on
  what is visible; the onboarding guard redirects every deep link until onboarded.
- **Modals.** `meal` and `preferences` are `presentation: 'modal'`: on iOS the dimmed
  parent card shows behind the sheet, so a change on the plate screen leaks into the modal
  pair; crop with Maestro `cropOn` or mask the top band.
- **Scroll artefacts.** Android overscroll glow, iOS bounce, fading scroll indicators
  (about a second), FlatList rows rendering late; wait, and disable indicators under the
  e2e flag.
- **GPU and density.** Emulator software rendering vs host GPU differs in antialiasing;
  `expo-glass-effect` blur depends on what is beneath and on the GPU; Pixel 6's 2.625 dpr
  puts 1-dp borders on half pixels. Pin the emulator GPU mode and give the device preset
  `diff.antialiasTolerance: 1`.
- **Navigation bar.** 3-button vs gesture navigation changes the bottom band and the
  `insets.bottom` that sizes the tab bar; pin it on the emulator.
- **Locale.** `expo-localization` picks en or tr; number and date formats follow the
  device; pin the emulator locale and keep per-locale baselines only if a locale is a
  shipped target.
- **Images.** `expo-image` transitions and progressive decode need a wait; plate art is
  SVG (`react-native-svg`), deterministic.

## 5. Notes to apply later

Elastishot (`C:\Projects\elastishot`):

- [ ] E1: `targets[].image` / `command` + `devices[]` in config; `run` and `approve` over pre-captured PNGs; `snapshot --from <png>`; `compare --pairs <json>` for N pairs in one run folder.
- [ ] E2: device presets with `mask` and per-device `diff` overrides; `DEVICE_SIZE_MISMATCH` warning; hatched masks in the viewer.
- [ ] E3: `src/maps/` converters (Maestro hierarchy JSON, uiautomator XML, Appium XCUITest/UiAutomator2 source, Detox XML, idb describe-all) → element-map/1 sidecars; `elastishot map` command; `compare --map-baseline/--map-candidate`.
- [ ] E4: `ignore` by `id=` / `text=/re/` resolved through the maps into both ignore lists; `IGNORE_UNRESOLVED`; list ignored elements in the pair page.
- [ ] E5: optional device/OS/locale/appearance/fontScale fields in `SnapshotMeta`; `--meta k=v`; `BASELINE_CONDITIONS_DIFFER`; device in JUnit names.
- [ ] E6: `elastishot drift <runA> <runB>` over normalised locator sets; `compare --maps-only` with dp tolerance.
- [ ] E7: `elastishot stitch` over a scroll series using the global aligner; per-pair `group` in `report.json` for gallery/component suites.
- [ ] E8: lift `CaptureAdapter` out of the Playwright module; allow scheme-tagged `url`; publish `elastishot-capture-maestro` with a per-flow cache.
- [ ] Docs: a "Mobile apps" page with the Maestro recipe, the mask config and the converter; README *Limits* paragraph on native screenshots.
- [ ] Tests: synthetic Pixel-size pair with a status-bar clock change in `test/fixtures/native/`; acceptance scenario "two device screenshots with a mask pass; without it fail"; a real Pixel and iPhone hierarchy dump as converter fixtures.
- [ ] Verify before building E3: that Maestro's `screen-hierarchy/` is written per step (not only on failure) and what its JSON looks like; that RN 0.86 exposes Android `testID` as `resource-id`.

Savrendo (`C:\Projects\savrendo`):

- [x] Test ids on every screen root and primary action (done 16 Oct 2026 for the web tiers; the scheme is `screen-<route>`, `<thing>-button`, `tab-<name>`, `<thing>-row-<key>`, see Savrendo `docs/TESTING.md`). react-native-web renders them as `data-testid` (verified); the same `testID` props reach Maestro as `id` on native.
- [ ] Set `expo.android.package` and `expo.ios.bundleIdentifier` in `app.json`; add `eas.json` with `e2e-test` (apk, `withoutCredentials`) and `e2e-test-ios` (`simulator: true`).
- [ ] Add a test hook for the clock and the seed on NATIVE (`deps.now`, hydrate seed) reachable from a launch argument or a deep-link query. On the web no hook was needed: Playwright's `page.clock.setFixedTime` before navigation pins `new Date()` for the whole page, and stored-state fixtures carry the seed.
- [ ] Add a reset path a flow can use (deep link or Me screen action with a testID) so flows are idempotent against persisted state.
- [ ] Write `.maestro/onboarding.yaml`, `plate-home.yaml`, `shopping.yaml`, `me.yaml`, `meal.yaml`, `cook.yaml`; `takeScreenshot` names equal the Elastishot target names.
- [ ] Write `scripts/freeze-android.sh` (animation scales, demo-mode status bar, font scale, locale, appearance, navigation mode) and run it before every session, locally and in `before_maestro_tests`.
- [ ] Write `scripts/visual-native.mjs`: run Maestro with `--test-output-dir`, compare each PNG against `baselines/native/<device>-<api>-<appearance>/`, `--update` copies, aggregate exit code.
- [x] Web visual check (done 16 Oct 2026: `npm run visual` in Savrendo captures 24 pairs over light and dark, English and Turkish, Simple mode and large text, through a capture adapter that seeds the stored state and pins the clock).
- [ ] Add `.eas/workflows/visual-android.yml` from the sketch; on the first run read the job log to fix the screenshot path and confirm the hook runs after a failed flow.
- [ ] Put LogBox, scroll indicators and `expo-image` transitions behind an e2e flag (env or launch argument).
- [ ] Baselines per device + OS + appearance, committed under `baselines/native/`; never compare across models.

## 6. Notes from integrating a React-Native-web app (Savrendo, 16 Oct 2026)

Savrendo's web build (an Expo static export served from `dist/`) is checked with
Elastishot 0.2.0 through `createElastishot({ capture })` and a small capture adapter
that pins the clock, locale and timezone and seeds the stored state before navigation.
The adapter exists only because of items 1 and 2 below; the rest came up while making
24 captures reproducible. Each item names the 0.2.0 fact it comes from.


1. **Pre-navigation hook.** `capture.setup?: (page, context) => Promise<void>` before `goto`, plus sugar `capture.clock` (`page.clock.setFixedTime` by default, an `install` mode for timer UIs — document that `install` replays then resumes, so timers keep flowing), `capture.locale`, `capture.timezoneId`, `capture.localStorage: Record<string, string>` / `capture.initScript` with a one-shot guard (init scripts re-run on every navigation), inline `storageState` objects (Playwright accepts them), string paths resolved against the config folder (today `process.cwd()`), and a warning when `page` is passed together with `storageState`/`colorScheme`/`headers` (silently ignored, `capture/index.ts:182-186`). Verified: `storageState` is a string path, there are no locale/timezone options, `waitFor` runs after `goto` (`prepare.ts`). This is why Savrendo needs `scripts/capture-adapter.mjs`.
2. **Configurable `reducedMotion`** (hard-coded `'reduce'` at `capture/index.ts:165`, verified) with an opt-in motion-on capture, and record locale/timezone/motion/colorScheme in `meta.json`. RN apps branch on `prefers-reduced-motion` (Savrendo's `useFadeOnChange`), so the animated branch is never captured today.
3. **Inner scrollers.** RN-web sets `body{overflow:hidden}` and scrolls a child div, so `fullPage` and `scrollToLoad` are no-ops (verified: fullPage PNG byte-identical to the viewport PNG) while `fullPage: true` still records map boxes below the picture (28 of 130 Me elements). Add `capture.scrollContainer: selector | 'auto'` that grows the viewport to the tallest scroller's `scrollHeight` (or stitches), a `CAPTURE_INNER_SCROLL` warning when `document.scrollHeight === innerHeight` while a descendant overflows, and clip map boxes to the image whenever the document did not scroll.
4. **Finish, don't freeze.** `animation: none !important` prevents `animationend`, so state machines that depend on it never complete. Verified on Savrendo (16 Oct 2026): react-native-web's Modal sets `role="dialog"` (and arms its focus trap and Escape handling) only in its `animationend` handler, so under the freeze stylesheet an opened sheet is painted but `getByRole('dialog')` never matches and the capture times out; the two recipe targets run with `freezeAnimations: false` for that reason alone. The slide-out case is the mirror image (an RNW Modal that never unmounts); prefer `document.getAnimations().forEach(a => a.finish())` before mapping and screenshotting, keep the stylesheet for `transition`/caret/scroll-behavior, and inject the freeze sheet through `context.addInitScript` so it survives a reload or client-side navigation (today `prepare.ts` injects via `page.evaluate`, verified).
5. **Quiet-DOM wait.** CSS freezing cannot stop RN `Animated`/Reanimated frames (inline styles via rAF) nor `useDeferredValue`/VirtualizedList batches (verified: 5 of 6 shopping rows right after the first appears). Add `capture.waitForQuiet: ms` (MutationObserver sees no attribute/childList change and no layout change for N ms) and `waitFor: { role, name }` / `waitForText` forms next to the selector form.
6. **Element-map hygiene for RN-web.** Skip `aria-hidden="true"` and `inert` subtrees (mounted inactive tab scenes: 8 `h1` on `/me`, hidden carousel previews; a tab click inside `waitFor` gave a 258-element map of two overlapping scenes) and optionally confirm with `elementFromPoint`; add an `aria-label` strategy for role-less `div[aria-label]` (RNW StatPill/ZoneBadge/PreferenceLine); accept hand-written `nativeID`/`id` in `isStableId`; anchor duplicate role+name (two 'Close' buttons in a sheet) at the nearest `role=dialog`; strip hashed RNW class segments (`css-…`, `r-…`) from CSS paths; note `accessibilityHint` never reaches the DOM; document that `hide` removes elements from the map while `mask` keeps them (verified strategy order testid → id → role → css).
7. **Report vocabulary.** A block appended where the baseline had only background is reported as `changed` (same band, different content); only content that pushes something below it becomes an inserted band and `added` (`structural-align.ts:874`, verified with a shopping line at the end vs mid-list). Document it; consider classifying uniform-background bands that gain content as `added`.
8. **Device presets and DPR.** `viewports[].device: 'iPhone 15'` → Playwright `devices` (`isMobile`, `hasTouch`, `userAgent`, dpr); CSS-pixel `ignoreRegions` scaled by dpr; a horizontal-overflow warning in capture meta (`scrollWidth > viewport.width`, QA #26-style); `hideScrollbars` for inner scrollers whose OS scrollbar styles differ.
9. **SPA shells and redirects.** Expo static exports answer 200 with the same empty shell for every route, so `CAPTURE_ERROR_PAGE` cannot fire on an unhydrated page unless the element count stays < 5; add a per-target `expect` selector (fail the capture when absent), a `CAPTURE_EMPTY_SHELL` hint when a re-check finds many more elements later, and a `CAPTURE_REDIRECTED` warning when `location.pathname` after load differs from the target (onboarding gates send `/me` to `/onboarding`).
10. **Font/platform guard.** Store `navigator.platform` and the resolved `font-family` of `body` in `meta.json`; warn `FONT_PLATFORM_MISMATCH` when baseline and candidate come from different platforms; optional `capture.fonts` injection before load; OS in the baseline key next to the planned per-browser baselines.
11. **Target expansion** by `colorSchemes: ['light', 'dark']` and `locales` the way viewports expand (souklore and Savrendo duplicate targets with `flatMap`/`map`), and per-target fixture seeds (`targets[].fixture`-style storage documents).
12. **CLI traps (verified).** `run` silently ignores `--viewport/--full-page/--wait-for/--hide/--no-map` (`cli/commands/run.ts`); `--single-file` writes no candidate snapshot so `approve` cannot promote; `latest` is always written into the config `outDir`, even by `compare` and by runs with `--out` (`node/elastishot.ts:309`) — namespace it per outDir and warn in `approve` when the latest run came from `compare` or a different `baselineDir`; `run --update` never refreshes drifted baselines, so give it `--force` (today the path is `approve --all`).
13. **Dialog policy and stubs.** `capture.dialogs: 'accept' | 'dismiss' | 'fail'` (Playwright dismisses `window.confirm` silently, so destructive flows inside `waitFor` become no-ops) and init-script stubs for `speechSynthesis`, `navigator.wakeLock`, `navigator.vibrate`, `navigator.share`.
14. **Scenario steps in config.** JSON-friendly `targets[].steps: [{ click: 'role=button[name=Next]' }, …]` instead of JS `waitFor` functions for reaching "step n" without a URL, plus `scrollTo`/`snapIndex` so each page of a scroll-snap carousel can be its own target.
15. **Native screenshots.** `compare` already takes PNGs from `xcrun simctl io booted screenshot` / `adb exec-out screencap -p` / Maestro and Detox artefacts but yields unnamed regions: add an element-map adapter from a native accessibility dump (XCTest snapshot, `uiautomator dump`, Maestro hierarchy) into `elastishot.element-map/1`, status-bar mask presets per device (iOS 44–47 pt × DPR, Android 24 dp), DPR normalisation in meta and per-device baselines.
16. **An Expo/RN-web config template and author docs.** Headings are all `h1` (no aria-level), `testID` → `data-testid`, tab bars are `<a role=tab>` whose label changes with a badge count, Modal portals mount outside `#root` as `position:fixed`, live regions should carry test ids and be masked, light/dark pairs for `userInterfaceStyle: automatic`, a storageState example for AsyncStorage keys, the hydration-gate `waitFor` pattern, and the app-side contract that makes captures calm: honour reduced motion through `AccessibilityInfo`.

## Sources

Fetched and read for these notes:

- https://docs.expo.dev/llms.txt
- https://docs.expo.dev/eas/workflows/pre-packaged-jobs.md
- https://docs.expo.dev/eas/workflows/examples/e2e-tests.md
- https://docs.expo.dev/tutorial/cicd/e2e-tests.md
- https://docs.expo.dev/eas/workflows/syntax.md
- https://docs.expo.dev/custom-builds/schema.md
- https://docs.expo.dev/develop/development-builds/introduction.md
- https://docs.expo.dev/develop/development-builds/faq.md
- https://docs.expo.dev/guides/local-app-development.md
- https://docs.expo.dev/linking/into-your-app.md
- https://docs.expo.dev/build-reference/apk.md
- https://docs.expo.dev/build-reference/simulators.md
- https://docs.maestro.dev/
- https://docs.maestro.dev/sitemap.md
- https://docs.maestro.dev/api-reference/commands/takescreenshot
- https://docs.maestro.dev/api-reference/commands/assertscreenshot
- https://docs.maestro.dev/api-reference/commands/launchapp
- https://docs.maestro.dev/api-reference/commands/openlink
- https://docs.maestro.dev/api-reference/commands/waitforanimationtoend
- https://docs.maestro.dev/api-reference/selectors
- https://docs.maestro.dev/reference/selectors/core-selectors.md
- https://docs.maestro.dev/maestro-cli/
- https://docs.maestro.dev/maestro-cli/maestro-cli-commands-and-options.md
- https://docs.maestro.dev/platform-support/react-native
- https://docs.maestro.dev/get-started/supported-platform/react-native.md
- https://docs.maestro.dev/get-started/supported-platform/android/android-native.md
- https://docs.maestro.dev/maestro-flows/workspace-management/test-reports-and-artifacts.md
- https://docs.maestro.dev/maestro-flows/flow-control-and-logic/specify-and-start-devices.md
- https://wix.github.io/Detox/docs/api/device
- https://wix.github.io/Detox/docs/config/artifacts
- https://wix.github.io/Detox/docs/guide/taking-screenshots
- https://appium.github.io/appium-xcuitest-driver/latest/reference/execute-methods/
- https://github.com/appium/appium-uiautomator2-driver
- https://github.com/facebook/idb

Not reachable (404 or empty body), so the related statements are marked (memory):
https://fbidb.io/docs/commands/, the idb docs in the GitHub repo,
https://wix.github.io/Detox/docs/api/screenshots (moved to the guide above).

Local files read: Elastishot `README.md`, `docs/ROADMAP.md`, `docs/ELEMENT-MAP.md`,
`docs/EMBEDDING.md`, `src/capture/{index,prepare,collect}.ts`, `src/node/{config,inputs,elastishot,baselines}.ts`,
`src/locators/{index,element-map,presence,match}.ts`, `src/core/{types,options}.ts`,
`src/engine/stages/{preprocess,global-align,diff}.ts`, `src/cli/commands/compare.ts`,
`elastishot.config.example.js`, `CHANGELOG.md`; souklore `elastishot.config.mjs`,
`scripts/visual.mjs`, `README.md`; Savrendo `app.json`, `package.json`, `AGENTS.md`,
`src/app/**`, `src/ui/{Screen,Button}.tsx`, `src/features/home/{motion,a11y,greeting}.ts`,
`src/state/index.tsx`, `dist/`.
