# Hermes 桌面端构建（个人 fork）

简体中文 · [English](README.en.md)

基于官方 [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) 的固定发布版本，
重新打包**真正的 Hermes Electron 桌面端**，产出 macOS（arm64 / x64）、Windows x64、Linux x64 四个原生包。

本仓库 fork 自 [`frankhommers/hermes-desktop-builds`](https://github.com/frankhommers/hermes-desktop-builds)，
**去掉了原仓库维护的三个社区源码补丁**，因此构建的是**原样的上游代码树**，不需要在每次上游更新后
重做补丁适配。它是构建 / 分发仓库，不是 Hermes 的分支，也不是 Nous Research 官方发布。

## 与原仓库的差异

| 方面 | 本 fork |
|---|---|
| 源码补丁 | 无。`patches/manifest.json` 是显式空集，构建会验证源码树保持原样（`sourceClean: true`）。 |
| 版本来源 | 上游发布树里 `apps/desktop/package.json` 固定是占位符 `0.0.0`，真实版本由发布 tag 决定：`vX.Y.Z` → `X.Y.Z`，打包时用 `-c.extraMetadata.version` 注入，应用内显示的就是这个版本。 |
| 首次启动 | 保持上游原生行为：同时提供“本地安装”和“Connect to existing Hermes”，远程表单一次点击即可进入（不再默认直达、也不再隐藏本地安装入口）。 |
| 应用内更新 | 没有。更新只通过 Release 产物 / 生成的 cask 完成。 |
| macOS 产物 | `-adhoc.zip`（逐字节校验用）**和** `-adhoc.dmg`（可挂载、含 `Applications` 快捷方式）。 |
| 仓库标识 | `jiege6-66/hermes-desktop-builds`；每日更新器、发布流程、生成的 cask 都指向这里。 |

## 如何跟随官方更新

`.github/workflows/update-upstream.yml` 每天 03:17 UTC 以及手动触发时运行：

1. **只读**发现 `NousResearch/hermes-agent` 最新的正式（非 draft、非 prerelease）发布，不跟随 `main`。
2. 把 tag 解析成确切 commit 并校验祖先关系，杜绝源码版本倒退。
3. 推导应用版本：`package.json` 里是真实版本就优先用它；是 `0.0.0` 占位符则改用发布 tag；其他异常值一律拒绝。
4. 只快进 `upstream.json`，随后显式派发原生构建，并校验构建仓库提交未变；写入竞争会中止更新。

`build.yml` 在四条原生流水线全部通过后才上传产物；`release.yml` 再校验构建回执、四份 manifest、
ZIP/DMG 哈希和上传资产摘要，才发布带版本号的 Release。任何一步失败都不会动上一版，pin 会保留，
下一次每日检查可以重试。

版本号规则：下游版本 = `<上游版本>.<修订号>`，例如上游 `v0.22.5` → 首次构建 `0.22.5.1`，修订号只增不减。

## 构建流水线的几个关键点

下面几处都是适配当前上游（Electron 44、electron-builder 27、`@electron/osx-sign` 2.x）时踩出来的：

- **打包走上游自己的 prepared packaging 入口**（`npm run builder -- …`）。直接调 electron-builder 会在这个
  monorepo 上因 npm workspace 依赖扫描而内存爆炸（4 GiB 快速 OOM，16 GiB 会把 runner 拖死）；上游 wrapper
  会先准备隔离输入再调用 electron-builder，内存稳定。
- **macOS 签名顺序**：prepared packaging 会用它自己暂存的 native 覆盖 `dist`，所以打包后先给
  `app.asar.unpacked` 里的 Mach-O 逐个 ad-hoc 签名（`scripts/macos_signing.py --payload`），再给整个
  bundle 封签；随后逐个 `codesign --verify` 并比对数量。
- **ASAR 校验**：unpacked 条目签名后字节数会大于 asar 头部记录的尺寸，`inspect.mjs` 因此只对 packed 条目
  做尺寸/完整性校验，unpacked 条目由代码签名担保。
- **Linux 冒烟**：Electron 44 在 runner 上用 `--ozone-platform=headless` 会 SIGSEGV，改为 `xvfb-run`
  起临时 X server；没有 xvfb 时才回退 headless。
- **上游自带测试缺陷**：`v0.22.5` 这棵原样树上有三个上游测试会失败（`stage-native-deps` 的 HUD 警告文案、
  `voice-prefs` 两处 localStorage spy）。它们按“commit + 文件 + 用例全名”登记在 `scripts/common.py` 的
  `UPSTREAM_TEST_DEFECTS` 并附原因；其他任何失败仍然阻断发布。

## 下载与安装

从 [Releases](https://github.com/jiege6-66/hermes-desktop-builds/releases) 取。每个 Release 都带
`SHA256SUMS`、源码 pin、各平台证据 ZIP 和生成的 `hermes-desktop.rb` cask。本 fork 不维护 tap，
需要时下载 cask 后执行 `brew install --cask ./hermes-desktop.rb`。

### macOS

1. 下载 `Hermes-<版本>-darwin-<架构>-adhoc.dmg`（或 ZIP），用 `SHA256SUMS` 核对。
2. 打开 dmg，把 `Hermes.app` 拖进“应用程序”。
3. 包是 **ad-hoc 签名**，没有 Developer ID、也没做 Apple 公证，Gatekeeper 会拦截；核对校验和之后，
   用“系统设置 → 隐私与安全性 → 仍要打开”手动放行一次。不要关闭 Gatekeeper/SIP，不要全局移除隔离属性。
4. 怀疑包有问题时先诊断，不要自己重新签名：

```sh
APP="/Applications/Hermes.app"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute -vv "$APP"
```

`codesign` 必须通过；`spctl` 仍会拒绝未公证的 ad-hoc 发布者——那是“发布者信任”问题，不是包损坏。
要做到双击无警告，需要 Apple Developer Program（Developer ID Application，打 pkg 还需 Installer 证书）
并在独立通道里存公证凭据，本 fork 不使用。

### Windows

`Get-FileHash -Algorithm SHA256` 核对后，把整个 ZIP 解压到新目录再运行 `Hermes/Hermes.exe`。
产物无 Authenticode 签名，SmartScreen 会警告；不要为了绕过组织策略而关闭防护。

### Linux

`sha256sum` 核对后 `tar -xzf` 解压到新目录，在图形会话里运行 `./Hermes/Hermes`。需要系统自带的
Electron/Chromium 图形库；压缩包不会注册桌面启动器。

## 当前状态

- **更新器已修复并验证**：能识别 `0.0.0` 占位符并从发布 tag 取版本；pin 已推进到 `v0.22.5`
  （下游 `0.22.5.1`），`apply` 的提交、推送、派发链路已实际跑通。
- **四平台原生构建仍在稳定中**：打包 OOM、Mac 签名顺序、ASAR 校验、Linux 冒烟这几处已逐项修掉，
  剩余环节仍在 CI 上逐轮验证。构建未全绿时不会发 Release，上一版保持可用。
- 查看当前进展：

```sh
gh run list --repo jiege6-66/hermes-desktop-builds --limit 5
gh run view <run-id> --repo jiege6-66/hermes-desktop-builds --log-failed
```

## 本地复现

`upstream.json` 固定上游 commit、版本、修订号和 Node 版本。准备目标系统的干净检出，装好 Git、该版本
Node 和 Python ≥ 3.11（Linux 还需要 `make`/`gcc` 等基础编译工具链）：

```sh
python3 -m unittest discover -s tests -v
node --test tests/asar-paths.test.mjs tests/macos-signing.test.mjs
python3 scripts/build.py --run        # 只构建当前主机，产物写入 out/
```

构建会拉取确切的公开 commit、拒绝复用旧的 `.work/src`、按哈希校验（此 fork 为空的）补丁集、
用 `npm ci`（先禁用生命周期脚本）安装依赖、显式安装 Electron，再走上游的构建/暂存/打包钩子。
缓存与测试 HOME 都在 `.work/` 下，产物在 `out/` 下。Linux 桌面冒烟需要 X server，本地可先装 `xvfb`。

手动恢复流程：`gh workflow run build.yml --ref main`，然后
`python3 scripts/ci_receipt.py --run <run-id>`、`python3 scripts/release.py --downloads …`。

## 目录

- `upstream.json` — 源码 pin（仓库、commit、版本、修订号、Node）。
- `patches/manifest.json` — 显式补丁集（本 fork 为空）及其哈希。
- `scripts/update_upstream.py` — 每日发现 / 计划 / 落地更新。
- `scripts/build.py` — 原生拉取、校验、打包（ZIP + DMG）、启动冒烟。
- `scripts/inspect.mjs`、`scripts/smoke.mjs` — ASAR 与安装戳检查、真实启动验证。
- `scripts/macos_signing.py`、`scripts/sign-macos.mjs` — Mac payload 与 bundle 的签名及校验。
- `scripts/release.py`、`scripts/ci_receipt.py` — 只允许已验证产物的发布流程。
- `mainstream/` — 原仓库遗留的一次性安装器方案，本 fork 的 workflow 不会执行。

## 免责

这是个人的社区构建，不是 Nous Research 官方发布，也没有 Apple/微软的发布者签名。请自行核对校验和，
并遵守所在环境的安全策略。
