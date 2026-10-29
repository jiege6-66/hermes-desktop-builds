<div align="center">

# Hermes Desktop Builds

**The official Hermes desktop, repackaged as installable native apps** — macOS · Windows · Linux

[![Build][badge-build]][link-build]
[![Latest release][badge-release]][link-release]
[![License][badge-license]][link-license]
[![Platform][badge-platform]][link-release]

[简体中文](README.md) · English

</div>

---

**Hermes Desktop Builds** is a personal build/distribution repo: it takes a **published official
release** of [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent), builds it on
four native runners, signs and verifies it, and ships installable macOS, Windows and Linux packages.

- 🔒 **Pristine upstream code** — no source patches; the build proves the tree matches the pin exactly
- 🔄 **Follows official releases daily** — new upstream release → new pin, build, verify, publish
- 🧾 **Every artifact is auditable** — `SHA256SUMS`, build receipts and per-target evidence ship with each release

> Not a Hermes fork, not an official Nous Research release, and not signed by Apple or Microsoft as a publisher.

## Contents

- [Download & install](#download--install)
- [What this is](#what-this-is)
- [What changed from the upstream community repo](#what-changed-from-the-upstream-community-repo)
- [Following official releases](#following-official-releases)
- [Pipeline internals](#pipeline-internals)
- [Current state](#current-state)
- [Build locally](#build-locally)
- [Repository layout](#repository-layout)
- [FAQ](#faq)

## Download & install

Grab the file for your platform from [**Releases**][link-release]:

| Platform | File | Install |
| :--- | :--- | :--- |
| macOS (Apple Silicon) | `Hermes-<version>-darwin-arm64-adhoc.dmg` | Open the DMG, drag `Hermes.app` into `Applications` |
| macOS (Intel) | `Hermes-<version>-darwin-x64-adhoc.dmg` | Same |
| Windows x64 | `Hermes-<version>-win32-x64-unsigned.zip` | Extract the whole ZIP, run `Hermes\Hermes.exe` |
| Linux x64 | `Hermes-<version>-linux-x64-unsigned.tar.gz` | Extract, run `./Hermes/Hermes` in a graphical session |

Each release also carries `SHA256SUMS`, the exact source pin, per-target evidence ZIPs and a generated
`hermes-desktop.rb` (Homebrew cask — no tap is maintained here, so
`brew install --cask ./hermes-desktop.rb` after downloading it).

<details>
<summary><b>macOS says “unidentified developer” — what now?</b></summary>

<br/>

The build is **ad-hoc signed**: no Developer ID, no Apple notarization, so Gatekeeper will block it.
After verifying `SHA256SUMS`, allow it once via **System Settings → Privacy & Security → Open Anyway**.
Do **not** disable Gatekeeper/SIP or strip quarantine globally.

Diagnose a suspect bundle instead of re-signing it:

```sh
APP="/Applications/Hermes.app"
codesign --verify --deep --strict --verbose=2 "$APP"   # must pass
spctl --assess --type execute -vv "$APP"               # still rejects an unnotarized ad-hoc publisher
```

`codesign` passing while `spctl` rejects means **the bundle is fine, it just has no publisher trust**.
A warning-free install needs Apple Developer Program membership (Developer ID Application, plus
Installer for a `.pkg`) and notarization credentials in a separate release lane, which this repo
does not use.

</details>

## What this is

| | |
| :--- | :--- |
| **What it packages** | The official Hermes Electron desktop (real UI, real native modules, Electron runtime) |
| **What it does not** | Python runtime, agent checkout, venv, credentials, personal backend URLs |
| **Build environment** | GitHub-hosted runners; build jobs hold `contents: read` only, no signing keys or API tokens |
| **Release gate** | All four platforms must pass; any failure keeps the previous release and retains the pin |

## What changed from the upstream community repo

Forked from [`frankhommers/hermes-desktop-builds`](https://github.com/frankhommers/hermes-desktop-builds):

| Area | This repo |
| :--- | :--- |
| Source patches | **None.** `patches/manifest.json` is an explicit empty set; the build proves the tree stays pristine |
| Version source | Upstream trees ship `0.0.0`; the real version comes from the release tag (`vX.Y.Z` → `X.Y.Z`) |
| First run | Stock upstream: both “install locally” and “Connect to existing Hermes” are offered |
| In-app updater | **None.** Updates arrive only through release artifacts / the generated cask |
| macOS artifacts | `-adhoc.zip` (byte-exact verification copy) **and** `-adhoc.dmg` (drag-to-install) |

## Following official releases

`.github/workflows/update-upstream.yml` runs daily at 03:17 UTC:

```text
1. discover   latest *published* release of NousResearch/hermes-agent (never main)
2. resolve    tag → exact commit, verify ancestry, refuse any source downgrade
3. version    real version wins; 0.0.0 placeholder falls back to the tag; anything else fails closed
4. pin        fast-forward upstream.json only, then dispatch the native build explicitly
```

Downstream version = `<upstream version>.<revision>`, revisions only increase:

```text
upstream v0.22.5  →  first build 0.22.5.1  →  rebuild 0.22.5.2
```

## Pipeline internals

Things that had to be solved for the current upstream (Electron 44, electron-builder 27,
`@electron/osx-sign` 2.x):

<details>
<summary><b>Packaging must go through upstream's prepared-packaging entry point</b></summary>

<br/>

Calling electron-builder directly makes it OOM on this monorepo while resolving npm-workspace
dependencies (4 GiB fails fast, 16 GiB takes the runner down). Upstream's wrapper prepares isolated
inputs first and stays small:

```sh
npm run builder -- --linux --dir --x64 --publish never \
  -c.extraMetadata.version=<version> -c.directories.output=<out>
```

</details>

<details>
<summary><b>macOS signing order</b></summary>

<br/>

Prepared packaging re-stages its own native payload over `dist`, so the order must be:

1. after packaging, ad-hoc sign every Mach-O under `app.asar.unpacked`;
2. then seal the whole `Hermes.app`;
3. verify each native with `codesign --verify`, compare counts, and run the negative seal/tamper tests.

Signing happens after the ASAR is written, so unpacked entries end up larger than the size recorded in
the ASAR header — those entries are covered by the **code signature**, and `inspect.mjs` only enforces
size/integrity for packed entries.

</details>

<details>
<summary><b>Linux smoke needs xvfb</b></summary>

<br/>

Electron 44 segfaults on hosted runners with `--ozone-platform=headless`, so the smoke runs under
`xvfb-run -a -s '-screen 0 1280x1024x24'`; headless is only a fallback when xvfb is unavailable.

</details>

<details>
<summary><b>Three upstream test defects are recorded as exceptions</b></summary>

<br/>

On the pristine `v0.22.5` tree three upstream tests fail (a `stage-native-deps` HUD warning text and
two `voice-prefs` localStorage spies). They are listed in `scripts/common.py` as
`UPSTREAM_TEST_DEFECTS`, bound to the exact commit, file and test name, with reasons. **Any other
failure still blocks the release.**

</details>

## Current state

| Stage | Status |
| :--- | :--- |
| Version following (placeholder → tag version) | ✅ Fixed: pin advanced to `v0.22.5` → downstream `0.22.5.1` |
| Daily updater commit / push / dispatch | ✅ Exercised for real |
| Four-platform native builds | 🚧 Converging: packaging OOM, macOS signing, ASAR checks and Linux smoke are fixed; remaining stages are still being verified in CI |

While a run is not green, no release is published and the previous one stays available. Check progress:

```sh
gh run list --repo jiege6-66/hermes-desktop-builds --limit 5
gh run view <run-id> --repo jiege6-66/hermes-desktop-builds --log-failed
```

## Build locally

`upstream.json` pins the upstream commit, version, revision and Node version. Use a fresh checkout with
Git, that Node version and Python ≥ 3.11 (Linux also needs `make`/`gcc`):

```sh
python3 -m unittest discover -s tests -v
node --test tests/asar-paths.test.mjs tests/macos-signing.test.mjs
python3 scripts/build.py --run        # builds this host only; writes out/
```

<details>
<summary><b>What the build actually does</b></summary>

<br/>

Fetch the exact public commit (refusing to reuse `.work/src`) → verify the patch-set hashes (empty
here) → `npm ci` with lifecycle scripts disabled → install Electron explicitly → run upstream's
build/staging/packaging hooks → sign (macOS only) → ASAR and install-stamp inspection → package →
unpack and compare byte-for-byte → launch the real app as a smoke test → full test gate.

Caches and test homes stay under `.work/`; outputs under `out/`. The Linux desktop smoke needs an X
server — install `xvfb` locally if the machine has none.

</details>

<details>
<summary><b>Recover a release manually</b></summary>

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
├── patches/manifest.json          # explicit patch set (empty here) with hashes
├── scripts/
│   ├── update_upstream.py         # daily discovery → plan → apply
│   ├── build.py                   # fetch, verify, package (ZIP + DMG), smoke launch
│   ├── inspect.mjs / smoke.mjs    # ASAR + install-stamp inspection, real app launch
│   ├── macos_signing.py           # Mac payload / bundle signing and verification
│   └── release.py / ci_receipt.py # verified-only publication
└── .github/workflows/             # update, build and publish pipelines
```

## FAQ

<details>
<summary><b>Why does the version look like <code>0.22.5.1</code>?</b></summary>

<br/>

The first three parts come from the upstream release tag; the fourth is this repo's packaging
revision. Rebuilds of the same upstream release increment it, and it never decreases.

</details>

<details>
<summary><b>Why is there no in-app updater?</b></summary>

<br/>

The original repo shipped a macOS updater bound to its author's Homebrew tap. This fork drops it:
updates come from Releases only, so nothing depends on somebody else's tap. If you want Homebrew to
manage it, use the cask generated in each release.

</details>

<details>
<summary><b>Why is the pipeline this strict?</b></summary>

<br/>

The rule is “fail rather than ship something suspicious”: unknown test failures, signature failures and
hash mismatches abort the release instead of being marked green — the only exceptions are the three
upstream test defects listed above.

</details>

## Disclaimer

A personal community build: not an official Nous Research release, and not signed by Apple or Microsoft
as a publisher. Verify checksums and follow your own environment's security policy. Source follows the
upstream MIT license.

[badge-build]: https://github.com/jiege6-66/hermes-desktop-builds/actions/workflows/build.yml/badge.svg
[link-build]: https://github.com/jiege6-66/hermes-desktop-builds/actions/workflows/build.yml
[badge-release]: https://img.shields.io/github/v/release/jiege6-66/hermes-desktop-builds?display_name=tag&sort=semver&color=blue
[link-release]: https://github.com/jiege6-66/hermes-desktop-builds/releases
[badge-license]: https://img.shields.io/badge/license-MIT-green
[link-license]: ./LICENSE
[badge-platform]: https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey
