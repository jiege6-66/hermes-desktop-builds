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

## 步骤必须有超时

第一轮里四条线全都“编译完了但没结束”：打包、签名、ASAR 校验都在 4–12 分钟内完成，然后卡在启动冒烟上，
一直到 70 分钟的 job 上限被杀。两个原因叠在一起：

- `smoke.mjs` 里调用了一个在首启状态下永远不会返回的 IPC：`window.hermesDesktop.getVersion()`。
  上游这个 handler 会先 `await detectRendererSkew()` / `resolveHermesVersion()`，没有后端时 Promise 一直挂着，
  而 Playwright 的 `page.evaluate` 没有超时，于是整步无限等。
- `common.run()` 只读子进程的 stdout 直到 EOF。Electron 的后代进程握着这个管道，父进程退出后管道关不上，
  这一步也就永远不返回。

现在两头都收紧：`run()` 支持 `timeout`，超时就杀掉整个进程组（子进程跑在独立 session 里），并把最后几十行
输出带进异常；不再等管道 EOF。`smoke.mjs` 里每个 await 都有上限，另有 330 秒的总看门狗，超时会落一份
`smoke-diagnostics.json`（URL、页面文本、控制台错误）。版本仍然要核对，但改成从主进程读 `app.getVersion()`，
那条在首启阶段就能立刻返回。

## Linux 上的全量测试要短路径、空磁盘和 uv

冒烟通了之后，Linux 那条在收尾的全量套件（15218 项）里还有一批失败，原因是环境而不是代码：

- **unix socket 路径超长**。上游的 gateway 测试把 socket 放在 `TMPDIR` 下，CI 的 checkout 路径是双份
  `/home/runner/work/<repo>/<repo>`，`sun_path` 只有 108 字节，`listen()` 直接失败——表现出来是
  `ENOENT ... chmod`、`EADDRINUSE` 或 30 秒超时。给全量套件单独指一个短的临时根目录即可。
- **缺 `uv`**。`source-backend.test.ts` 里有一句 `assert uv, "real uv must be prepared on PATH"`，
  装一个锁定版本的 `uv` 就过。
- **磁盘写满**。套件给每个用例写临时树，而打包产物树此时已经校验完、归档完毕，删掉 `packed`/`bundle`/`dmg*`
  腾出空间，否则会看到 `ENOSPC: no space left on device`。
