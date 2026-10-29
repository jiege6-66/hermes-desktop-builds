<div align="center">

# Hermes Desktop 构建

把官方 Hermes 桌面端打包成 macOS / Windows / Linux 能直接装的应用

[![Build][badge-build]][link-build]
[![Release][badge-release]][link-release]
[![License][badge-license]][link-license]

简体中文 · [English](README.en.md)

</div>

从 [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) 的正式发布版本拉源码，
在四台原生机器上编译、签名、验证。个人自用，不改上游代码，也不打自己的补丁。

## 下载

文件在 [Releases][link-release] 里：

| 平台 | 文件 | 怎么装 |
| :--- | :--- | :--- |
| macOS（Apple Silicon） | `Hermes-<版本>-darwin-arm64-adhoc.dmg` | 打开 dmg，把 `Hermes.app` 拖进「应用程序」 |
| macOS（Intel） | `Hermes-<版本>-darwin-x64-adhoc.dmg` | 同上 |
| Windows x64 | `Hermes-<版本>-win32-x64-unsigned.zip` | 整个解到一个新目录，跑 `Hermes\Hermes.exe` |
| Linux x64 | `Hermes-<版本>-linux-x64-unsigned.tar.gz` | 解压，在图形界面里跑 `./Hermes/Hermes` |

macOS 包是 ad-hoc 签名的，第一次打开会被 Gatekeeper 拦，对完 `SHA256SUMS` 后去
「隐私与安全性 → 仍要打开」放行一次。别关 Gatekeeper 或 SIP。

## 版本

版本号是「上游 tag + 打包修订号」，比如上游 `v0.22.5` 打出来是 `0.22.5.1`，重打就往上加。
`.github/workflows/update-upstream.yml` 每天查一次官方新发布，有新的就推进 pin、派发构建。

## 现状

更新器已经修好，pin 在 `v0.22.5`。四平台构建还在修，没全绿就不会发 Release——上面那枚 build 徽章
是红的，就是这个意思。构建细节和踩过的坑记在 [docs/build-notes.md](docs/build-notes.md)。

## 本地构建

装好 Git、`upstream.json` 里那个版本的 Node、Python 3.11+（Linux 还要 `make`/`gcc`）：

```sh
python3 -m unittest discover -s tests -v
python3 scripts/build.py --run    # 只打当前这台，产物在 out/
```

## 说明

不是 Nous Research 官方发布，也没有 Apple / 微软的开发者签名，装之前自己对校验和。
源码跟随上游 MIT 许可。

[badge-build]: https://github.com/jiege6-66/hermes-desktop-builds/actions/workflows/build.yml/badge.svg
[link-build]: https://github.com/jiege6-66/hermes-desktop-builds/actions/workflows/build.yml
[badge-release]: https://img.shields.io/github/v/release/jiege6-66/hermes-desktop-builds?display_name=tag&sort=semver&color=blue
[link-release]: https://github.com/jiege6-66/hermes-desktop-builds/releases
[badge-license]: https://img.shields.io/badge/license-MIT-green
[link-license]: ./LICENSE
