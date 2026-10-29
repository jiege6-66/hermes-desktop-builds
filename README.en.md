<div align="center">

# Hermes Desktop Builds

Repackage the official Hermes desktop into apps you can just install - macOS / Windows / Linux

[![Build][badge-build]][link-build]
[![Latest release][badge-release]][link-release]
[![License][badge-license]][link-license]
[![Platform][badge-platform]][link-release]

[简体中文](README.md) · English

</div>

---

Takes a published release of [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent),
builds it on four native runners, signs and verifies it, and ships installers. Personal project: no
upstream source is modified, and no patches of mine are applied on top.

Not a Hermes fork, not an official Nous Research release, and not signed by Apple or Microsoft.

## Contents

- [Download & install](#download--install)
- [What this repo does](#what-this-repo-does)
- [How it differs from the original](#how-it-differs-from-the-original)
- [Following upstream releases](#following-upstream-releases)
- [Things that bit me](#things-that-bit-me)
- [Where it stands](#where-it-stands)
- [Build locally](#build-locally)
- [Repository layout](#repository-layout)
- [FAQ](#faq)

## Download & install

Everything is in [Releases][link-release]. Pick your platform:

| Platform | File | How to install |
| :--- | :--- | :--- |
| macOS (Apple Silicon) | `Hermes-<version>-darwin-arm64-adhoc.dmg` | Open the dmg, drag `Hermes.app` into `Applications` |
| macOS (Intel) | `Hermes-<version>-darwin-x64-adhoc.dmg` | Same |
| Windows x64 | `Hermes-<version>-win32-x64-unsigned.zip` | Extract the whole zip somewhere new, run `Hermes\Hermes.exe` |
| Linux x64 | `Hermes-<version>-linux-x64-unsigned.tar.gz` | Extract, run `./Hermes/Hermes` from a desktop session |

Each release also carries `SHA256SUMS`, the source pin, per-platform verification logs, and a generated
`hermes-desktop.rb`. No tap is maintained here, so if you want Homebrew to manage it, download that cask
and `brew install --cask ./hermes-desktop.rb`.

<details>
<summary><b>macOS says "unidentified developer"</b></summary>

<br/>

The app is ad-hoc signed - no Developer ID, no notarization - so Gatekeeper will block it. Check the
checksum against `SHA256SUMS`, then allow it once via **System Settings → Privacy & Security → Open
Anyway**. Don't turn off Gatekeeper or SIP, and don't strip quarantine globally.

If you actually suspect the bundle is broken, check which kind of problem it is:

```sh
APP="/Applications/Hermes.app"
codesign --verify --deep --strict --verbose=2 "$APP"   # this one must pass
spctl --assess --type execute -vv "$APP"               # this one will fail, as expected
```

`codesign` passing while `spctl` fails means the bundle is fine, it just has nobody vouching for it.
Double-click-without-warning needs an Apple Developer account (Developer ID Application, plus Installer
for a pkg) and notarization; this repo does not go that route.

</details>

## What this repo does

It packages the official Electron desktop itself: real UI, real native modules, real Electron runtime.
No Python runtime, no agent source checkout, no credentials or personal backend URLs inside.

Builds run on GitHub-hosted runners. The build job only gets `contents: read`, so it cannot reach signing
keys or API tokens. All four platforms have to pass before a release goes out; if something fails, the
previous release stays up and the pin is kept for the next attempt.

## How it differs from the original

Forked from [`frankhommers/hermes-desktop-builds`](https://github.com/frankhommers/hermes-desktop-builds).

| Area | This repo |
| :--- | :--- |
| Source patches | None. `patches/manifest.json` is an empty set; the build checks the tree still matches the pin |
| Version | `package.json` upstream is always `0.0.0`; the real version comes from the release tag: `vX.Y.Z` -> `X.Y.Z` |
| First run | Stock upstream: both "install locally" and "Connect to existing Hermes" are offered |
| In-app updater | None. Updates come from Releases and the generated cask |
| macOS artifacts | zip for byte-exact verification, dmg for humans |

## Following upstream releases

`.github/workflows/update-upstream.yml` runs daily at 03:17 UTC:

```text
1. find      latest published release of NousResearch/hermes-agent, never main
2. verify    tag -> commit, check ancestry, stop on any version downgrade
3. version   use the real version if present; 0.0.0 falls back to the tag; anything else fails
4. pin       touch upstream.json only, then dispatch the native build
```

Version is `<upstream version>.<packaging revision>`, and the second part only goes up:

```text
upstream v0.22.5  ->  first build 0.22.5.1  ->  rebuild 0.22.5.2
```

## Things that bit me

Upstream changed a lot recently (Electron 44, electron-builder 27, `@electron/osx-sign` 2.x). These are
the fixes that got the pipeline running again:

<details>
<summary><b>Packaging has to go through upstream's own prepared-packaging entry point</b></summary>

<br/>

Call electron-builder directly and it tries to resolve the whole npm workspace, then eats all the memory:
a 4 GiB heap OOMs in under a minute, and 16 GiB takes the runner down with it. Upstream's wrapper stages
isolated inputs first and then calls electron-builder, which stays small:

```sh
npm run builder -- --linux --dir --x64 --publish never \
  -c.extraMetadata.version=<version> -c.directories.output=<out>
```

</details>

<details>
<summary><b>macOS signing order matters</b></summary>

<br/>

Prepared packaging drops its own native payload over `dist`, so the order has to be:

1. after packaging, ad-hoc sign every Mach-O under `app.asar.unpacked`;
2. then seal the whole `Hermes.app`;
3. verify each native with `codesign --verify`, count them, then run the tamper and missing-seal negatives.

Because signing happens after the ASAR is written, those unpacked files end up larger than the size
recorded in the asar header. They are covered by the code signature, so `inspect.mjs` only checks size and
integrity for entries packed into the asar.

</details>

<details>
<summary><b>Linux smoke needs xvfb</b></summary>

<br/>

Electron 44 segfaults on hosted runners with `--ozone-platform=headless`. Running it under
`xvfb-run -a -s '-screen 0 1280x1024x24'` fixes it; headless is only the fallback when xvfb is missing.

</details>

<details>
<summary><b>Three upstream tests are broken on their own</b></summary>

<br/>

On the untouched `v0.22.5` tree three tests fail already: a `stage-native-deps` warning string and two
`voice-prefs` localStorage spies. They are listed in `scripts/common.py` as `UPSTREAM_TEST_DEFECTS`, bound
to the exact commit, file and test name, with the reason. Any other failure still blocks the release.

</details>

## Where it stands

| Stage | Status |
| :--- | :--- |
| Version following (placeholder -> tag) | Done. Pin is at `v0.22.5`, downstream `0.22.5.1` |
| Updater commit / push / dispatch | Done, actually exercised |
| Four-platform native builds | Not green yet. Packaging OOM, Mac signing, ASAR checks and Linux smoke are fixed; the rest is still going through CI |

No release goes out until everything is green; the last one stays usable. To watch it:

```sh
gh run list --repo jiege6-66/hermes-desktop-builds --limit 5
gh run view <run-id> --repo jiege6-66/hermes-desktop-builds --log-failed
```

The build badge at the top is red right now. That is accurate, not a broken image.

## Build locally

`upstream.json` pins the upstream commit, version, revision and Node version. Take a clean machine, install
Git, that Node version, and Python 3.11+ (Linux also needs `make`/`gcc`):

```sh
python3 -m unittest discover -s tests -v
node --test tests/asar-paths.test.mjs tests/macos-signing.test.mjs
python3 scripts/build.py --run        # builds this host only, output in out/
```

<details>
<summary><b>What the build actually does</b></summary>

<br/>

Fetch that exact commit (a leftover `.work/src` is refused) -> verify the patch-set hashes (empty here) ->
`npm ci` with lifecycle scripts off -> install Electron separately -> run upstream's build / stage /
package hooks -> sign (macOS only) -> check the asar and the install stamp -> package -> unpack and compare
byte for byte -> launch the real app once -> run the test gates.

Caches and the test HOME live under `.work/`, output under `out/`. The Linux desktop smoke needs an X
server; install `xvfb` locally.

</details>

<details>
<summary><b>Re-publish by hand</b></summary>

<br/>

```sh
gh workflow run build.yml --ref main
python3 scripts/ci_receipt.py --run <run-id>
python3 scripts/release.py --downloads out/downloads --destination out/release \
  --run-url https://github.com/jiege6-66/hermes-desktop-builds/actions/runs/<run-id>
```

</details>

## Repository layout

```text
.
├── upstream.json                  # source pin: repo / commit / version / revision / Node
├── patches/manifest.json          # patch set (empty here) and its hashes
├── scripts/
│   ├── update_upstream.py         # daily discovery -> plan -> apply
│   ├── build.py                   # fetch, verify, package (zip + dmg), smoke
│   ├── inspect.mjs / smoke.mjs    # asar and install-stamp checks, real launch
│   ├── macos_signing.py           # Mac payload / bundle signing and verification
│   └── release.py / ci_receipt.py # publish only verified artifacts
└── .github/workflows/             # update, build, publish
```

## FAQ

<details>
<summary><b>Why is the version <code>0.22.5.1</code>, four parts?</b></summary>

<br/>

First three parts are the upstream release tag, the last one counts packaging runs of this repo. Rebuilds
of the same upstream release bump it, and it never goes down.

</details>

<details>
<summary><b>Why is there no in-app updater?</b></summary>

<br/>

The original repo had a macOS update channel tied to its author's Homebrew tap. That is gone here: updates
come from Releases, so nothing depends on someone else's tap. If you want Homebrew to manage it, use the
cask in the release.

</details>

<details>
<summary><b>Why is it so strict about not shipping?</b></summary>

<br/>

Because whatever gets published is what people install. Failing tests, bad signatures, mismatched hashes:
the run stops there instead of being marked green. The only exceptions are the three upstream-broken tests
listed above.

</details>

## Disclaimer

A personal community build: not an official Nous Research release, not signed by Apple or Microsoft. Check
the checksums yourself and follow your own environment's rules. Source follows the upstream MIT license.

[badge-build]: https://github.com/jiege6-66/hermes-desktop-builds/actions/workflows/build.yml/badge.svg
[link-build]: https://github.com/jiege6-66/hermes-desktop-builds/actions/workflows/build.yml
[badge-release]: https://img.shields.io/github/v/release/jiege6-66/hermes-desktop-builds?display_name=tag&sort=semver&color=blue
[link-release]: https://github.com/jiege6-66/hermes-desktop-builds/releases
[badge-license]: https://img.shields.io/badge/license-MIT-green
[link-license]: ./LICENSE
[badge-platform]: https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey
