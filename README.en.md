# Hermes Desktop Builds (personal fork)

[简体中文](README.md) · English

Reproducible native builds of the **real Nous Research Hermes Electron Desktop**, taken from a
pinned official release of [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent)
and packaged for macOS (arm64/x64), Windows x64 and Linux x64.

This fork of [`frankhommers/hermes-desktop-builds`](https://github.com/frankhommers/hermes-desktop-builds)
drops the three community source patches the original repository maintained, so the pipeline ships
the **pristine upstream tree** and does not need patch rebasing on every upstream change. It is a
build/distribution repository, not a Hermes fork and not an official Nous Research release.

## What changed from the upstream community repo

| Area | This fork |
|---|---|
| Source patches | None. `patches/manifest.json` is an explicit empty set and the build verifies the tree stays pristine (`sourceClean: true`). |
| Version source | Upstream release trees carry a `0.0.0` placeholder; the release tag is authoritative. The pin's version is `vX.Y.Z` → `X.Y.Z`, stamped into the packaged app via `-c.extraMetadata.version`, which is what the app reports. |
| First run | Stock upstream behavior: local install and **Connect to existing Hermes** are both offered; the remote form is one click away. |
| In-app updater | None. Updates arrive only through release artifacts / the generated cask. |
| macOS artifacts | `-adhoc.zip` (byte-verified archive) **and** `-adhoc.dmg` (mountable installer image with an `Applications` shortcut). |
| Identity | Repository `jiege6-66/hermes-desktop-builds`; the daily updater, release publisher and generated cask all point here. |

## How it follows official releases

`.github/workflows/update-upstream.yml` runs daily (03:17 UTC) and on demand:

1. Read-only discovery of the latest **published, non-prerelease** release of
   `NousResearch/hermes-agent` (never the moving `main` branch).
2. Resolve the tag to an exact commit and verify ancestry, so a source downgrade is refused.
3. Derive the app version: a real `apps/desktop/package.json` version wins; the `0.0.0` placeholder
   falls back to the release tag. Anything else fails closed.
4. Fast-forward only `upstream.json`, then explicitly dispatch the native build at the expected
   build-repository commit. A write race stops the update.

`build.yml` builds all four native targets and only uploads artifacts if every gate passes.
`release.yml` then verifies the build receipt, all four manifests, archive/DMG hashes and the
uploaded asset digests before publishing a numbered release. A failed run leaves the previous
release untouched; the pin is retained so the next daily check can retry.

Version numbering: the downstream release is `<upstream version>.<revision>`, e.g. upstream
`v0.22.5` → first build `0.22.5.1`. Revisions only increase.

## Pipeline details worth knowing

Each of these came out of adapting to the current upstream (Electron 44, electron-builder 27,
`@electron/osx-sign` 2.x):

- **Packaging goes through upstream's own prepared-packaging entry point** (`npm run builder -- …`).
  Calling electron-builder directly makes it OOM on this monorepo while resolving npm-workspace
  dependencies (4 GiB fails fast, 16 GiB takes the runner down). Upstream's wrapper prepares
  isolated inputs first and stays small.
- **macOS signing order**: prepared packaging re-stages its own native payload over `dist`, so after
  packaging every Mach-O under `app.asar.unpacked` is ad-hoc signed
  (`scripts/macos_signing.py --payload`) before the bundle is sealed; each native is then verified
  with `codesign --verify` and counted.
- **ASAR checks**: signed unpacked entries are larger than the size recorded in the ASAR header, so
  `inspect.mjs` enforces size/integrity only for packed entries; unpacked ones are covered by the
  code signature instead.
- **Linux smoke**: Electron 44 segfaults on hosted runners with `--ozone-platform=headless`, so the
  smoke runs under `xvfb-run`; headless is only a fallback when xvfb is unavailable.
- **Upstream test defects**: on the pristine `v0.22.5` tree three upstream tests fail
  (a `stage-native-deps` HUD warning text and two `voice-prefs` localStorage spies). They are listed
  in `scripts/common.py` as `UPSTREAM_TEST_DEFECTS`, bound to the exact commit, file and test name,
  with reasons. Any other failure still blocks the release.

## Downloads and installation

Use [Releases](https://github.com/jiege6-66/hermes-desktop-builds/releases). Every release carries
`SHA256SUMS`, the exact source pin, per-target evidence ZIPs and a generated `hermes-desktop.rb`
cask. No tap is maintained for this fork, so download the cask and run
`brew install --cask ./hermes-desktop.rb`, or install by hand.

### macOS

1. Download `Hermes-<version>-darwin-<arch>-adhoc.dmg` (or the ZIP) and verify it against `SHA256SUMS`.
2. Open the DMG and drag `Hermes.app` into `Applications`.
3. The build is **ad-hoc signed**, not Developer ID signed or notarized. Gatekeeper will warn; after
   verifying the checksum, use **System Settings → Privacy & Security → Open Anyway** once. Never
   disable Gatekeeper/SIP or strip quarantine globally.
4. Diagnose a suspect bundle instead of re-signing it:

```sh
APP="/Applications/Hermes.app"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute -vv "$APP"
```

`codesign` must pass; `spctl` still rejects the unnotarized ad-hoc publisher — that is publisher
trust, not a damaged bundle. A warning-free install requires an Apple Developer Program membership
(Developer ID Application, plus Installer for a `.pkg`) and notarization credentials in a separate
release lane, which this fork does not use.

ZIP installation, if preferred: verify the checksum, then `ditto -x -k <zip> "$HOME/Applications"`.

### Windows

Check `Get-FileHash -Algorithm SHA256`, extract the whole ZIP into a new directory and run
`Hermes/Hermes.exe`. The build is unsigned (no Authenticode): SmartScreen will warn, and
organizational policy should not be bypassed.

### Linux

`sha256sum` the tarball, `tar -xzf` it into a new directory and run `./Hermes/Hermes` from a
graphical session. System Electron/Chromium libraries are required; the tarball registers no
launcher.

## Scope and guarantees

- Each build packages Electron, the real UI and real native modules. No Python runtime, agent
  checkout, venv, credentials or personal backend URL is bundled.
- Builds run on standard GitHub-hosted runners with `contents: read` only; no signing or API secrets
  are available to the build.
- Gates: unit/tooling tests, typecheck, targeted first-run/packaging suites on every host, the full
  upstream suite on Linux, ASAR file/integrity/secret-pattern scans, compiled-JS syntax, archive
  CRC/roundtrip byte comparison, a real launch of the extracted distribution, native PTY execution,
  and — on macOS — deep/strict signature verification plus negative seal/tamper tests and a
  mount-and-compare check of the DMG.
- Unknown test failures block the release. There is no "make CI pass" fallback and no automatic
  dependency bumping.

Limitations are recorded per release: ad-hoc signing, no notarization, no live remote login/chat
exercised, no microphone/camera/screen permission tests, and Mac/Windows GUI integration that still
needs a real machine.

## Current state

- **The updater is fixed and verified**: it recognizes the `0.0.0` placeholder and takes the release
  tag as the version; the pin advanced to `v0.22.5` (downstream `0.22.5.1`) and the commit/push/
  dispatch chain of `apply` has been exercised for real.
- **Native builds are still being stabilized**: the packaging OOM, macOS signing order, ASAR checks
  and the Linux smoke path are fixed one by one; remaining stages are being verified in CI. While a
  run is not green, no release is published and the previous one stays available.
- Check progress:

```sh
gh run list --repo jiege6-66/hermes-desktop-builds --limit 5
gh run view <run-id> --repo jiege6-66/hermes-desktop-builds --log-failed
```

## Reproduce locally

`upstream.json` pins the exact upstream commit, version, revision and Node version. Use a fresh
checkout on the target OS with Git, that Node version and Python ≥ 3.11 (Linux also needs a basic
toolchain such as `make`/`gcc`):

```sh
python3 -m unittest discover -s tests -v
node --test tests/asar-paths.test.mjs tests/macos-signing.test.mjs
python3 scripts/build.py --run        # builds this host only; writes out/
```

The build fetches the exact public commit, refuses to reuse `.work/src`, verifies the (empty) patch
set against its hash-pinned manifest, runs lockfile `npm ci` with lifecycle scripts disabled,
installs Electron explicitly, then uses upstream build/staging/builder hooks. Caches and test homes
stay under `.work/`; outputs stay under `out/`. The Linux desktop smoke needs an X server; install
`xvfb` locally if the machine has none.

Manual recovery: `gh workflow run build.yml --ref main`, then
`python3 scripts/ci_receipt.py --run <run-id>` and `python3 scripts/release.py --downloads …`.

## Files

- `upstream.json` — source pin (repository, commit, version, revision, Node).
- `patches/manifest.json` — explicit patch set (empty here) with hashes.
- `scripts/update_upstream.py` — discovery/plan/apply for the daily pin.
- `scripts/build.py` — native fetch, verification, packaging (ZIP + DMG), smoke launch.
- `scripts/inspect.mjs`, `scripts/smoke.mjs` — ASAR/stamp inspection and the real app launch.
- `scripts/macos_signing.py`, `scripts/sign-macos.mjs` — Mac payload and bundle signing/verification.
- `scripts/release.py`, `scripts/ci_receipt.py` — verified-only publication.
- `mainstream/` — unused one-time installer path inherited from the original repository; not
  exercised by this fork's workflows.

## Disclaimer

A personal community build: not an official Nous Research release, and not signed by Apple or
Microsoft as a publisher. Verify checksums and follow your own environment's security policy.
