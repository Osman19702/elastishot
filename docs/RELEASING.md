# Releasing

Releases are cut by pushing a tag. The `Release` workflow tests, packs,
publishes to npm with provenance and creates the GitHub release; nothing is
published from a laptop.

## Once

1. An npm account with two-factor authentication, logged in locally
   (`npm whoami` prints the username).
2. The first version is published by hand, because a trusted publisher can
   only be attached to a package that exists: `npm publish` from the repo
   root (`prepublishOnly` runs the checks, then npm asks for the 2FA code).
3. On npmjs.com, package settings, "Trusted publisher": GitHub Actions,
   organisation or user `Osman19702`, repository `elastishot`, workflow
   filename `release.yml`, no environment. From then on the workflow
   publishes with provenance and no token is stored anywhere.

## Every release

1. Move the entries under "Unreleased" in `CHANGELOG.md` into a new
   `## [x.y.z] - YYYY-MM-DD` section and add the comparison link at the
   bottom.
2. Bump `version` in `package.json` to the same number (no tag yet):
   `npm version x.y.z --no-git-tag-version`.
3. `npm run test:all && npm run build && npm run check:package`.
4. Stage everything, new files included: `git status --short` and then
   `git add -A`. `-am` alone stages only files git already tracks, and a
   release that adds a source file or a binary fixture (`test/fixtures/images/*.png`,
   which scenario A6 reads) would pass every check on the laptop and go red
   on CI, where the file does not exist. `npm test` fails with
   "run npm run fixtures" when a fixture named in the manifest is missing,
   but only for a file that is missing on disk, not for one that is merely
   unstaged.
5. Commit: `git commit -s -m "release: x.y.z"` and push. Check with
   `git show --stat HEAD` that every file you meant to release is in it.
6. Tag and push the tag: `git tag vx.y.z && git push origin vx.y.z`.
7. Watch the Release workflow. It refuses a tag that does not match
   `package.json` or a version already on npm.
8. Verify: `npm view elastishot version`, the provenance badge on the npm
   page, and the GitHub release with the tarball and `SHA256SUMS`.

## If it fails

A failed run publishes nothing; fix, delete the tag locally and remotely
(`git tag -d vx.y.z && git push origin :refs/tags/vx.y.z`), and tag again.
If npm publish succeeded but the GitHub release step failed, re-run only
that step: `gh release create vx.y.z elastishot-x.y.z.tgz SHA256SUMS`.
