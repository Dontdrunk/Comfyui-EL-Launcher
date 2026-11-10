# explorer-launcher

React · Electron, on [Vite+](https://viteplus.dev).

| Layer     | Choice                                                                                |
| --------- | ------------------------------------------------------------------------------------- |
| Frontend  | React 19, TanStack Router, TanStack Query, Tailwind CSS 4                             |
| UI        | shadcn/ui on Base UI, in `packages/ui`                                                |
| Desktop   | Electron (main, preload, and the web app as renderer), packaged with electron-builder |
| Toolchain | Vite+ (`vp`): dev, build, test, lint, format, type check                              |

## Getting started

```sh
vp install
vp run dev
```

Open http://localhost:5173.

`vp run dev` also opens the app in an Electron window. `vp run package:desktop` writes the installer to `apps/desktop/release`.

## Commands

```sh
vp run typegen    # route types; dev generates these automatically
vp check          # format, lint, type check
vp run knip       # unused files, exports, dependencies, and catalog entries
vp test           # unit tests (Vitest)
vp run test:e2e   # end-to-end tests (Playwright) in Chromium, against the dev server
vp run ready      # typegen + check + knip + test + test:e2e + production build
```

The first `vp run test:e2e` needs a browser: `cd apps/web && vp exec playwright install chromium`.

## 这是"探索者启动器"的重构骨架

旧项目（electron-vite + 手写页面切换）已整体迁入本脚手架，代码位置：

| 旧位置                      | 新位置                                                                       |
| --------------------------- | ---------------------------------------------------------------------------- |
| `src/main/**`（主进程服务） | `apps/desktop/src/main/**`                                                   |
| `src/preload/**`            | `apps/desktop/src/preload/**`                                                |
| `src/renderer/src/**`       | `apps/web/src/launcher/**`                                                   |
| `src/shared/**`（IPC 契约） | `packages/electron/src/**`                                                   |
| `electron.vite.config.ts`   | `vite.main.config.ts` + `vite.preload.config.ts` + `apps/web/vite.config.ts` |
| `*.test.mjs`（node:test）   | Vitest（`*.test.ts`）                                                        |

页面切换改由 TanStack Router 承担（`apps/web/src/routes/**`），侧栏、托盘跳转、
地址栏共用同一份路由状态。

应用身份沿用旧版：`app.setName("explorer-launcher")` 让 userData 仍然指向
`%APPDATA%\explorer-launcher`，旧的 `config.json` 与日志无缝继承；
`electron-builder.yml` 保留原 appId（`com.xlauncher.comfyui`）与 GitHub 更新源。

### 每次改完的验证顺序

```sh
vp check     # 格式化 + lint + 类型（提交前必须绿）
vp test      # Vitest 单测（portPlan / registryPlan / selfUpdatePlan / depStatus / renderer-route）
vp run ready # 全量：typegen + check + knip + test + e2e + 生产构建
```

### 遗留事项

- `apps/desktop/src/main/**`、`apps/web/src/launcher/**`、`packages/electron/src/**`
  属于"原样搬运区"：风格类 lint 规则在 `vite.config.ts` 的 overrides 里豁免，
  但类型检查、eqeqeq、hook 依赖、未使用变量仍然生效。新代码不要放进这些目录。
- `apps/desktop` 继承 `legacy-node.json`（关闭 `noUncheckedIndexedAccess`），
  原因是旧主进程代码大量按"下标一定存在"书写；`apps/web` 保持全严格。
- `tv run test:e2e` 还是模板骨架的浏览器用例，尚未覆盖 Electron 窗口与真实启动流程。
