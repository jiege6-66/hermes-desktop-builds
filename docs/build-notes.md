# 构建笔记

README 里放不下的细节记在这里，主要是我在把流水线接回当前上游时遇到的问题。

上游最近换了不少东西：Electron 44、electron-builder 27、`@electron/osx-sign` 2.x。

## 打包要走上游自己的 prepared packaging 入口

直接调 electron-builder 打包，它会解析整个 npm workspace 的依赖，然后吃光内存：4 GiB 堆几十秒就 OOM，
加到 16 GiB 直接把 runner 拖死。上游的 wrapper 会先把输入准备到隔离目录，再叫 electron-builder，内存就正常：

```sh
npm run builder -- --linux --dir --x64 --publish never \
  -c.extraMetadata.version=<version> -c.directories.output=<out>
```

## macOS 的签名顺序

prepared packaging 会拿它自己那份 native 覆盖 `dist`，所以只能按这个顺序：

1. 打包完，先把 `app.asar.unpacked` 里的 Mach-O 一个个 ad-hoc 签掉；
2. 再签整个 `Hermes.app`；
3. 每个 native 跑一遍 `codesign --verify`，数一遍个数，再做篡改和缺 seal 的负例。

签名发生在写入 ASAR 之后，这些 unpacked 文件的字节数会比 asar 头里记的大。它们靠代码签名担保，
`inspect.mjs` 只对打进 asar 的条目查尺寸和完整性。

## Linux 冒烟要用 xvfb

Electron 44 在托管 runner 上加 `--ozone-platform=headless` 会 SIGSEGV。改用
`xvfb-run -a -s '-screen 0 1280x1024x24'` 起临时 X server 就正常，没装 xvfb 才退回 headless。

## 上游自己有三个测试是坏的

`v0.22.5` 这棵原样树上有三个测试本来就过不了：`stage-native-deps` 的一个警告文案、`voice-prefs` 两个
localStorage spy。它们按「commit + 文件 + 用例名」记在 `scripts/common.py` 的 `UPSTREAM_TEST_DEFECTS`，
写了为什么放行。除此之外的任何失败照样拦发布。

## 手动补发一次

```sh
gh workflow run build.yml --ref main
python3 scripts/ci_receipt.py --run <run-id>
python3 scripts/release.py --downloads out/downloads --destination out/release \
  --run-url https://github.com/jiege6-66/hermes-desktop-builds/actions/runs/<run-id>
```

## 目录

```text
upstream.json                源码 pin：仓库 / commit / 版本 / 修订号 / Node
patches/manifest.json        补丁集（这里是空的）和哈希
scripts/update_upstream.py   每日发现 → 计划 → 落地
scripts/build.py             拉取、校验、打包（zip + dmg）、冒烟
scripts/inspect.mjs          查 ASAR 和安装戳
scripts/smoke.mjs            真启动一次
scripts/macos_signing.py     Mac payload / bundle 签名与校验
scripts/release.py           只认验证过的产物发版
scripts/ci_receipt.py        发布前核对 CI 回执
```
