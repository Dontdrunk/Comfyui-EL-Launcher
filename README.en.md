# Explorer Launcher

[简体中文](README.md) · **English**

[![Latest release](https://img.shields.io/github/v/release/Dontdrunk/Comfyui-EL-Launcher?label=Release)](https://github.com/Dontdrunk/Comfyui-EL-Launcher/releases/latest) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A desktop launcher and manager for the **official ComfyUI Windows portable build**. Start and stop ComfyUI, switch versions and roll back from backups, install and update custom nodes, audit Python dependencies, and clean up model files — all in one window. The interface follows an industrial instrument-panel style, with colors taken from ComfyUI's official frontend palette and dark / light themes.

**[Download the latest release](https://github.com/Dontdrunk/Comfyui-EL-Launcher/releases/latest)** · **[Report an issue](https://github.com/Dontdrunk/Comfyui-EL-Launcher/issues)** · **[简体中文](README.md)**

## Features

### Home · Launching ComfyUI

- Environment readouts: ComfyUI version, Python, PyTorch, GPU, service port, launcher version.
- Start and stop: GPU / CPU mode, listen IP and port, LAN access, auto-open the web UI when ready, `--fast fp16_accumulation`, `--disable-api-nodes`, and extra launch arguments.
- Port pre-check: before launch, lists the PID, process name, and command line occupying the port; after confirmation it can "kill and start". If the port is held by this ComfyUI install (including a process left behind by a previous crash), the launcher attaches to it instead.
- Readiness: polls `/system_stats` and only then marks the service as running; the exact launch command line is recorded for troubleshooting.
- Live logs: shares a 3000-line ring buffer with the service process, decodes UTF-8, and falls back to GBK for Chinese Windows consoles.
- Launch presets: five built-ins (standard, low VRAM, high VRAM, enhanced preview, offline) plus custom presets; manually changing any field drops out of the active preset.
- Launcher self-update: reads `latest.yml` from the GitHub release, verifies SHA-512, then silently installs (installed build) or swaps and restarts (portable build).

### Version management

- Current version readouts: HEAD tag / branch / commit, working-tree changes and stash, ComfyUI version.
- Update verdict: fetches the latest release from GitHub Releases and uses `git describe --contains` to tell "behind / up to date / ahead of the release line".
- Version list: "release versions" and "all commits" scopes, with search and progressive loading of older commits.
- Switching: first shows a plan — whether a targeted shallow fetch is needed, whether a dirty tree will be stashed, whether to back up automatically, the `requirements.txt` diff, and blockers such as a running service; checkout runs after confirmation, and when the dependency manifest differs it is synced automatically afterwards (or manually from the toolbar).
- Version backups: manifest-style backups of `version.json`, `custom_nodes.json`, the `user/` config, and `extra_model_paths.yaml`; create, restore, delete, with the list showing the backed-up commit, plugin count, and whether it has been restored. They live in `<ComfyUI root>\_explorer-launcher\backups` and never enter git.
- Dependency sync: diffs `requirements.txt` and runs pip install.
- Operations that write into the ComfyUI directory ask you to stop the service first when it is running.

### Plugin management

- Installed plugins: enabled state, display name and directory name, dependency status, repository, current commit and commit time, remote-update marker.
- Install: search the ComfyUI Registry (`api.comfy.org`, server-side search plus local name filtering and paging), or paste a Git repository URL. After install it tries that plugin's `requirements.txt`.
- Enable / disable by renaming the `.disabled` suffix (ComfyUI's native mechanism); uninstall moves the directory to the system recycle bin and keeps shared dependencies.
- Updates: check each plugin's remote, update one or all; bulk results separate successes from failures.
- Version switching: reads the plugin repository's local branches and commits, then checks out the selected ref.
- Dependency audit: one Python call checks every plugin; per plugin you can see `requirements.txt` constraints next to installed versions, install or reinstall individual packages, or reinstall all plugin dependencies.

### Model management

- Scans `models/`: folder tree, total size and file count, per-item size.
- Reveal a file or move it to the system recycle bin; paths are guarded against escaping the models directory.
- Shows free / total capacity of the volume that holds the ComfyUI root.

### Environment management

- Installed pip package list with search.
- Install a package name or version spec, or install from a `.whl` / `requirements.txt` file.
- Uninstall, force-reinstall at the currently installed version, open the package directory in `site-packages`.
- `pip freeze` backups and restore from a manifest; backups live in `<ComfyUI root>\_explorer-launcher\env-backups`.

### Console

- Live log shared by ComfyUI and backend jobs (git, pip, version switching), with one-click clear.

### Settings

- ComfyUI portable root: pick, validate, directory status and issue hints.
- Launch settings: listen IP / port, allow other devices, auto-open when ready, extra launch arguments.
- Theme: toggled in the title bar and persisted across launches.

### Tray

- Closing the window only hides it to the tray; ComfyUI keeps running. The tray menu offers Open / Settings / Quit.

## Requirements

Built for the ComfyUI portable build. The root directory must contain at least:

```text
<ComfyUI root>\
├─ python_embeded\python.exe     embedded interpreter
├─ ComfyUI\main.py               ComfyUI entry (a git repository)
├─ ComfyUI\custom_nodes\         custom nodes
├─ ComfyUI\models\               models
└─ update\update.py              official updater (optional)
```

- OS: Windows 10 / 11 x64; the launcher does not require administrator rights.
- Version management needs Git installed and on `PATH`; plugin and dependency installs use the bundled `python_embeded`, not a system Python.
- Verified on Windows 11 + ComfyUI v0.40.0 (Python 3.13 / torch 2.14 + cu130) + RTX 4070 Ti.

## Architecture

### Stack

| Layer           | Choice                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Desktop shell   | Electron 45 (main + preload + renderer), packaged with electron-builder                          |
| Renderer        | React 19 + TanStack Router (file routes) + TanStack Query + zustand                              |
| Styling         | Tailwind CSS 4 + shadcn/ui (Base UI), built in `packages/ui`                                     |
| Toolchain       | Vite+ (`vp`): dev / build / check / test / package; Vitest + Playwright                          |
| Shared contract | `packages/electron`: IPC channel constants, domain types, `LauncherApi`, launch argument builder |

### Processes and code layout

| Location                   | Responsibility                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/main`    | Windows, tray, custom title bar, self-update, and every system service: settings, environment probing, process, versions, backups, plugins, pip, models |
| `apps/desktop/src/preload` | Transport only: exposes `window.launcher: LauncherApi` through `contextBridge` and subscribes to main-process events                                    |
| `apps/web/src/routes`      | TanStack Router file routes, the single source of page navigation; tray navigation uses the same router                                                 |
| `apps/web/src/launcher`    | Pages, components, styles, and the zustand store (the instrument-panel UI)                                                                              |
| `packages/electron`        | The only type contract shared by main and renderer; add channels and types here before implementing                                                     |
| `packages/ui`              | shadcn/ui components and the Tailwind theme                                                                                                             |

In a packaged build the main process serves the SPA through a custom protocol (`https://app.localhost/`, with SPA fallback), and the window loads `apps/web/dist`; in development it connects straight to the Vite dev server.

### Interacting with ComfyUI

- **Launch**: `python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --port <port>`, then adds `--cpu`, `--listen`, `--disable-auto-launch`, `--fast fp16_accumulation`, `--disable-api-nodes`, and custom arguments from settings.
- **Readiness**: polls `http://<host>:<port>/system_stats`; only then is the state `running`. Stopping kills the whole process tree so no VRAM-holding orphans survive.
- **Versions**: works directly on `ComfyUI/.git`. Remote tags are fetched with a targeted shallow fetch, `git fetch --depth=1 origin refs/tags/<tag>:refs/tags/<tag>` (the portable build is itself a shallow clone). It does not use the official `update.py`, which can only move to the latest version and cannot roll back.
- **Plugins**: metadata comes from the ComfyUI Registry. Keyword filtering must use `/nodes/search`; `/nodes?search=` ignores its parameters and returns the same page. Code is fetched with `git clone` and dependencies are installed with the bundled pip; the whole flow works without ComfyUI running.
- **Models**: read-only scan of `models/`; deletion goes through the system recycle bin (`shell.trashItem`).
- **Dependencies**: always `python_embeded -s -m pip`, with `PYTHONUTF8=1` injected; long tasks run in the job center and their output also lands in the console.

### Local data and network

| Location                                          | Contents                                                    |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `%APPDATA%\explorer-launcher\config.json`         | Settings and presets, written via temp file + atomic rename |
| `%APPDATA%\explorer-launcher\logs\launcher.log`   | Startup milestones, uncaught exceptions, self-update log    |
| `%APPDATA%\explorer-launcher\cache\releases.json` | GitHub Releases cache, used when offline                    |
| `<ComfyUI root>\_explorer-launcher\backups`       | Version backups                                             |
| `<ComfyUI root>\_explorer-launcher\env-backups`   | `pip freeze` manifests                                      |

- Network requests use Electron's `session.fetch` / `net`, so the system proxy is inherited automatically.
- The update source is configured in `apps/desktop/electron-builder.yml` (appId `com.xlauncher.comfyui`, publishing to `Dontdrunk/Comfyui-EL-Launcher`); owner / repo in `selfUpdate.ts` must match it.

### UI conventions (instrument panel)

- Zero border radius and 1px hairlines for layering; no shadows or gradients. Circles are reserved for status dots, switch thumbs, and bar endpoints.
- Semantic colors are split by role: dots and lines (`--ok` / `--warn` / `--danger`), text (`--ok-text` / `--warn-text` / `--danger-text`), and solid fills (`--danger-solid`). Cross-role reuse drops contrast below target.
- Service state appears exactly once, in the bottom status rail. Chinese labels are never uppercased or letter-spaced. Monospace is only for numbers, paths, commit hashes, and ports.
- The UI is Chinese-only; enum values are formatted before display and never rendered as raw backend values.
- `vp run check:contrast` guards the WCAG contrast of the token palette.

## Interfaces and data contract

There is exactly one contract: `packages/electron/src`. A new capability adds its channel and types here first, then the main-process handler, the preload binding, and finally the renderer consumer.

- `ipc.ts`: every channel constant.
- `types.ts`: domain models, `LauncherApi`, `OpResult`, and friends.
- `launch-command.ts`: launch argument construction and preview.

### IPC channels

Channel constants live in `packages/electron/src/ipc.ts`:

- **Settings**: `settings:get`, `settings:patch`, `dialog:pickDirectory` — read / patch settings, pick a directory.
- **Environment**: `env:check`, `env:probeRuntime`, `env:probeDisk` — layout (fast), Python / torch / CUDA / GPU (slow), disk capacity.
- **Service**: `service:status`, `service:start`, `service:stop`, `service:killPortOwner`, `service:logs`, `service:logsClear` — the ComfyUI process and its logs.
- **Jobs**: `job:list`, `job:get`, `job:cancel` — query and cancel long-running jobs.
- **Versions**: `git:check`, `version:state`, `version:remoteTags`, `version:commits`, `version:fetchRemote`, `version:checkUpdate`, `version:plan`, `version:switch`, `version:syncDeps`, `version:officialUpdate` — version state, update check, switch plan and execution, dependency sync, official update.py channel.
- **Backups**: `backup:list`, `backup:detail`, `backup:create`, `backup:restore`, `backup:delete`, `backup:dir` — version backups.
- **Plugins**: `nodes:list`, `nodes:search`, `nodes:installRegistry`, `nodes:installGit`, `nodes:setEnabled`, `nodes:update`, `nodes:updateAll`, `nodes:uninstall`, `nodes:installDeps`, `nodes:checkDeps`, `nodes:checkUpdates`, `nodes:depsDetail`, `nodes:releases`, `nodes:checkout`, `nodes:depInstall`, `nodes:reinstallAllDeps` — installed list, Registry search, install, update, dependencies, version switching.
- **pip environment**: `pip:list`, `pip:install`, `pip:uninstall`, `pip:reinstall`, `pip:locate`, `pip:backups`, `pip:backup`, `pip:restore`, `dialog:pickPipFile` — package management and `pip freeze` backups.
- **Models**: `models:scan`, `models:delete`, `models:reveal`, `models:dir` — scan, recycle-bin delete, reveal.
- **System**: `shell:openExternal`, `shell:openPath`, `shell:showItemInFolder` — open links / paths, reveal files.
- **Window**: `window:minimize`, `window:maximize`, `window:close`, `window:isMaximized` — frameless title-bar controls.
- **Main → renderer**: `evt:log`, `evt:serviceStatus`, `evt:job`, `evt:navigate`, `tray-menu:act` — logs, service state, job progress, tray navigation.
- **Launcher update**: `self-update:status`, `self-update:install`, `evt:selfUpdate` — check, download and install, progress.

The preload wraps channels into `LauncherApi` (`window.launcher`); the renderer never touches `ipcRenderer` directly.

### Long-running jobs

Every slow operation (git fetch / checkout, pip, plugin install, version switch, backup restore) returns `OpResult<T>`:

```ts
type OpResult<T> =
  | { ok: true; jobId: string; value: T }
  | { ok: false; jobId: string; error: string };
```

It also creates a `JobSnapshot` (`status`, `percent`, `lines`) in the job center; progress is pushed through `evt:job` and the job can be cancelled at any time. The page gets the result, and the console still has the full command-line record.

### Core data structures

| Type                       | Key fields                                                                                                         |
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
| `JobSnapshot` / `JobEvent` | `id` `kind` `status` `percent` `lines`; events are `created` / `line` / `progress` / `finished`                    |

### Settings fields (config.json)

| Field                    | Type                | Default        | Notes                                               |
| ------------------------ | ------------------- | -------------- | --------------------------------------------------- |
| `comfyRoot`              | string              | `""` (unset)   | Portable build root; unset opens the setup guide    |
| `theme`                  | `"dark" \| "light"` | `dark`         | Theme, toggled in the title bar                     |
| `launch.mode`            | `"gpu" \| "cpu"`    | `gpu`          | Launch mode; `cpu` appends `--cpu`                  |
| `launch.port`            | number              | `8188`         | `--port`                                            |
| `launch.remote`          | boolean             | `false`        | When enabled, appends `--listen <listen>`           |
| `launch.listen`          | string              | `127.0.0.1`    | Remote listen address; empty means `0.0.0.0`        |
| `launch.autoOpenBrowser` | boolean             | `true`         | When disabled, appends `--disable-auto-launch`      |
| `launch.fastFp16`        | boolean             | `false`        | Appends `--fast fp16_accumulation`                  |
| `launch.disableApiNodes` | boolean             | `false`        | Appends `--disable-api-nodes`                       |
| `launch.extraArgs`       | string              | `""`           | Extra arguments, tokenized with quote support       |
| `presets`                | `LaunchPreset[]`    | five built-ins | Launch presets; `builtin` entries cannot be removed |
| `activePresetId`         | string \| null      | `standard`     | Active preset; `null` means custom                  |

## Development

Requires Node.js 26.13.0 and pnpm 12.16.1 (see the root `package.json`) plus Vite+'s `vp` command.

```sh
vp install
vp run dev
```

`vp run dev` starts the `apps/web` Vite dev server and the Electron window together; re-run it after changing main or preload code. The window loads `https://app.localhost/`, served by the main process from `apps/desktop/dist/renderer`.

### Commands

| Command                  | Purpose                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `vp run typegen`         | Generate TanStack Router route types (dev generates them too)                        |
| `vp check`               | Format + lint + type check                                                           |
| `vp test`                | Vitest unit tests                                                                    |
| `vp run test:e2e`        | Build renderer / main / preload, then drive the real Electron window with Playwright |
| `vp run check:contrast`  | WCAG contrast check for the token palette                                            |
| `vp run knip`            | Unused files / exports / dependencies                                                |
| `vp run check:bundle`    | Check that packaged main / preload never import outside the asar                     |
| `vp run ready`           | Full gate: typegen + check + contrast + knip + unit + e2e + build + bundle check     |
| `vp run package:desktop` | Build and package the Windows x64 installer and portable build                       |

### Testing

- Unit tests sit next to the code (`*.test.ts`): version consistency across the three package.json files, port planning, Registry search filtering, plugin bulk updates, self-update manifest parsing, dependency status, renderer routing, and more.
- E2E lives in `apps/desktop/tests/e2e`; each case launches a real Electron app with a throwaway `--user-data-dir`: shell boot, sidebar and browser history sharing one router, deep links served by the app protocol, and the theme surviving a reload.
- For manual verification of long flows, set `XL_CAPTURE=<png path>` (with `XL_CAPTURE_ROUTE=<page id>` and `XL_CAPTURE_DELAY`) to capture a screenshot after launch and exit.

## Release

```sh
vp run package:desktop
```

Artifacts land in `apps/desktop/release`:

| File                                      | Notes                                                              |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `ExplorerLauncher-<version>-setup.exe`    | NSIS installer, install directory optional; uninstall keeps config |
| `ExplorerLauncher-<version>-portable.exe` | Single-file portable build                                         |
| `latest.yml`                              | Auto-update manifest; the script adds the portable build           |

- The version must match in the root, `apps/web`, and `apps/desktop` `package.json`; `versions.test.ts` fails on drift.
- The packaging script strips `ELECTRON_RUN_AS_NODE` and defaults to the npmmirror electron-builder binary mirror.
- App identity stays `appId: com.xlauncher.comfyui` and `app.setName("explorer-launcher")`, so upgrades keep using `%APPDATA%\explorer-launcher`.

## Feedback

Please file issues at [GitHub Issues](https://github.com/Dontdrunk/Comfyui-EL-Launcher/issues) with the launcher version, ComfyUI version, and reproduction steps.

## License

Released under the [MIT](LICENSE) license. You are free to use, modify, and redistribute it as long as the copyright notice is kept.

Copyright © 2026 Dontdrunk
