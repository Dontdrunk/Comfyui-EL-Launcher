# 探索者启动器

ComfyUI 便携版的桌面启动器。Electron + React + TypeScript，工业机能风格界面，
配色直接取自 ComfyUI 官方前端样式表，支持暗色 / 亮色双主题与可折叠侧边栏。

## 目标环境

面向 **ComfyUI 官方便携版（portable）**，即根目录同时包含：

```
<ComfyUI 根目录>\
├─ python_embeded\python.exe    内置解释器
├─ ComfyUI\main.py              ComfyUI 入口（本身是 git 仓库）
├─ ComfyUI\custom_nodes\        插件目录
├─ ComfyUI\models\              模型目录
└─ update\update.py             官方更新脚本（可选）
```

已在 ComfyUI v0.40.0 · Python 3.13.14 · torch 2.14.0+cu130 · RTX 4070 Ti 上跑通。

## 快速开始

```bash
pnpm install
pnpm dev          # 开发模式
pnpm typecheck    # 类型检查（主进程 + 渲染进程分开检查）
pnpm build        # 构建到 out/
pnpm package      # 打包 Windows exe（M5 阶段）
```

首次启动会自动检测默认 ComfyUI 目录，可在「设置」中修改。

## 已实现功能

### 总览与启动（M1）
- 环境读数：ComfyUI 版本 / Python / PyTorch / CUDA / GPU / 端口 / 启动耗时
- 启动控制：GPU 与 CPU 模式、端口、`--fast fp16_accumulation`、`--disable-api-nodes`、自定义参数
- 启动前端口占用预检；就绪后自动打开浏览器（可关）
- 实时日志滚动（3000 行环形缓冲，UTF-8 解码 + 中文控制台 GBK 兜底）
- 通过 `/system_stats` 轮询判定真正就绪；停止时终止整棵进程树，不留占显存的孤儿进程

### 版本更新与管理（M2）
- **为什么不用官方 `update.py`**：它只能升到最新或最新稳定 tag，无法回退到任意历史版本
- **为什么用定向浅取**：便携版是浅克隆（`.git` 仅 35 MB），远端有 204 个 tag。
  `git fetch --depth=1 origin refs/tags/<tag>:refs/tags/<tag>` 实测 2.1 秒 / 0.6 MB
- 当前版本卡片、GitHub Releases 检查更新（Electron `net` 走系统代理 + 本地缓存，断网退回缓存）
- 本地 / 全部远端 / 分支与回滚点三个视图，标注「当前 / 最新 / 已下载 / 需下载」
- 切换流程：预检 → 自动备份 → 必要时浅取 → 脏工作区 stash → `checkout` → 展示 requirements 差异
- 依赖同步：先 diff 展示，人工确认后才 `pip install -r requirements.txt`
- 轻量清单式备份：`version.json` + `custom_nodes.json` + `user/` 配置 + `extra_model_paths.yaml`
  （备份位于 `<根目录>\_explorer-launcher\backups`，在 git 仓库之外，不污染版本管理）
- 保留官方 `update.py` 通道作为高级选项

### 插件管理安装（M3）
- **为什么自研**：本机未安装 ComfyUI-Manager，且全流程不依赖 ComfyUI 服务运行
- 数据源 `https://api.comfy.org`，注意真正支持关键字过滤的端点是 **`/nodes/search`**
  （`/nodes?search=` 会忽略参数、恒定返回同一页）
- 已装列表：仓库 / commit / 分支 / 本地改动 / 启用状态 / 依赖缺口
- 启用与禁用：`.disabled` 后缀重命名（ComfyUI 原生机制）
- 卸载：移入系统回收站，**不删除依赖**（避免误删多插件共用的包）
- 安装：「插件安装」页从 Registry 搜索安装（6000+ 插件，卡片网格 + 底部分页条），
  页面底部另有 Git 地址输入条可直接粘贴仓库地址；两者都自动 pip 安装 requirements
- 依赖体检：单次 Python 调用批量核对全部插件依赖，列出缺失包并可单独补装
- 网络：跟随系统代理；装不上的插件会在日志里给出 git 的原始报错

### 其它已实现页面
- **模型管理**：扫描 `models/` 各分类的体积分布（条形对比）、按体积/时间/名称排序、
  展开查看每类最大文件、全局最大文件榜、定位到资源管理器、删除（移入回收站，带路径越界防护）
- **启动参数预设**：5 套内置预设（标准 / 低显存 / 全显存 / 预览增强 / 离线），
  支持把当前参数另存为自定义预设；手工改动任一项会自动脱离预设，避免显示与实际不一致
- **日志中心**：按输出流过滤、关键字检索、区分大小写
- **设置**：目录选择与校验、启动模式（GPU/CPU）、监听 IP 与端口、远程访问、自动打开界面、附加启动参数

## 打包

```bash
pnpm package        # 等价于 pnpm build && node scripts/package.mjs
```

产物在 `release/`：

| 文件 | 说明 |
|---|---|
| `ExplorerLauncher-0.1.0-setup.exe` | NSIS 安装包，可选安装目录、建桌面与开始菜单快捷方式、卸载保留用户配置 |
| `ExplorerLauncher-0.1.0-portable.exe` | 便携版，单文件免安装 |
| `win-unpacked/` | 免打包直接运行的解包目录 |

应用图标由脚本生成（与界面左上角 LOGO 同一图形语言）：

```bash
python_embeded\python.exe scripts\make-icon.py
```

打包脚本会把 electron-builder 的二进制资源指向 npmmirror，否则从 GitHub 拉取
NSIS / winCodeSign 会非常慢。

> 打包版与开发模式共用同一个配置目录 `%APPDATA%\explorer-launcher`，安装后设置可直接延续。

## 尚未实现（规划中）

无。M1–M5 均已交付。

## 项目结构

```
src/
├─ shared/            主进程与渲染进程共享的类型契约与 IPC 通道常量
├─ main/
│  ├─ index.ts        应用入口（含崩溃与启动里程碑日志）
│  ├─ window.ts       窗口创建 + 自检截图钩子（XL_CAPTURE）
│  ├─ ipc.ts          基础 IPC 注册
│  ├─ ipc-version.ts  版本管理 / 备份 IPC
│  ├─ ipc-nodes.ts    插件管理 IPC
│  ├─ ipc-models.ts   模型管理 IPC
│  ├─ lib/            子进程执行、路径解析、子进程环境、任务包装、标题栏主题、日志
│  └─ services/       settings / env / service / jobs / git / version / backup /
│                     releases / registry / nodes / nodeScan / models
├─ preload/           contextBridge 暴露的类型化 API
└─ renderer/src/
   ├─ styles/         tokens.css（ComfyUI 官方调色板）+ global.css（工业风组件层）
   ├─ components/     TitleBar / Sidebar / StatusRail / Icon（lucide+morphicons）/
   │                  Brand / ui.tsx（面板、读数、终端、模态框…）
   ├─ pages/          Dashboard / Versions / Nodes / Models / Logs / Settings
   └─ store.ts        zustand 状态与 IPC 事件订阅
scripts/
├─ run.mjs            electron-vite CLI 包装器（剔除 ELECTRON_RUN_AS_NODE + 启动前补齐 electron 二进制）
├─ ensure-electron.mjs 补齐 electron 运行时二进制（install.js 的幂等包装，安装后 / 启动前各调一次）
├─ package.mjs        electron-builder 包装器（同上 + 二进制镜像）
├─ make-icon.py       生成 build/icon.ico
├─ check-contrast.mjs 解析 tokens.css 并按 WCAG 核对关键配对的对比度
└─ e2e.mjs            零依赖 CDP 端到端驱动脚本
```

## 界面设计契约（仪表台）

界面是**机器面板**，不是网页。以下规则可机械核对，改样式时不要绕过：

| 规则 | 说明 |
|---|---|
| 圆角 | 一律 0。唯一允许的圆是圆点（LED / 开关滑块 / 比例条端点），由各自规则用 \`50%\` 单独声明 |
| 分层 | 只用 1px 发丝线。不用投影、不用渐变、不用光晕 |
| 强调色 | 分三角色：\`--accent-strong\` 只做**填充**（必须托住白字）、\`--accent-line\` 只做**文字/描边/焦点环**、\`--accent-soft\` 做浅底。跨角色复用会造成对比度不达标 |
| 语义色 | 点/线用 \`--ok/--warn/--danger\`，**文字**用 \`--ok-text/--warn-text/--danger-text\`，实心填充用 \`--danger-solid\` |
| 排版 | 中文最小 11px；中文标签不做 \`uppercase\` 与 \`letter-spacing\`。等宽体只给数字、路径、提交号、端口（中文值用 \`--font-ui\` + \`tabular-nums\`） |
| 读数条 | 列数由 \`<Readouts cols={n}>\` 显式给定，按项目数选择（6 项用 3、4 项用 4），**不用 auto-fill**——自动换行会在最后一行留出空格子 |
| 网格发丝线 | 容器画左/上边、格子画右/下边（\`.readouts\` / \`.plugin-grid\`）。不要用 \`gap + 容器底色\`：最后一行填不满时会露出一大块异色方块 |
| 状态 | 服务状态**只在底部状态轨道**出现一处。标题栏、侧边栏、面板头都不重复 |
| 图标 | 全部来自 \`lucide\` 数据 + \`MorphIcon\`；方头直角由 \`.ic\` 规则统一覆盖。形变只用在真实状态对（启动↔停止、日↔月、箭头翻转），导航图标不形变 |
| 动效 | 只表达状态与连续性，不编排页面入场。数值变化用一次 400ms 底色回落提示，不做滚动计数器。所有动效在 \`prefers-reduced-motion\` 下关闭 |
| 语言 | 界面全中文，只保留 ComfyUI / Python / GPU / PID 这类不可译标识符。枚举值必须经 \`formatServiceState\` 之类映射后再显示，禁止直接渲染后端原始值 |

改完样式跑两步验证：

```bash
pnpm check:contrast        # 关键配对 WCAG 核对
node scripts/e2e.mjs nav   # 七页截图
node scripts/e2e.mjs narrow # 最小窗口 1000×660 + 溢出度量
```

## 开发说明

### ⚠️ 关于 `ELECTRON_RUN_AS_NODE`
若环境变量 `ELECTRON_RUN_AS_NODE=1` 存在（某些开发工具会全局设置），
`electron.exe` 会**退化为纯 Node**：无参数启动时当作 REPL 读 stdin 后立即退出
（表现为「双击没反应 / 退出码 0」），带参数时则报 `bad option: xxx`。

- 开发：所有脚本都通过 `scripts/run.mjs` / `scripts/package.mjs` 派生子进程并剔除该变量
- 运行打包版：从资源管理器双击不受影响；若在设置了该变量的终端里启动，
  请先 `set ELECTRON_RUN_AS_NODE=` 或直接双击

### 启动日志
打包后的 Electron 是 GUI 子系统程序，没有控制台。启动里程碑与未捕获异常
统一写入 `%APPDATA%\explorer-launcher\logs\launcher.log`，出现启动问题时先看这个文件。

### 无人值守验证
`scripts/e2e.mjs` 以 `--remote-debugging-port` 启动应用，用 Node 内置 WebSocket
直连 DevTools Protocol，在真实渲染进程里执行点击与断言并截图。
不向产品代码注入任何测试开关。

这些脚本依赖固定的类名与按钮文案（`.readout` / `.plugin-card` / `.segmented__item` /
``启动 ComfyUI`` 等）。改 UI 时先看 `scripts/e2e.mjs` 里用到的选择器，
不要顺手改名——那属于测试契约。

```bash
node scripts/run.mjs build
node scripts/e2e.mjs nav         # 逐页截图
node scripts/e2e.mjs narrow      # 最小窗口 1000×660 截图与溢出度量
node scripts/e2e.mjs theme       # 暗/亮双主题截图
node scripts/e2e.mjs sidebar     # 侧边栏展开/折叠
node scripts/e2e.mjs launch      # 真实启动 ComfyUI 并等待就绪
node scripts/e2e.mjs versions    # 版本页与切换确认弹窗
node scripts/e2e.mjs switch v0.39.2
node scripts/e2e.mjs restore
node scripts/e2e.mjs nodes       # 真实安装/卸载一个 Registry 插件
node scripts/e2e.mjs models      # 真实扫描模型目录
node scripts/e2e.mjs presets     # 预设应用与保存
```

另有 `XL_CAPTURE=<png 路径>` 环境变量（可配合 `XL_CAPTURE_ROUTE=<页面 id>`）
在启动后自动截图并退出。

### 踩过的坑
- **ComfyUI Registry**：`/nodes?search=` 会静默忽略查询参数、恒定返回同一页默认列表；
  真正支持过滤的是 `/nodes/search`（依据官方 openapi 规范确认）
- **git clone 的 cwd 不能是目标目录**：目标目录此刻不存在，`spawn` 会直接 ENOENT
- **便携版是浅克隆**：全量 `fetch --tags` 代价高，切换版本要用 `--depth=1` 定向浅取
- **electron 44 没有 postinstall**：二进制改成「首次 `require('electron')` 时惰性下载」，
  但 electron-vite 不走 require，只读 `electron/path.txt`，读不到就抛 `Error: Electron uninstall` 并在一秒内退出
  （表现为「pnpm dev 起不来」，且 `launcher.log` 里连 `--- 启动 ---` 都不会出现）。
  现在由 `scripts/ensure-electron.mjs` 兜底：`pnpm install` 的 postinstall 会补齐，
  `pnpm dev` / `pnpm preview` 启动前也会再查一次；单独执行 `node scripts/ensure-electron.mjs` 可以手动修复
- **pnpm 12 拦截构建脚本**：`package.json#pnpm` 已不再被读取，
  许可要写在 `pnpm-workspace.yaml` 的 `allowBuilds`；留成占位符会让 `pnpm install` 直接以 ERR_PNPM_IGNORED_BUILDS 失败
- **日志中文乱码**：Python 子进程统一注入 `PYTHONUTF8=1`，
  行解码器检测到非法 UTF-8 时回退 GBK，兼容中文 Windows 控制台
