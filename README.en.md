<div align="center">

# Hermes Desktop Builds

Package the official Hermes desktop into apps you can just install

[![Build][badge-build]][link-build]
[![Release][badge-release]][link-release]
[![License][badge-license]][link-license]

[简体中文](README.md) · English

</div>

Takes a published release of [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent),
builds it on four native runners, signs and verifies it. For personal use; no upstream code is changed and
no patches of mine are applied.

## Download

Files are in [Releases][link-release]:

| Platform | File | How to install |
| :--- | :--- | :--- |
| macOS (Apple Silicon) | `Hermes-<version>-darwin-arm64-adhoc.dmg` | Open the dmg, drag `Hermes.app` into `Applications` |
| macOS (Intel) | `Hermes-<version>-darwin-x64-adhoc.dmg` | Same |
| Windows x64 | `Hermes-<version>-win32-x64-unsigned.zip` | Extract into a new folder, run `Hermes\Hermes.exe` |
| Linux x64 | `Hermes-<version>-linux-x64-unsigned.tar.gz` | Extract, run `./Hermes/Hermes` from a desktop session |

The macOS build is ad-hoc signed, so Gatekeeper blocks it on first launch. Check it against
`SHA256SUMS`, then allow it once under Privacy & Security -> Open Anyway. Do not disable Gatekeeper or SIP.

## Versioning

A version is the upstream tag plus a packaging revision: upstream `v0.22.5` becomes `0.22.5.1`, and
rebuilds increase the last part. `.github/workflows/update-upstream.yml` checks for a new official release
once a day and, if there is one, moves the pin and dispatches the build.

## Status

The updater works and the pin is on `v0.22.5`. The four-platform builds are still being fixed; nothing is
published until they are all green - that is what the red build badge means. Build details and the problems
I ran into are in [docs/build-notes.md](docs/build-notes.md) (Chinese).

## Build locally

Git, the Node version pinned in `upstream.json`, and Python 3.11+ (`make`/`gcc` too on Linux):

```sh
python3 -m unittest discover -s tests -v
python3 scripts/build.py --run    # builds this host only, output in out/
```

## Notes

Not an official Nous Research release, and not signed by Apple or Microsoft. Check the checksums yourself.
Source follows the upstream MIT license.

[badge-build]: https://github.com/jiege6-66/hermes-desktop-builds/actions/workflows/build.yml/badge.svg
[link-build]: https://github.com/jiege6-66/hermes-desktop-builds/actions/workflows/build.yml
[badge-release]: https://img.shields.io/github/v/release/jiege6-66/hermes-desktop-builds?display_name=tag&sort=semver&color=blue
[link-release]: https://github.com/jiege6-66/hermes-desktop-builds/releases
[badge-license]: https://img.shields.io/badge/license-MIT-green
[link-license]: ./LICENSE
