# Hermes Desktop Builds (personal fork)

Reproducible native builds of the **real Nous Research Hermes Electron Desktop**,
taken from a pinned official release of [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent)
and packaged for macOS (arm64/x64), Windows x64 and Linux x64.

This fork of [`frankhommers/hermes-desktop-builds`](https://github.com/frankhommers/hermes-desktop-builds)
drops the three community source patches the original repository maintained, so the
pipeline ships the **pristine upstream tree** and does not need patch rebasing on every
upstream change. It is a build/distribution repository, not a Hermes fork and not an
official Nous Research release.

## What changed from the upstream community repo

| Area | This fork |
|---|---|
| Source patches | None. `patches/manifest.json` is an explicit empty set and the build verifies the tree stays pristine (`sourceClean: true`). |
| Version source | Upstream trees carry a `0.0.0` placeholder; the release tag is authoritative. The pin's version is `vX.Y.Z` → `X.Y.Z`, and the packaged app is stamped with it via `-c.extraMetadata.version`. |
| First run | Stock upstream behavior: local install and **Connect to existing Hermes** are both offered; the remote form is one click away. |
| In-app updater | None. Updates arrive only through release artifacts / the generated cask. |
| macOS artifacts | `-adhoc.zip` (byte-verified archive) **and** `-adhoc.dmg` (mountable installer image with an `Applications` shortcut). |
| Identity | Repository `jiege6-66/hermes-desktop-builds`; the daily updater, release publisher and generated cask all point here. |

## How it follows official releases

`.github/workflows/update-upstream.yml` runs daily (03:17 UTC) and on demand:

1. Read-only discovery of the latest **published, non-prerelease** release of
   `NousResearch/hermes-agent` (never the moving `main` branch).
2. Resolve the tag to an exact commit and verify ancestry, so a source downgrade is refused.
3. Derive the app version: a real `apps/desktop/package.json` version wins; the `0.0.0`
   placeholder falls back to the release tag. Anything else fails closed.
4. Fast-forward only `upstream.json`, then explicitly dispatch the native build at the
   expected build-repository commit. A write race stops the update.

`build.yml` builds all four native targets and only uploads artifacts if every gate passes.
`release.yml` then verifies the build receipt, all four manifests, archive/DMG hashes and the
uploaded asset digests before publishing a numbered release. A failed run leaves the previous
release untouched; the pin is retained so the next daily check can retry.

Version numbering: the downstream release is `<upstream version>.<revision>`, e.g. upstream
`v0.22.5` → first build `0.22.5.1`. Revisions only increase.

## Downloads and installation

Use [Releases](https://github.com/jiege6-66/hermes-desktop-builds/releases). Every release
carries `SHA256SUMS`, the exact source pin, per-target evidence ZIPs and a generated
`hermes-desktop.rb` cask. No tap is maintained for this fork, so install by hand or with
`brew install --cask ./hermes-desktop.rb` after downloading the cask file.

### macOS

1. Download `Hermes-<version>-darwin-<arch>-adhoc.dmg` (or the ZIP) and verify it against `SHA256SUMS`.
2. Open the DMG and drag `Hermes.app` into `Applications`.
3. The build is **ad-hoc signed**, not Developer ID signed or notarized. Gatekeeper will warn;
   after verifying the checksum, use **System Settings → Privacy & Security → Open Anyway**
   once. Never disable Gatekeeper/SIP or strip quarantine globally.
4. Diagnose a suspect bundle instead of re-signing it:

```sh
APP="/Applications/Hermes.app"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute -vv "$APP"
```

`codesign` must pass; `spctl` still rejects the unnotarized ad-hoc publisher — that is
publisher trust, not a damaged bundle. A warning-free install requires an Apple Developer
Program membership (Developer ID Application, plus Installer for a `.pkg`) and notarization
credentials in a separate release lane, which this fork does not use.

ZIP installation, if preferred: verify the checksum, then `ditto -x -k <zip> "$HOME/Applications"`.

### Windows

Check `Get-FileHash -Algorithm SHA256`, extract the whole ZIP into a new directory and run
`Hermes/Hermes.exe`. The build is unsigned (no Authenticode): SmartScreen will warn, and
organizational policy should not be bypassed.

### Linux

`sha256sum` the tarball, `tar -xzf` it into a new directory and run `./Hermes/Hermes` from a
graphical session. System Electron/Chromium libraries are required; the tarball registers no
launcher. CI launches the real renderer with `--ozone-platform=headless --no-sandbox`, which
is a CI-only flag, not run advice.

## Scope and guarantees

- Each build packages Electron, the real UI and real native modules. No Python runtime,
  agent checkout, venv, credentials or personal backend URL is bundled.
- Builds run on standard GitHub-hosted runners with `contents: read` only; no signing or API
  secrets are available to the build.
- Gates: unit/tooling tests, typecheck, targeted first-run/packaging suites on every host, the
  full upstream suite on Linux, ASAR file/integrity/secret-pattern scans, compiled-JS syntax,
  archive CRC/roundtrip byte comparison, a real launch of the extracted distribution, native
  PTY execution, and — on macOS — deep/strict signature verification plus negative
  seal/tamper tests and a mount-and-compare check of the DMG.
- Unknown test failures block the release. There is no "make CI pass" fallback and no
  automatic dependency bumping.

Limitations are real and recorded per release: ad-hoc signing, no notarization, no live
remote login/chat exercised, no microphone/camera/screen permission tests, and Mac/Windows
GUI integration that still needs a real machine.

## Reproduce locally

`upstream.json` pins the exact upstream commit, version, revision and Node version. Use a
fresh checkout on the target OS with Git, that Node version and Python ≥ 3.11:

```sh
python3 -m unittest discover -s tests -v
node --test tests/asar-paths.test.mjs tests/macos-signing.test.mjs
python3 scripts/build.py --run        # builds this host only; writes out/
```

The build fetches the exact public commit, refuses to reuse `.work/src`, applies the (empty)
patch set with a hash-pinned manifest, runs lockfile `npm ci` with lifecycle scripts disabled,
installs Electron explicitly, then uses upstream build/staging/builder hooks. Caches and test
homes stay under `.work/`; outputs stay under `out/`.

Manual recovery: `gh workflow run build.yml --ref main`, then
`python3 scripts/ci_receipt.py --run <run-id>` and `python3 scripts/release.py --downloads …`.

## Files

- `upstream.json` — source pin (repository, commit, version, revision, Node).
- `patches/manifest.json` — explicit patch set (empty here) with hashes.
- `scripts/update_upstream.py` — discovery/plan/apply for the daily pin.
- `scripts/build.py` — native fetch, verification, packaging (ZIP + DMG), smoke launch.
- `scripts/inspect.mjs`, `scripts/smoke.mjs` — ASAR/stamp inspection and the real app launch.
- `scripts/release.py`, `scripts/ci_receipt.py` — verified-only publication.
- `mainstream/` — unused one-time installer path inherited from the original repository;
  not exercised by this fork's workflows.
