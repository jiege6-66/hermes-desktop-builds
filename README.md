<div align="center">

# Hermes Desktop 构建

**把官方 Hermes 桌面端打包成可直接安装的原生应用** —— macOS · Windows · Linux

[![Build][badge-build]][link-build]
[![Latest release][badge-release]][link-release]
[![License][badge-license]][link-license]
[![Platform][badge-platform]][link-release]

简体中文 · [English](README.en.md)

</div>

---

**Hermes Desktop 构建**是一个个人维护的构建 / 分发仓库：从官方
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) 的某个**正式发布版本**
拉取源码，在四台原生机器上编译、签名、验证，产出 macOS、Windows、Linux 的安装包。

- 🔒 **只用原样上游代码** —— 不打任何源码补丁，构建会校验代码树与 pin 完全一致
- 🔄 **每天自动跟随官方发布** —— 发现新版本就自动推进版本号、构建、验证、发布
- 🧾 **每个产物都可核验** —— `SHA256SUMS`、构建回执、逐平台证据包随 Release 一起发布

> 这不是 Hermes 的分支，也不是 Nous Research 官方发布，没有 Apple / 微软的发布者签名。

## 目录

- [下载安装](#下载安装)
- [这是什么](#这是什么)
- [与原仓库的差异](#与原仓库的差异)
- [自动跟随官方更新](#自动跟随官方更新)
- [流水线内幕](#流水线内幕)
- [当前状态](#当前状态)
- [本地构建](#本地构建)
- [仓库结构](#仓库结构)
- [常见问题](#常见问题)

## 下载安装

去 [**Releases**][link-release] 页面按平台取文件：

| 平台 | 下载文件 | 安装方式 |
| :--- | :--- | :--- |
| macOS（Apple Silicon） | `Hermes-<版本>-darwin-arm64-adhoc.dmg` | 打开 dmg，把 `Hermes.app` 拖进「应用程序」 |
| macOS（Intel） | `Hermes-<版本>-darwin-x64-adhoc.dmg` | 同上 |
| Windows x64 | `Hermes-<版本>-win32-x64-unsigned.zip` | 整个解压到新目录，运行 `Hermes\Hermes.exe` |
| Linux x64 | `Hermes-<版本>-linux-x64-unsigned.tar.gz` | 解压到新目录，在图形会话运行 `./Hermes/Hermes` |

每个 Release 都附带 `SHA256SUMS`、源码 pin、各平台验证证据包，以及生成的 `hermes-desktop.rb`
（Homebrew cask；本仓库不维护 tap，可下载后 `brew install --cask ./hermes-desktop.rb`）。

<details>
<summary><b>macOS 提示「无法验证开发者」怎么办</b></summary>

<br/>

构建是 **ad-hoc 签名**，没有 Developer ID、也没做 Apple 公证，所以 Gatekeeper 一定会拦。核对
`SHA256SUMS` 之后，用「系统设置 → 隐私与安全性 → 仍要打开」放行一次即可。**不要**关闭
Gatekeeper/SIP，也不要全局移除隔离属性。

怀疑包有问题时先诊断，而不是自己重新签名：

```sh
APP="/Applications/Hermes.app"
codesign --verify --deep --strict --verbose=2 "$APP"   # 必须通过
spctl --assess --type execute -vv "$APP"               # 仍会拒绝未公证的 ad-hoc 发布者
```

`codesign` 通过、`spctl` 拒绝，说明**包本身是好的，只是没有发布者信任**。要做到双击无警告，需要
Apple Developer Program（Developer ID Application，打 pkg 还需 Installer 证书）并在独立通道里
保存公证凭据，本仓库不使用。

</details>

## 这是什么

| | |
| :--- | :--- |
| **打包对象** | 官方 Hermes Electron 桌面端（真实 UI + 真实原生模块 + Electron 运行时） |
| **不打包** | Python 运行时、agent 源码检出、venv、任何凭据或私人后端地址 |
| **构建环境** | GitHub 托管 runner，构建作业只有 `contents: read`，拿不到签名密钥或 API 令牌 |
| **发布门槛** | 四平台全部通过才发；任一验证失败，上一版保持可用，pin 保留待下次重试 |

## 与原仓库的差异

本仓库 fork 自 [`frankhommers/hermes-desktop-builds`](https://github.com/frankhommers/hermes-desktop-builds)，
主要改动：

| 方面 | 本仓库 |
| :--- | :--- |
| 源码补丁 | **无**。`patches/manifest.json` 是显式空集，构建校验代码树保持原样 |
| 版本来源 | 上游树上 `package.json` 固定是占位符 `0.0.0`，真实版本取自发布 tag：`vX.Y.Z` → `X.Y.Z` |
| 首次启动 | 保持上游行为：「本地安装」与「Connect to existing Hermes」都提供 |
| 应用内更新 | **没有**。更新只走 Release 产物 / 生成的 cask |
| macOS 产物 | `-adhoc.zip`（逐字节校验用）**和** `-adhoc.dmg`（可直接拖拽安装） |

## 自动跟随官方更新

`.github/workflows/update-upstream.yml` 每天 03:17 UTC 运行：

```text
① 只读发现    NousResearch/hermes-agent 最新的正式发布（不跟 main）
② 校验来源    tag → 确切 commit，校验祖先关系，拒绝版本倒退
③ 推导版本    真实版本优先；0.0.0 占位符改用发布 tag；其他异常值直接失败
④ 快进 pin    只改 upstream.json，然后显式派发原生构建
```

下游版本号 = `<上游版本>.<修订号>`，修订号只增不减：

```text
上游 v0.22.5  →  首次构建 0.22.5.1  →  重打包 0.22.5.2
```

## 流水线内幕

适配当前上游（Electron 44、electron-builder 27、`@electron/osx-sign` 2.x）时踩出来的几个坑：

<details>
<summary><b>打包必须走上游的 prepared packaging 入口</b></summary>

<br/>

直接调 electron-builder 会在这个 monorepo 上解析 npm workspace 依赖，内存直接爆掉
（4 GiB 快速 OOM，16 GiB 会把整台 runner 拖死）。上游自己的 wrapper 会先准备隔离输入再调用
electron-builder，内存稳定：

```sh
npm run builder -- --linux --dir --x64 --publish never \
  -c.extraMetadata.version=<version> -c.directories.output=<out>
```

</details>

<details>
<summary><b>macOS 的签名顺序</b></summary>

<br/>

prepared packaging 会用它自己暂存的 native 覆盖 `dist`，所以顺序必须是：

1. 打包完成后，逐个给 `app.asar.unpacked` 里的 Mach-O 做 ad-hoc 签名；
2. 再给整个 `Hermes.app` 封签；
3. 逐个 `codesign --verify` 并比对数量，再做负例（篡改 / 缺 seal）测试。

签名发生在 ASAR 写入之后，所以 unpacked 条目的字节数会大于 asar 头部记录的尺寸 —— 这类条目由
**代码签名**担保，`inspect.mjs` 只对 packed 条目校验尺寸与完整性。

</details>

<details>
<summary><b>Linux 冒烟要用 xvfb</b></summary>

<br/>

Electron 44 在托管 runner 上用 `--ozone-platform=headless` 会 SIGSEGV，冒烟改走
`xvfb-run -a -s '-screen 0 1280x1024x24'`；没有 xvfb 时才回退 headless。

</details>

<details>
<summary><b>三个上游测试缺陷被登记为例外</b></summary>

<br/>

`v0.22.5` 这棵原样树上有三个上游测试会失败（`stage-native-deps` 的 HUD 警告文案、`voice-prefs`
两处 localStorage spy）。它们按「commit + 文件 + 用例全名」登记在 `scripts/common.py` 的
`UPSTREAM_TEST_DEFECTS` 并写明原因；**其他任何失败仍然阻断发布**。

</details>

## 当前状态

| 环节 | 状态 |
| :--- | :--- |
| 版本跟随（占位符 → tag 版本） | ✅ 已修复：pin 已推进到 `v0.22.5` → 下游 `0.22.5.1` |
| 每日更新器提交 / 推送 / 派发 | ✅ 已实际跑通 |
| 四平台原生构建 | 🚧 逐轮收敛中：打包 OOM、Mac 签名、ASAR 校验、Linux 冒烟已修，剩余环节仍在 CI 验证 |

构建未全绿时不发 Release，上一版保持可用。查看进展：

```sh
gh run list --repo jiege6-66/hermes-desktop-builds --limit 5
gh run view <run-id> --repo jiege6-66/hermes-desktop-builds --log-failed
```

## 本地构建

`upstream.json` 固定了上游 commit、版本、修订号和 Node 版本。准备目标系统的干净检出，装好 Git、
该版本的 Node、Python ≥ 3.11（Linux 还需要 `make`/`gcc`）：

```sh
python3 -m unittest discover -s tests -v
node --test tests/asar-paths.test.mjs tests/macos-signing.test.mjs
python3 scripts/build.py --run        # 只构建当前主机，产物写入 out/
```

<details>
<summary><b>构建过程做了什么</b></summary>

<br/>

拉取确切的公开 commit（拒绝复用旧的 `.work/src`）→ 校验补丁集哈希（本仓库为空）→
`npm ci` 安装依赖（先禁用生命周期脚本）→ 显式安装 Electron → 走上游的构建 / 暂存 / 打包钩子 →
签名（仅 macOS）→ ASAR 与安装戳检查 → 打包 → 解包回读逐字节比对 → 真实启动冒烟 → 全量测试门禁。

缓存与测试 HOME 都在 `.work/`，产物在 `out/`。Linux 桌面冒烟需要 X server，本地可先装 `xvfb`。

</details>

<details>
<summary><b>手动恢复一次发布</b></summary>

<br/>

```sh
gh workflow run build.yml --ref main
python3 scripts/ci_receipt.py --run <run-id>
python3 scripts/release.py --downloads out/downloads --destination out/release \
  --run-url https://github.com/jiege6-66/hermes-desktop-builds/actions/runs/<run-id>
```

</details>

## 仓库结构

```text
.
├── upstream.json                  # 源码 pin：仓库 / commit / 版本 / 修订号 / Node
├── patches/manifest.json          # 显式补丁集（本仓库为空）与哈希
├── scripts/
│   ├── update_upstream.py         # 每日发现 → 计划 → 落地
│   ├── build.py                   # 拉取、校验、打包（ZIP + DMG）、冒烟
│   ├── inspect.mjs / smoke.mjs    # ASAR 与安装戳检查、真实启动验证
│   ├── macos_signing.py           # Mac payload / bundle 签名与校验
│   └── release.py / ci_receipt.py # 只允许已验证产物的发布流程
└── .github/workflows/             # 更新、构建、发布三条流水线
```

## 常见问题

<details>
<summary><b>为什么版本号是 <code>0.22.5.1</code> 这种四段式？</b></summary>

<br/>

前三段来自上游发布 tag，第四段是本仓库的打包修订号。同一上游版本重打包时递增，且只增不减。

</details>

<details>
<summary><b>为什么没有应用内更新？</b></summary>

<br/>

原仓库为 macOS 做过一个绑定作者 Homebrew tap 的更新通道，本仓库弃用了它：更新统一走 Release，
避免依赖他人的 tap。需要 Homebrew 管理的话，用 Release 里生成的 cask 即可。

</details>

<details>
<summary><b>构建为什么这么挑剔？</b></summary>

<br/>

这个仓库的原则是「宁可失败，不发可疑产物」：未知的测试失败、签名校验不过、哈希不一致，都会
直接中断发布，而不是打标记放行 —— 唯一例外是上面登记的三个上游自带测试缺陷。

</details>

## 免责

个人社区构建，非 Nous Research 官方发布，也没有 Apple / 微软的发布者签名。请自行核对校验和，
并遵守所在环境的安全策略。源码遵循上游 MIT 许可。

[badge-build]: https://github.com/jiege6-66/hermes-desktop-builds/actions/workflows/build.yml/badge.svg
[link-build]: https://github.com/jiege6-66/hermes-desktop-builds/actions/workflows/build.yml
[badge-release]: https://img.shields.io/github/v/release/jiege6-66/hermes-desktop-builds?display_name=tag&sort=semver&color=blue
[link-release]: https://github.com/jiege6-66/hermes-desktop-builds/releases
[badge-license]: https://img.shields.io/badge/license-MIT-green
[link-license]: ./LICENSE
[badge-platform]: https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey
