# 探索者启动器

**简体中文** · [English](README.en.md)

[![Latest release](https://img.shields.io/github/v/release/Dontdrunk/Comfyui-EL-Launcher?label=Release)](https://github.com/Dontdrunk/Comfyui-EL-Launcher/releases/latest) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

面向 **ComfyUI 官方 Windows 便携版** 的桌面启动与管理工具。启动和停止 ComfyUI、切换版本与回滚备份、安装和更新插件、核对 Python 依赖、清理模型文件，都在一个窗口里完成。界面为工业仪表台风格，配色取自 ComfyUI 官方前端调色板，支持暗色 / 亮色主题。

**[下载最新版](https://github.com/Dontdrunk/Comfyui-EL-Launcher/releases/latest)** · **[报告问题](https://github.com/Dontdrunk/Comfyui-EL-Launcher/issues)** · **[English](README.en.md)**

## 功能

### 首页 · 启动 ComfyUI

- 环境读数：ComfyUI 版本、Python、PyTorch、GPU、服务端口、启动器版本。
- 启动与停止：GPU / CPU 模式、监听 IP 与端口、允许局域网访问、就绪后自动打开 Web 界面、`--fast fp16_accumulation`、`--disable-api-nodes`、附加启动参数。
- 端口预检：启动前检查端口占用，列出 PID、进程名与命令行，确认后可「结束并启动」；占着端口的是本机这套 ComfyUI（包括上次异常退出留下的进程）时直接接管。
- 就绪判定：轮询 `/system_stats`，通过后才算运行中；同时记录完整启动命令行，便于排障。
- 实时日志：与服务进程共用 3000 行环形缓冲，UTF-8 解码，并对中文 Windows 控制台做 GBK 兜底。
- 启动参数预设：标准、低显存、全显存、预览增强、离线 5 套内置预设，可另存自定义；手工改动任意一项会脱离预设。
- 启动器自更新：读取 GitHub Release 的 `latest.yml`，校验 SHA-512 后静默安装（安装版）或替换便携版并重启。

### 版本管理

- 当前版本读数：HEAD 的 tag / 分支 / 提交、工作区改动与 stash、ComfyUI 版本号。
- 更新判断：从 GitHub Releases 取最新发版，用 `git describe --contains` 判断当前提交是否在发版线上，区分「落后 / 已最新 / 开发线提前」。
- 版本列表：「发版版本」与「全部提交」两个范围，支持搜索与继续加载更早提交。
- 切换版本：先给出计划——是否需要定向浅取、是否 stash 脏工作区、是否自动备份、`requirements.txt` 差异、服务运行等阻断项；确认后执行 checkout，依赖清单有差异时切换完成后自动同步（也可在工具栏手动触发）。
- 版本备份：清单式备份 `version.json`、`custom_nodes.json`、`user/` 配置与 `extra_model_paths.yaml`，支持创建、还原、删除；列表显示备份时的提交、插件数与是否已还原。目录在 `<ComfyUI 根目录>\_explorer-launcher\backups`，不进 git。
- 依赖同步：对比 `requirements.txt` 后执行 pip 安装。
- 会改动 ComfyUI 目录的操作在服务运行时先要求停服。

### 插件管理

- 已装插件：启用状态、名称与目录名、依赖状态、仓库地址、当前 commit 与提交时间、远端更新标记。
- 安装：从 ComfyUI Registry（`api.comfy.org`，服务端检索 + 本地按名称筛选与分页）搜索安装，或粘贴 Git 仓库地址安装；装完自动尝试安装该插件的 `requirements.txt`。
- 启用 / 禁用：重命名 `.disabled` 后缀（ComfyUI 原生机制）；卸载直接永久删除插件目录（不进回收站），不删除共用依赖。
- 更新：逐个检查远端，支持单个更新与一键更新，批量结果按成功 / 失败分开统计。
- 版本切换：读取插件仓库的本地分支与提交，checkout 到指定 ref。
- 依赖体检：一次 Python 调用核对全部插件依赖；单个插件可查看 `requirements.txt` 约束与实际安装版本，逐项安装 / 重装，也可重装所有插件依赖。

### 模型管理

- 扫描 `models/` 目录：文件夹树、总体积与文件数、逐项体积。
- 定位文件、移入系统回收站；路径做越界防护。
- 展示根目录所在卷的剩余 / 总容量。

### 环境管理

- 已装 pip 包清单与搜索。
- 安装：包名或版本约束，或从 `.whl` / `requirements.txt` 文件安装。
- 卸载、按当前版本强制重装、打开包在 `site-packages` 中的目录。
- `pip freeze` 备份与按清单恢复，备份位于 `<ComfyUI 根目录>\_explorer-launcher\env-backups`。

### 控制台

- ComfyUI 与服务端任务（git、pip、版本切换）共用的实时日志，一键清空。

### 设置

- ComfyUI 便携版根目录：选择、校验、目录状态与问题提示。
- 启动设置：监听 IP / 端口、允许其它设备访问、就绪后自动打开、附加启动参数。
- 主题：标题栏切换，写入配置后跨启动保留。

### 托盘

- 关闭窗口只收进托盘，ComfyUI 继续运行；托盘菜单提供打开 / 设置 / 退出。

## 运行环境

面向 ComfyUI 官方便携版，根目录至少包含：

```text
<ComfyUI 根目录>\
├─ python_embeded\python.exe     内置解释器
├─ ComfyUI\main.py               ComfyUI 入口（本身是 git 仓库）
├─ ComfyUI\custom_nodes\         插件目录
├─ ComfyUI\models\               模型目录
└─ update\update.py              官方更新脚本（可选）
```

- 系统：Windows 10 / 11 x64；启动器不需要管理员权限。
- 版本管理需要系统已安装 Git 并加入 `PATH`；插件与依赖安装使用便携版内置的 `python_embeded`，不依赖系统 Python。
- 已在 Windows 11 + ComfyUI v0.40.0（Python 3.13 / torch 2.14 + cu130）+ RTX 4070 Ti 上验证。

## 技术方案

### 技术栈

| 层       | 选型                                                                     |
| -------- | ------------------------------------------------------------------------ |
| 桌面外壳 | Electron 45（main + preload + renderer），electron-builder 打包          |
| 渲染层   | React 19 + TanStack Router（文件路由）+ TanStack Query + zustand         |
| 样式     | Tailwind CSS 4 + shadcn/ui（Base UI），构建在 `packages/ui`              |
| 工具链   | Vite+（`vp`）：dev / build / check / test / package，Vitest + Playwright |
| 共享契约 | `packages/electron`：IPC 通道常量、领域类型、`LauncherApi`、启动参数构建 |

### 进程与代码分层

| 位置                       | 职责                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/main`    | 窗口、托盘、自绘标题栏、自更新，以及全部系统服务：设置、环境探测、进程、版本、备份、插件、pip、模型 |
| `apps/desktop/src/preload` | 只做通道搬运：`contextBridge` 暴露 `window.launcher: LauncherApi`，订阅主进程事件                   |
| `apps/web/src/routes`      | TanStack Router 文件路由，页面切换的唯一来源；托盘跳转也走同一套路由                                |
| `apps/web/src/launcher`    | 页面、组件、样式与 zustand store（仪表台界面实现）                                                  |
| `packages/electron`        | 主进程与渲染进程共用的唯一类型契约；新增能力先加通道与类型，再实现                                  |
| `packages/ui`              | shadcn/ui 组件与 Tailwind 主题                                                                      |

打包后，主进程用自定义协议提供构建产物（`https://app.localhost/`，带 SPA 回退），窗口加载 `apps/web/dist`；开发模式直连 Vite 开发服务器。

### 与 ComfyUI 的交互

- **启动**：`python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --port <port>`，再按设置追加 `--cpu`、`--listen`、`--disable-auto-launch`、`--fast fp16_accumulation`、`--disable-api-nodes` 与自定义参数。
- **就绪**：轮询 `http://<host>:<port>/system_stats`，通过才置为 running；停止时结束整棵进程树，不留占显存的孤儿进程。
- **版本**：直接操作 `ComfyUI/.git`。远端 tag 用 `git fetch --depth=1 origin refs/tags/<tag>:refs/tags/<tag>` 定向浅取（便携版本身是浅克隆）；不使用官方 `update.py`，因为它只能升到最新，无法回滚。
- **插件**：数据来自 ComfyUI Registry。关键字过滤必须用 `/nodes/search`，`/nodes?search=` 会忽略参数恒定返回同一页；代码用 `git clone`，依赖用内置 pip 安装，全流程不要求 ComfyUI 服务运行。
- **模型**：只读扫描 `models/`，删除走系统回收站（`shell.trashItem`）。
- **依赖**：统一用 `python_embeded -s -m pip`，子进程注入 `PYTHONUTF8=1`；长任务进任务中心，日志同时进控制台。

### 本地数据与网络

| 位置                                              | 内容                                  |
| ------------------------------------------------- | ------------------------------------- |
| `%APPDATA%\explorer-launcher\config.json`         | 设置与预设，临时文件 + 原子重命名写入 |
| `%APPDATA%\explorer-launcher\logs\launcher.log`   | 启动里程碑、未捕获异常与自更新日志    |
| `%APPDATA%\explorer-launcher\cache\releases.json` | GitHub Releases 缓存，断网时回退      |
| `<ComfyUI 根目录>\_explorer-launcher\backups`     | 版本备份                              |
| `<ComfyUI 根目录>\_explorer-launcher\env-backups` | `pip freeze` 环境清单                 |

- 网络请求走 Electron 的 `session.fetch` / `net`，自动继承系统代理。
- 更新源配置在 `apps/desktop/electron-builder.yml`（appId `com.xlauncher.comfyui`，publish 指向 `Dontdrunk/Comfyui-EL-Launcher`）；`selfUpdate.ts` 的 owner / repo 必须与它一致。

### 界面约定（仪表台）

- 0 圆角与 1px 发丝线分层，不用投影 / 渐变；圆只用于状态点、开关滑块与比例端点。
- 语义色分点线（`--ok` / `--warn` / `--danger`）、文字（`--ok-text` / `--warn-text` / `--danger-text`）与实心填充（`--danger-solid`），跨角色复用会拉低对比度。
- 服务状态只在底部状态轨道出现一次；中文标签不做 uppercase / letter-spacing；等宽体只给数字、路径、提交号与端口。
- 界面全中文，枚举值经映射后再显示，不直接渲染后端原始值。
- `vp run check:contrast` 守 token 配色的 WCAG 对比度。

## 接口与数据契约

契约只有一份：`packages/electron/src`。新增能力时先在这里加通道与类型，再由主进程注册、preload 暴露、渲染进程消费。

- `ipc.ts`：全部通道常量。
- `types.ts`：领域模型、`LauncherApi`、`OpResult` 等。
- `launch-command.ts`：启动参数构建与预览。

### IPC 通道

通道常量集中定义在 `packages/electron/src/ipc.ts`：

- **设置**：`settings:get`、`settings:patch`、`dialog:pickDirectory` —— 读取 / 增量写入设置，选择目录。
- **环境**：`env:check`、`env:probeRuntime`、`env:probeDisk` —— 目录结构（快）、Python / torch / CUDA / GPU（慢）、磁盘容量。
- **服务进程**：`service:status`、`service:start`、`service:stop`、`service:killPortOwner`、`service:logs`、`service:logsClear` —— ComfyUI 进程与日志。
- **任务**：`job:list`、`job:get`、`job:cancel` —— 长任务查询与取消。
- **版本**：`git:check`、`version:state`、`version:remoteTags`、`version:commits`、`version:fetchRemote`、`version:checkUpdate`、`version:plan`、`version:switch`、`version:syncDeps`、`version:officialUpdate` —— 版本状态、更新检查、切换计划与执行、依赖同步、官方 update.py 通道。
- **备份**：`backup:list`、`backup:detail`、`backup:create`、`backup:restore`、`backup:delete`、`backup:dir` —— 版本备份。
- **插件**：`nodes:list`、`nodes:search`、`nodes:installRegistry`、`nodes:installGit`、`nodes:setEnabled`、`nodes:update`、`nodes:updateAll`、`nodes:uninstall`、`nodes:installDeps`、`nodes:checkDeps`、`nodes:checkUpdates`、`nodes:depsDetail`、`nodes:releases`、`nodes:checkout`、`nodes:depInstall`、`nodes:reinstallAllDeps` —— 已装列表、Registry 搜索、安装、更新、依赖与版本切换。
- **pip 环境**：`pip:list`、`pip:install`、`pip:uninstall`、`pip:reinstall`、`pip:locate`、`pip:backups`、`pip:backup`、`pip:restore`、`dialog:pickPipFile` —— 包管理与 `pip freeze` 备份。
- **模型**：`models:scan`、`models:delete`、`models:reveal`、`models:dir` —— 扫描、回收站删除、定位。
- **系统**：`shell:openExternal`、`shell:openPath`、`shell:showItemInFolder` —— 打开链接 / 路径 / 定位文件。
- **窗口**：`window:minimize`、`window:maximize`、`window:close`、`window:isMaximized` —— 无边框标题栏控制。
- **主进程 → 渲染进程**：`evt:log`、`evt:serviceStatus`、`evt:job`、`evt:navigate`、`tray-menu:act` —— 日志、服务状态、任务进度、托盘跳转。
- **启动器更新**：`self-update:status`、`self-update:install`、`evt:selfUpdate` —— 检查、下载安装、进度。

preload 把通道包装成 `LauncherApi`（`window.launcher`），渲染进程不直接接触 `ipcRenderer`。

### 长任务

所有耗时操作（git fetch / checkout、pip、安装插件、切换版本、还原备份）都返回 `OpResult<T>`：

```ts
type OpResult<T> =
  | { ok: true; jobId: string; value: T }
  | { ok: false; jobId: string; error: string };
```

同时在任务中心产生一条 `JobSnapshot`（`status`、`percent`、`lines`），进度通过 `evt:job` 推送，可随时取消。页面既能拿到结果，也能在控制台看到完整命令行记录。

### 核心数据结构

| 类型                       | 关键字段                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `AppSettings`              | `comfyRoot` `theme` `launch` `presets` `activePresetId`                                                            |
| `LaunchDefaults`           | `mode` `listen` `port` `remote` `autoOpenBrowser` `fastFp16` `disableApiNodes` `extraArgs`                         |
| `EnvLayout`                | `valid` `issues` `pythonExe` `comfyDir` `mainPy` `customNodesDir` `modelsDir` `isGitRepo` `appVersion` `diskUsage` |
| `RuntimeInfo`              | `pythonVersion` `torchVersion` `cudaVersion` `cudaAvailable` `gpuName` `deviceCount` `pipVersion`                  |
| `ServiceStatus`            | `state` `pid` `port` `url` `ready` `bootMs` `commandLine` `external` `portOwner` `portLive`                        |
| `VersionState`             | `head` `clean` `dirtyCount` `stashedCount` `refs` `release{newestTag, ahead, behind, willShipIn}`                  |
| `SwitchPlan`               | `target` `refKind` `fetched` `willStash` `willBackup` `requirementsDiff` `blockers` `warnings`                     |
| `InstalledNode`            | `dirName` `baseName` `enabled` `isGit` `remote` `commit` `branch` `version` `missingDeps` `hasUpdate`              |
| `ModelScanReport`          | `modelsDir` `totalSize` `totalFiles` `entries: ModelNode[]`                                                        |
| `JobSnapshot` / `JobEvent` | `id` `kind` `status` `percent` `lines`；事件为 `created` / `line` / `progress` / `finished`                        |

### 设置字段（config.json）

| 字段                     | 类型                | 默认值         | 说明                                       |
| ------------------------ | ------------------- | -------------- | ------------------------------------------ |
| `comfyRoot`              | string              | `""`（未配置） | 便携版根目录，未配置时所有页面先走配置引导 |
| `theme`                  | `"dark" \| "light"` | `dark`         | 主题，标题栏切换                           |
| `launch.mode`            | `"gpu" \| "cpu"`    | `gpu`          | 启动模式；`cpu` 追加 `--cpu`               |
| `launch.port`            | number              | `8188`         | `--port`                                   |
| `launch.remote`          | boolean             | `false`        | 开启后追加 `--listen <listen>`             |
| `launch.listen`          | string              | `127.0.0.1`    | 远程访问监听地址，留空按 `0.0.0.0`         |
| `launch.autoOpenBrowser` | boolean             | `true`         | 关闭时追加 `--disable-auto-launch`         |
| `launch.fastFp16`        | boolean             | `false`        | 追加 `--fast fp16_accumulation`            |
| `launch.disableApiNodes` | boolean             | `false`        | 追加 `--disable-api-nodes`                 |
| `launch.extraArgs`       | string              | `""`           | 附加参数，按引号规则分词                   |
| `presets`                | `LaunchPreset[]`    | 5 套内置       | 启动参数预设，`builtin` 不可删除           |
| `activePresetId`         | string \| null      | `standard`     | 当前预设；`null` 表示自定义                |

## 开发

需要 Node.js 26.13.0、pnpm 12.16.1（见根目录 `package.json`）与 Vite+ 的 `vp` 命令。

```sh
vp install
vp run dev
```

`vp run dev` 同时启动 `apps/web` 的 Vite 开发服务器与 Electron 窗口；改主进程或 preload 后需要重新执行。窗口加载 `https://app.localhost/`，由主进程从 `apps/desktop/dist/renderer` 提供。

### 常用命令

| 命令                     | 用途                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| `vp run typegen`         | 生成 TanStack Router 路由类型（dev 也会生成）                           |
| `vp check`               | 格式化 + lint + 类型检查                                                |
| `vp test`                | Vitest 单元测试                                                         |
| `vp run test:e2e`        | 构建 renderer / main / preload 后用 Playwright 驱动真实 Electron 窗口   |
| `vp run check:contrast`  | 检查 token 配色的 WCAG 对比度                                           |
| `vp run knip`            | 未使用的文件 / 导出 / 依赖                                              |
| `vp run check:bundle`    | 检查打包后的 main / preload 没有引用 asar 外的依赖                      |
| `vp run ready`           | 全量：typegen + check + 对比度 + knip + 单测 + e2e + 构建 + bundle 自检 |
| `vp run package:desktop` | 构建并打包 Windows x64 安装版与便携版                                   |

### 测试

- 单元测试在代码旁（`*.test.ts`）：三处 package.json 的版本一致性、端口计划、Registry 搜索过滤、插件批量更新、自更新清单解析、依赖状态、renderer 路由等。
- e2e 在 `apps/desktop/tests/e2e`，每个用例用临时 `--user-data-dir` 启动真实 Electron：外壳启动、侧栏与浏览器历史共用一份路由、深链由应用协议兜底、主题切换后刷新仍保留。
- 需要人工验证长流程时，可用 `XL_CAPTURE=<png 路径>`（配合 `XL_CAPTURE_ROUTE=<页面 id>`、`XL_CAPTURE_DELAY`）在启动后自动截图并退出。

## 发布

```sh
vp run package:desktop
```

产物在 `apps/desktop/release`：

| 文件                                      | 说明                                    |
| ----------------------------------------- | --------------------------------------- |
| `ExplorerLauncher-<version>-setup.exe`    | NSIS 安装包，可选安装目录；卸载保留配置 |
| `ExplorerLauncher-<version>-portable.exe` | 单文件便携版                            |
| `latest.yml`                              | 自动更新清单，脚本会把便携版补进去      |

- 版本号在根目录、`apps/web`、`apps/desktop` 三处 `package.json` 必须一致，`versions.test.ts` 会拦截漂移。
- 打包脚本剔除 `ELECTRON_RUN_AS_NODE`，默认使用 npmmirror 的 electron-builder 二进制镜像。
- 应用身份沿用 `appId: com.xlauncher.comfyui` 与 `app.setName("explorer-launcher")`，升级后配置目录 `%APPDATA%\explorer-launcher` 保持不变。

## 反馈

请在 [GitHub Issues](https://github.com/Dontdrunk/Comfyui-EL-Launcher/issues) 提交问题，附启动器版本、ComfyUI 版本与复现步骤。

## 许可证

本项目基于 [MIT](LICENSE) 协议开源，可自由使用、修改与再分发，保留版权声明即可。

Copyright © 2026 Dontdrunk
