# Native and React Native screenshots

Elastishot was built for web pages, but its engine only sees two images. This
page covers three ways of using it on mobile apps:

1. Comparing native screenshots (from an emulator, a simulator, Maestro, Detox
   or Appium) as image pairs.
2. Capturing an app built with React Native for Web (Expo's web export, for
   example) with Playwright, like any other page.
3. A Maestro and Expo recipe for both.

Some of the native workflow is still missing, notably baselines for
pre-captured PNGs and element names from native accessibility trees. It is
listed under [Planned](#planned). Every flow and YAML file below is a sketch:
adapt it, then check it against your own app. Statements marked **(unverified)**
come from tool documentation or experience that has not been re-checked
against a document.

## 1. What works today

**Image-pair mode is complete.** `elastishot compare a.png b.png` takes a PNG
or JPEG path, a baseline folder (`baseline.png` + `baseline.map.json` +
`meta.json`) or an image URL on each side. It writes the usual run folder
(`report.json`, `index.html`, `pairs/<id>/report.html` with the viewer, and
`junit.xml` with `--junit`) and exits 1 on differences. Nothing in the engine
knows about browsers.

**A sidecar map names regions in plain PNGs.** `shot.png` next to
`shot.map.json` gives named locators with no other change. An element map
needs `schema`, `image.{width,height}`, and for every entry a `locator`,
`name`, `tag`, `strategy` and `box` (see [ELEMENT-MAP.md](ELEMENT-MAP.md)).
So a native accessibility tree converted to `elastishot.element-map/1`, with
boxes in device pixels (which are the PNG's pixels), already names regions,
drives the added/removed/resized element report, and reaches the JUnit
failures. The converter is the missing piece, not the engine.

**Without a map, regions have no names.** The report says no element maps
were supplied. Regions are boxes with a kind, a score and tags, and every
viewer mode (slider, flip, blink, overlay, diff) still works.

**Alignment on device screenshots:**

- **Same device, same size** (for example 1080×2400 or 1179×2556): equal widths
  up to 1920 px are compared at their own size, with no resampling, and the
  antialiasing tolerance is 0. Row alignment handles the most common change in
  a mobile layout, a vertical stack that gained or lost rows (a list row, a
  banner, a longer label): the rows below stay exact. Content pushed off the
  bottom of the screen is reported as `removed` rows at the bottom. A tab bar
  that is fixed on both sides aligns as a matched band after the gap.
- **Different sizes or pixel ratios:** both sides go to the smaller width
  (capped at `workingWidth`, 1280 by default). Feature matching recovers scale
  and shift. A DPR of 2 against 3 (1.5×) or a 1179 px iPhone against a 1080 px
  Android phone (1.09×) is inside the supported range (about 2× per step), but
  different platforms also mean different fonts, bars and insets, so the result
  is noisy rather than wrong.
- **Status bar, notch, Dynamic Island, home indicator:** the engine has no
  device awareness. The clock, battery and signal glyphs change between
  captures and come back as small `changed` regions at the top, which can fail
  a pair whose similarity is 0.999. The notch and the home indicator are
  static, so they cost nothing. Mask the status bar in the config; `compare`
  reads the config from the folder you run it in:

  ```js
  // elastishot.config.mjs: a 64 px status bar (24 dp × 2.625 on a Pixel 6; measure yours in the viewer)
  export default {
    compare: {
      ignoreRegions: [{ x: 0, y: 0, w: 1080, h: 64 }],
      ignoreRegionsCandidate: [{ x: 0, y: 0, w: 1080, h: 64 }],
    },
  }
  ```

- **Screens, not pages:** native tools capture the screen, so a long screen is
  several screenshots and several pairs. `--viewport`, `--full-page`, `--hide`
  and `--wait-for` apply to page URLs only.
- **Memory:** an iPhone 15 Pro Max screenshot is 1290×2796 (3.6 MP), well under
  what full-page web captures already cost.

**Gaps in image-pair mode:**

- `compare` writes one run folder per pair, so N screenshots make N run folders.
- `approve` promotes only pairs made by `run`, which needs page URLs, so a
  native baseline is a file you copy.
- `snapshot` captures URLs only, so no command turns a PNG into a baseline
  folder.

All three are on the roadmap.

## 2. React Native for Web

An app with a web build (an Expo static export, for example) can be captured
like any page: serve the export and point a config at it. React Native for Web
renders `testID` as `data-testid`, so the element map gets test-id locators
for free. `accessibilityLabel` becomes `aria-label` **(unverified; check once
in the DOM)**. The web build is also the web half of any later check for
drift between web and native.

```js
// elastishot.config.mjs
export default {
  baseUrl: 'http://127.0.0.1:8081/',
  viewports: [{ name: 'phone', width: 390, height: 844, deviceScaleFactor: 2 }],
  capture: {
    colorScheme: 'light',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    clock: '2026-01-15T09:41:00Z',   // pins Date.now() before the app starts
    animations: 'finish',            // see "Finish, don't freeze" below
  },
  targets: [
    { name: 'home', url: '/', expect: '[data-testid="screen-home"]' },
    { name: 'settings', url: '/settings', expect: '[data-testid="screen-settings"]' },
  ],
}
```

What React Native for Web apps need from a capture:

- **Seeded state.** An app that reads its state from storage at start-up (for
  example AsyncStorage, which uses `localStorage` on the web) needs that state
  in place before the first script runs. Use `capture.storageState` with an
  object, or `capture.setup(page, context)` in a JS config.
- **A fixed clock.** Greetings by time of day, relative dates, timers and
  first-launch seeds based on `Date.now()` change between captures.
  `capture.clock` pins the time before navigation.
- **Finish, don't freeze.** A stylesheet with `animation: none` prevents
  `animationend`, and some components complete their state change only in
  that handler. React Native for Web's `Modal`, for example, sets
  `role="dialog"` there. `capture.animations: 'finish'` fast-forwards running
  animations instead, so those handlers fire.
- **Wait for the app, not the shell.** An Expo static export answers HTTP 200
  with the same shell for every route, and onboarding or sign-in gates
  redirect deep links. Give each target an `expect` selector that only the
  real screen has. A capture whose final URL differs from the requested one
  carries a `CAPTURE_REDIRECTED` warning.
- **Inner scrollers.** React Native for Web sets `body { overflow: hidden }`
  and scrolls a child element, so `fullPage` captures only the viewport. Use a
  taller viewport for long screens.
- **Reduced motion.** Captures run with `prefers-reduced-motion: reduce` by
  default. Apps that branch on it never show their animated state; set
  `capture.reducedMotion: 'no-preference'` for a target that must.

## 3. A recipe with Maestro and Expo

Pipeline: a Maestro flow → `takeScreenshot` PNGs → `elastishot compare` per
pair → JUnit and run folders. Expo Go works for quick local checks; baselines
should come from a build such as an EAS APK.

### What the tool documentation establishes

- Maestro's `takeScreenshot: name` writes `<name>.png` into the flow's artefact
  folder, under `takeScreenshot/`. The default location is
  `~/.maestro/tests/<timestamp>/<flow-name>/` (on Windows,
  `%userprofile%\.maestro\tests`).
  - `--test-output-dir` moves screenshots, video and `commands.json`.
  - `--flatten-debug-output` drops the per-run subfolders.
  - `--format junit --output build/report.xml` writes Maestro's own report.
- Expo Go cannot be launched with `launchApp` and your app's id. The Maestro
  React Native guide says to `openLink` the development URL instead. Expo's
  linking documentation uses `exp://127.0.0.1:8081/--/<path>`. A development or
  release build uses your app's scheme, `myapp://<path>`.
- Maestro's `id` selector matches the iOS `accessibilityIdentifier` and the
  Android resource id, which is what React Native's `testID` becomes. `text`
  matches visible text and accessibility labels. All text selectors are
  regular expressions.
- `waitForAnimationToEnd` waits up to 15 s and then continues even if the
  screen still moves: it never fails.
- Maestro's `assertScreenshot` is a plain percentage match against a reference
  PNG. It does not align, name or explain, so Elastishot replaces it;
  `takeScreenshot` stays.
- EAS Workflows offer a `maestro` job that takes a `build_id` and a
  `flow_path`, with `hooks` (`before_maestro_tests`, `after_maestro_tests`)
  whose steps can run shell commands and upload artefacts. Android needs
  `runs_on: linux-large-nested-virtualization`. The build profile for end-to-end
  tests is `withoutCredentials: true` with an APK, or `ios.simulator: true`.

### Local run on an Android emulator

1. **Pin the emulator.** Use one device, API level and system image, and pin
   the GPU mode: software and host GPU rendering antialias differently.
2. **Freeze the device before each session (unverified commands).**
   - Animation scales:
     `adb shell settings put global window_animation_scale 0`, the same for
     `transition_animation_scale` and `animator_duration_scale`. React Native
     reads `transition_animation_scale == 0` as reduced motion.
   - Demo-mode status bar:
     `adb shell settings put global sysui_demo_allowed 1`, then
     `adb shell am broadcast -a com.android.systemui.demo -e command enter`,
     `… -e command clock -e hhmm 0941`, and
     `… -e command battery -e level 100 -e plugged false`.
   - Font scale: `adb shell settings put system font_scale 1.0`.
   - Appearance: `adb shell cmd uimode night no` (or `yes`).
   - Locale: pin it too.
3. **Start Expo** with `npx expo start`, then press `a` to open Expo Go in the
   emulator. Give the first bundle a long wait: 60 s or more.
4. **Write a flow.** `.maestro/home.yaml`:

```yaml
appId: host.exp.exponent            # Expo Go on Android (unverified). A built app: its android.package
env:
  APP_URL: exp://127.0.0.1:8081/--/  # Expo Go. A built app: myapp://   (override with -e APP_URL=...)
---
- launchApp:
    stopApp: true
    clearState: false                # true would also wipe Expo Go itself; reset through the app instead
- openLink: ${APP_URL}
- extendedWaitUntil:
    visible:
      id: screen-home|onboarding-start   # regex: whichever screen the stored state leads to
    timeout: 90000
- runFlow:                           # a fresh device: get through onboarding first
    when:
      visible:
        id: onboarding-start
    file: onboarding.yaml
- waitForAnimationToEnd
- hideKeyboard
- takeScreenshot: home
- tapOn:
    id: tab-settings
- waitForAnimationToEnd
- takeScreenshot: settings
```

   Wait for an element with `extendedWaitUntil`, never a fixed sleep: a splash
   screen held until the app's state is loaded would otherwise be captured.

5. **Run the flow.**
   `maestro test --test-output-dir .maestro-out --flatten-debug-output .maestro/home.yaml`.
   Check where the PNGs land once; the documentation describes the flags, not
   the final folder layout under both of them.
6. **Compare each screenshot.**
   `npx elastishot compare baselines/native/pixel_6-api34-light/home.png .maestro-out/home/takeScreenshot/home.png --name home --junit --out .elastishot/runs/native/home`.
   - Use the status-bar mask from section 1.
   - Name each baseline folder after the device, API level and appearance, and
     never mix them.
   - A small script can loop over the PNGs, sum the exit codes, and copy
     candidates over baselines on request.

### An EAS workflow sketch

```yaml
# .eas/workflows/visual-android.yml
name: visual-android
on:
  pull_request:
    branches: ['*']
jobs:
  build_android:
    type: build
    params:
      platform: android
      profile: e2e-test               # eas.json: { "withoutCredentials": true, "android": { "buildType": "apk" } }
  maestro:
    needs: [build_android]
    type: maestro
    runs_on: linux-large-nested-virtualization
    params:
      build_id: ${{ needs.build_android.outputs.build_id }}
      flow_path: ['.maestro/home.yaml']
      device_identifier: pixel_6
    hooks:
      before_maestro_tests:
        - name: Freeze the emulator
          run: bash scripts/freeze-android.sh
      after_maestro_tests:
        - name: Compare against committed baselines
          run: |
            OUT="$HOME/.maestro/tests"     # confirm the path in the first job log
            for shot in home settings; do
              cand=$(find "$OUT" -path '*takeScreenshot*' -name "$shot.png" | head -1)
              npx --yes elastishot@0.3.0 compare "baselines/native/pixel_6-light/$shot.png" "$cand" \
                --name "$shot" --junit --out ".elastishot/runs/$shot" || true
            done
        - uses: eas/upload_artifact
          with:
            path: .elastishot/runs
            name: elastishot
```

Points to check on the first run:
- whether `node_modules` are installed in the Maestro job (hence
  `npx --yes` with a pinned version);
- whether the hook runs after a failed flow;
- where the pre-packaged job leaves its screenshots.

`|| true` keeps the job green so that the run folders upload. Gate in a
separate step that reads the `junit.xml` files.

## 4. Pitfalls specific to React Native screenshots

- **Animations.** A stylesheet does not freeze native animations. Animated and
  Reanimated honour the operating system's reduce-motion setting when your
  components check it. Set the Android animation scales to 0, or turn on Reduce
  Motion in the iOS simulator. `waitForAnimationToEnd` passes on timeout, so
  don't rely on it alone. Router transitions and splash-screen fades are
  animations too.
- **Keyboard.** A focused text field raises a keyboard whose height and
  suggestion strip depend on the OS image and locale; hide it first. The caret
  blinks on native, so blur the field or mask it.
- **System fonts.** Font metrics differ between platforms and OS versions, so
  keep baselines per OS version and pin the font scale. Layouts computed from
  the font scale change every screen on a scaled device.
- **Status bar.** The clock, battery, signal, notifications and the status-bar
  style your app sets per theme all vary.
  - Android demo mode fixes them, and so does
    `xcrun simctl status_bar booted override` on iOS (unverified).
  - Detox's `device.setStatusBar()` works on iOS only. Maestro has no command
    for it, so set it before the flow.
  - Otherwise, mask the status bar.
- **Notch, island, corners, home indicator.** These are static pixels but differ
  per model, and the safe-area insets move all content: keep one baseline per
  model.
- **Dark mode.** With `userInterfaceStyle: automatic` the app follows the OS,
  and iOS crossfades the switch, so wait after changing it. Keep light and dark
  baselines apart.
- **Expo Go's own interface.** The loading screen, the first-open prompt, LogBox
  toasts in development, and the development menu all appear in screenshots.
  Use Expo Go for quick checks only, and take baselines from a build. Hide
  LogBox behind a test flag.
- **Splash timing.** A splash screen held until stored state is loaded, plus
  Android 12's system splash: wait for a test id, never a fixed time.
- **Clock-dependent content.** Greetings that change with the time of day,
  relative dates, timers and random seeds differ per device and per run. The
  app needs a test hook for the clock and the seed. On native that means a
  launch argument or a deep-link query; Maestro's `launchApp.arguments` don't
  reach Expo Go. On the web, `capture.clock` is enough.
- **Persisted state.** Storage survives between runs, and onboarding guards
  redirect deep links. Flows must reset through the app or branch on what is
  visible.
- **Modals.** On iOS the dimmed parent screen shows behind a sheet, so a change
  on that screen leaks into the modal's pair. Crop with Maestro's `cropOn` or
  mask the band.
- **Scroll artefacts.** Overscroll glow, bounce, fading scroll indicators and
  lists that render late: wait, and hide indicators under a test flag.
- **GPU and density.** Software and host GPU rendering differ, blur effects
  depend on what lies beneath them, and fractional pixel ratios (Pixel 6:
  2.625) put 1 dp borders on half pixels. Pin the GPU mode, and expect a little
  antialiasing noise.
- **Navigation bar.** Three-button and gesture navigation change the bottom
  band and the bottom inset. Pin one.
- **Locale.** Number and date formats follow the device; pin the locale.
- **Images.** Image components with transitions or progressive decoding need a
  wait. SVG art is deterministic.

## Planned

The native work on the [roadmap](ROADMAP.md#native-screenshots), in order of
value for effort:

1. **File and command targets.** `run`, `snapshot` and `approve` over
   pre-captured PNGs, and `compare --pairs` for N pairs in one run folder.
2. **Device presets.** Masks and tolerances per device, and a warning when a
   PNG is not the preset's size.
3. **Native element maps.** Converters from Maestro's hierarchy, `uiautomator`
   dumps, Appium page source, Detox's view hierarchy and `idb`, so native
   regions get names.
4. **Ignore by locator** resolved through native maps (on the web it arrives in
   0.3).
5. **Capture conditions recorded per baseline:** device, OS, locale,
   appearance and font scale, with a warning when baseline and candidate
   differ.
6. **Drift between platforms,** by comparing the sets of changed locators of
   two runs.
7. **Stitching** for scroll series, and grouped pairs for component galleries.
8. **A capture adapter contract** for native tools.
9. **Small report items:** device and appearance on the pair page, and the
   device in JUnit names.

Real pairs move these up the list fastest: open an issue with two screenshots
Elastishot gets wrong.

## Sources

- https://docs.expo.dev/eas/workflows/pre-packaged-jobs.md
- https://docs.expo.dev/eas/workflows/examples/e2e-tests.md
- https://docs.expo.dev/tutorial/cicd/e2e-tests.md
- https://docs.expo.dev/eas/workflows/syntax.md
- https://docs.expo.dev/custom-builds/schema.md
- https://docs.expo.dev/linking/into-your-app.md
- https://docs.expo.dev/build-reference/apk.md
- https://docs.expo.dev/build-reference/simulators.md
- https://docs.maestro.dev/api-reference/commands/takescreenshot
- https://docs.maestro.dev/api-reference/commands/assertscreenshot
- https://docs.maestro.dev/api-reference/commands/launchapp
- https://docs.maestro.dev/api-reference/commands/openlink
- https://docs.maestro.dev/api-reference/commands/waitforanimationtoend
- https://docs.maestro.dev/api-reference/selectors
- https://docs.maestro.dev/maestro-cli/maestro-cli-commands-and-options.md
- https://docs.maestro.dev/platform-support/react-native
- https://docs.maestro.dev/maestro-flows/workspace-management/test-reports-and-artifacts.md
- https://wix.github.io/Detox/docs/api/device
- https://wix.github.io/Detox/docs/guide/taking-screenshots
- https://appium.github.io/appium-xcuitest-driver/latest/reference/execute-methods/
- https://github.com/appium/appium-uiautomator2-driver
- https://github.com/facebook/idb
