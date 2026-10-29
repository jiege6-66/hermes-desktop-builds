<div align="center">

# Hermes Desktop 构建

把官方 Hermes 桌面端重新打包，做成 macOS / Windows / Linux 能直接装的应用

[![Build][badge-build]][link-build]
[![Latest release][badge-release]][link-release]
[![License][badge-license]][link-license]
[![Platform][badge-platform]][link-release]

简体中文 · [English](README.en.md)

</div>

---

从 [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) 的某个正式发布版本
拉源码，在四台原生机器上编译、签名、验证，产出安装包。个人维护，不碰上游代码，也不掺自己的补丁。

不是 Hermes 的分支，不是 Nous Research 官方发布，没有 Apple / 微软的开发者签名。

## 目录

- [下载安装](#下载安装)
- [这个仓库在干什么](#这个仓库在干什么)
- [和原仓库的区别](#和原仓库的区别)
- [怎么跟着官方更新](#怎么跟着官方更新)
- [踩过的坑](#踩过的坑)
- [现在是什么状态](#现在是什么状态)
- [本地构建](#本地构建)
- [仓库结构](#仓库结构)
- [常见问题](#常见问题)

## 下载安装

文件都在 [Releases][link-release] 里，按平台挑：

| 平台 | 文件 | 怎么装 |
| :--- | :--- | :--- |
| macOS（Apple Silicon） | `Hermes-<版本>-darwin-arm64-adhoc.dmg` | 打开 dmg，把 `Hermes.app` 拖进「应用程序」 |
| macOS（Intel） | `Hermes-<版本>-darwin-x64-adhoc.dmg` | 同上 |
| Windows x64 | `Hermes-<版本>-win32-x64-unsigned.zip` | 整个压缩包解到一个新目录，跑 `Hermes\Hermes.exe` |
| Linux x64 | `Hermes-<版本>-linux-x64-unsigned.tar.gz` | 解压到新目录，在图形界面里跑 `./Hermes/Hermes` |

每个 Release 还带了 `SHA256SUMS`、源码 pin、各平台的验证日志，以及一份 `hermes-desktop.rb`。
这个仓库不维护 tap，想要 Homebrew 管的话，把那份 cask 下载下来
`brew install --cask ./hermes-desktop.rb` 就行。

<details>
<summary><b>macOS 说「无法验证开发者」，怎么办</b></summary>

<br/>

因为包是 ad-hoc 签名的，没有 Developer ID，也没做公证，Gatekeeper 必然会拦。先对一遍
`SHA256SUMS`，然后去「系统设置 → 隐私与安全性 → 仍要打开」放行一次。别关 Gatekeeper 或 SIP，
也别全局关隔离属性。

真怀疑包坏了，先跑这两条看看到底是哪种问题：

```sh
APP="/Applications/Hermes.app"
codesign --verify --deep --strict --verbose=2 "$APP"   # 这条必须过
spctl --assess --type execute -vv "$APP"               # 这条会拒，正常
```

`codesign` 过、`spctl` 拒，说明包没事，只是没人给它背书。要做到双击不弹窗，得有 Apple 开发者账号
（Developer ID Application，做 pkg 还要 Installer 证书）并走公证，这个仓库没走这条路。

</details>

## 这个仓库在干什么

打的是官方 Electron 桌面端本体：真 UI、真原生模块、真 Electron 运行时。不塞 Python 运行环境，
不塞 agent 源码，不塞任何凭据或私人后端地址。

构建跑在 GitHub 的公共 runner 上，构建作业只有 `contents: read` 权限，拿不到签名密钥和 API token。
四个平台全过才发版；任何一步没过，上一版继续挂着，源码 pin 留着下次重试。

## 和原仓库的区别

fork 自 [`frankhommers/hermes-desktop-builds`](https://github.com/frankhommers/hermes-desktop-builds)。

| 方面 | 这个仓库 |
| :--- | :--- |
| 源码补丁 | 没有。`patches/manifest.json` 是空集，构建会核对代码树和 pin 一致 |
| 版本号 | 上游树里 `package.json` 永远是 `0.0.0`，真实版本从发布 tag 来：`vX.Y.Z` → `X.Y.Z` |
| 首次启动 | 上游原样：「本地安装」和「Connect to existing Hermes」都在 |
| 应用内更新 | 没有。更新只看 Release 和生成的 cask |
| macOS 产物 | zip 用来做逐字节校验，dmg 给人装 |

## 怎么跟着官方更新

`.github/workflows/update-upstream.yml` 每天 03:17 UTC 跑一次：

```text
① 查最新发布   NousResearch/hermes-agent 的正式版，不跟 main
② 核对来源     tag 解成 commit，查祖先关系，版本倒退直接停
③ 定版本号     树里有真版本就用它；是 0.0.0 就用 tag；别的值一律失败
④ 只改 pin     只动 upstream.json，然后派发原生构建
```

版本号是 `<上游版本>.<打包修订号>`，后面那段只加不减：

```text
上游 v0.22.5  →  第一次打 0.22.5.1  →  重打 0.22.5.2
```

## 踩过的坑

上游这半年换了不少东西（Electron 44、electron-builder 27、`@electron/osx-sign` 2.x），下面这些是
为了让流水线重新跑起来才改的：

<details>
<summary><b>打包必须走上游自己的 prepared packaging 入口</b></summary>

<br/>

直接叫 electron-builder 打包，它会去解析整个 npm workspace 的依赖，然后吃光内存——4 GiB 堆几十秒
就 OOM，加到 16 GiB 直接把 runner 拖死。上游的 wrapper 会先把输入准备到隔离目录再叫 electron-builder，
内存就稳了：

```sh
npm run builder -- --linux --dir --x64 --publish never \
  -c.extraMetadata.version=<version> -c.directories.output=<out>
```

</details>

<details>
<summary><b>macOS 的签名顺序有讲究</b></summary>

<br/>

prepared packaging 会拿它自己那份 native 覆盖 `dist`，所以顺序只能是：

1. 打包完，先把 `app.asar.unpacked` 里的 Mach-O 一个个 ad-hoc 签掉；
2. 再签整个 `Hermes.app`；
3. 每个 native 跑一遍 `codesign --verify`、数一遍个数，再做篡改和缺 seal 的负例。

因为签名发生在写入 ASAR 之后，这些 unpacked 文件的字节数会比 asar 头里记的大。这类条目靠代码签名
担保，`inspect.mjs` 只对打进 asar 的条目查尺寸和完整性。

</details>

<details>
<summary><b>Linux 冒烟得用 xvfb</b></summary>

<br/>

Electron 44 在托管 runner 上加 `--ozone-platform=headless` 会直接 SIGSEGV。改成
`xvfb-run -a -s '-screen 0 1280x1024x24'` 起个临时 X server 就没事，没装 xvfb 才退回 headless。

</details>

<details>
<summary><b>上游自己有三个测试是坏的</b></summary>

<br/>

`v0.22.5` 这棵原样树上有三个测试本来就过不了：`stage-native-deps` 的一个警告文案、`voice-prefs`
两个 localStorage spy。它们按「commit + 文件 + 用例名」记在 `scripts/common.py` 的
`UPSTREAM_TEST_DEFECTS` 里，写了为什么放行。除此之外的任何失败照样拦发布。

</details>

## 现在是什么状态

| 环节 | 情况 |
| :--- | :--- |
| 版本跟随（占位符 → tag 版本） | 好了。pin 已推到 `v0.22.5`，下游 `0.22.5.1` |
| 更新器的提交 / 推送 / 派发 | 好了，真跑过一遍 |
| 四平台原生构建 | 还没通。打包 OOM、Mac 签名、ASAR 校验、Linux 冒烟都改完了，剩下的还在 CI 里一个个过 |

没全绿就不发 Release，上一版继续能用。想看进展：

```sh
gh run list --repo jiege6-66/hermes-desktop-builds --limit 5
gh run view <run-id> --repo jiege6-66/hermes-desktop-builds --log-failed
```

上面那枚 build 徽章现在是红的，那是实话，不是图挂了。

## 本地构建

`upstream.json` 钉住了上游 commit、版本、修订号和 Node 版本。找台干净的机器，装 Git、对应版本的
Node、Python 3.11 以上（Linux 还要 `make`/`gcc`）：

```sh
python3 -m unittest discover -s tests -v
node --test tests/asar-paths.test.mjs tests/macos-signing.test.mjs
python3 scripts/build.py --run        # 只打当前这台，产物在 out/
```

<details>
<summary><b>构建到底做了些什么</b></summary>

<br/>

拉那个确切的 commit（旧的 `.work/src` 不复用）→ 核对补丁集哈希（这里是空的）→ `npm ci` 装依赖
（先关掉生命周期脚本）→ 单独装 Electron → 走上游的构建 / 暂存 / 打包钩子 → 签名（只有 macOS）→
查 ASAR 和安装戳 → 打包 → 解回来逐字节比对 → 真启动一次 → 跑测试门禁。

缓存和测试用的 HOME 都在 `.work/`，产物在 `out/`。Linux 上桌面冒烟得有 X server，本地先装个
`xvfb` 就行。

</details>

<details>
<summary><b>手动补发一次</b></summary>

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
├── patches/manifest.json          # 补丁集（这里是空的）和哈希
├── scripts/
│   ├── update_upstream.py         # 每日发现 → 计划 → 落地
│   ├── build.py                   # 拉取、校验、打包（zip + dmg）、冒烟
│   ├── inspect.mjs / smoke.mjs    # 查 ASAR 和安装戳、真启动
│   ├── macos_signing.py           # Mac 的 payload / bundle 签名与校验
│   └── release.py / ci_receipt.py # 只认验证过的产物发版
└── .github/workflows/             # 更新、构建、发布三条流水线
```

## 常见问题

<details>
<summary><b>版本号为什么是 <code>0.22.5.1</code> 四段</b></summary>

<br/>

前三段是上游发布 tag，最后一段是这个仓库的打包次数。同一个上游版本重打就往上加，不会减。

</details>

<details>
<summary><b>为什么没有应用内更新</b></summary>

<br/>

原仓库给 macOS 做过一个更新通道，绑定的是作者自己的 Homebrew tap。这里把它去掉了，更新统一看
Release，免得依赖别人的 tap。想让 Homebrew 管，用 Release 里那份 cask。

</details>

<details>
<summary><b>为什么这么较真，一点问题就不发版</b></summary>

<br/>

因为发出去的东西别人会直接装。测试挂了、签名不过、哈希对不上，就直接停下——打标记放行这种事不做。
唯一的例外是上面写的那三个上游自带坏测试。

</details>

## 免责

自己用的社区构建，不是 Nous Research 官方发布，也没有 Apple / 微软的签名。装之前自己对校验和，
按你所在环境的安全要求来。源码跟随上游 MIT 许可。

[badge-build]: https://github.com/jiege6-66/hermes-desktop-builds/actions/workflows/build.yml/badge.svg
[link-build]: https://github.com/jiege6-66/hermes-desktop-builds/actions/workflows/build.yml
[badge-release]: https://img.shields.io/github/v/release/jiege6-66/hermes-desktop-builds?display_name=tag&sort=semver&color=blue
[link-release]: https://github.com/jiege6-66/hermes-desktop-builds/releases
[badge-license]: https://img.shields.io/badge/license-MIT-green
[link-license]: ./LICENSE
[badge-platform]: https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey
