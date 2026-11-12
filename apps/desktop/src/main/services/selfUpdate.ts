import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";

import { app, ipcMain, net, session } from "electron";

import { IPC } from "@explorer-launcher/electron";
import type {
  SelfUpdateProgress,
  SelfUpdateStatus,
} from "@explorer-launcher/electron";

import { logToFile } from "../lib/logger";
import { UpdateProgressWindow } from "../update-window";
import {
  createSpeedMeter,
  fileNameOf,
  isLauncherAsset,
  isNewer,
  parseLatestYml,
  pickFile,
  sha512Base64,
} from "./selfUpdatePlan.mjs";
import type { UpdateFile } from "./selfUpdatePlan.mjs";
import { parseSemver } from "./semver.mjs";

/** 与 electron-builder.yml 的 publish.owner / publish.repo 必须相同 */
const UPDATE_OWNER = "Dontdrunk";
const UPDATE_REPO = "Comfyui-EL-Launcher";

/** 下载进度事件的最小间隔：每个数据块都发 IPC，大包时一秒几百次，界面反而会卡 */
const PROGRESS_INTERVAL_MS = 180;

interface GhAsset {
  name: string;
  browser_download_url: string;
}

interface GhRelease {
  assets?: GhAsset[];
  body?: string | null;
  published_at?: string | null;
  html_url?: string | null;
}

interface ReadyUpdate {
  version: string;
  files: UpdateFile[];
  assets: Map<string, string>;
}

let ready: ReadyUpdate | null = null;
let busy = false;
let abortRef: AbortController | null = null;

class UpdateCancelledError extends Error {
  constructor() {
    super("已取消更新");
    this.name = "UpdateCancelledError";
  }
}

function currentVersion(): string {
  const v = app.getVersion();

  if (v && v !== process.versions.electron) {
    return v;
  }
  const raw = readFileSync(join(app.getAppPath(), "package.json"), "utf-8");

  return (JSON.parse(raw) as { version: string }).version;
}

/** 便携版把当前 exe 当数据目录的孩子换了；安装版走 setup.exe */
function isPortable(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
}

function userAgent(): string {
  return `ExplorerLauncher/${currentVersion()}`;
}

function readable(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  if (raw.includes("net::ERR_")) {
    return `连不上 GitHub（${raw}）。稍后重试即可。`;
  }
  return raw;
}

function assertHttps(url: string): void {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error("更新包地址无效");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("更新包地址不是 https");
  }
}

function ghHeaders(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": userAgent(),
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fetchLatest(): Promise<GhRelease> {
  const res = await session.defaultSession.fetch(
    `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`,
    { headers: ghHeaders() }
  );

  if (!res.ok) {
    throw new Error(`GitHub API 返回 ${res.status}`);
  }

  return (await res.json()) as GhRelease;
}

async function fetchText(url: string): Promise<string> {
  assertHttps(url);

  const res = await session.defaultSession.fetch(url, {
    headers: { "User-Agent": userAgent(), Accept: "application/octet-stream" },
  });

  if (!res.ok) {
    throw new Error(`下载 latest.yml 失败（HTTP ${res.status}）`);
  }
  return await res.text();
}

function headerNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw ?? 0);

  return Number.isFinite(n) ? n : 0;
}

/** 每个阶段都带齐字段：渲染进程只按 stage 渲染，不用猜哪个字段这次有值 */
function progressOf(
  stage: SelfUpdateProgress["stage"],
  extra: Partial<SelfUpdateProgress> = {}
): SelfUpdateProgress {
  return {
    stage,
    percent: null,
    receivedBytes: 0,
    totalBytes: null,
    bytesPerSecond: null,
    message: null,
    ...extra,
  };
}

function baseStatus(): Pick<
  SelfUpdateStatus,
  "currentVersion" | "packaged" | "portable"
> {
  return {
    currentVersion: currentVersion(),
    packaged: app.isPackaged,
    portable: isPortable(),
  };
}

function statusOf(
  state: SelfUpdateStatus["state"],
  fields: Partial<SelfUpdateStatus>
): SelfUpdateStatus {
  return {
    ...baseStatus(),
    state,
    version: null,
    message: null,
    notes: null,
    publishedAt: null,
    releaseUrl: null,
    size: null,
    ...fields,
  };
}

async function downloadTo(
  url: string,
  dest: string,
  onChunk: (received: number, total: number | null) => void,
  signal: AbortSignal
): Promise<void> {
  assertHttps(url);

  return await new Promise<void>((resolve, reject) => {
    const req = net.request({
      url,
      redirect: "follow",
      session: session.defaultSession,
    });
    let settled = false;
    let file: ReturnType<typeof createWriteStream> | null = null;
    const detachAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
    };
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      detachAbort();
      file?.destroy();
      reject(error);
    };
    // 取消按钮：中止请求、丢掉半截文件，installSelfUpdate 会按 aborted 收尾
    function onAbort(): void {
      req.abort();
      fail(new UpdateCancelledError());
    }

    signal.addEventListener("abort", onAbort, { once: true });

    req.setHeader("User-Agent", userAgent());
    req.setHeader("Accept", "application/octet-stream");
    req.on("response", (res) => {
      // Electron 的 IncomingMessage 运行时是 Readable，类型定义没带上 pipe
      const body = res as unknown as Readable;
      const code = res.statusCode ?? 0;

      if (code !== 200) {
        body.resume();
        fail(new Error(`下载失败（HTTP ${code}）`));

        return;
      }

      const length = headerNumber(res.headers["content-length"]);
      const total = length > 0 ? length : null;
      let got = 0;

      file = createWriteStream(dest);
      body.on("data", (chunk: Buffer) => {
        got += chunk.length;
        onChunk(got, total);
      });
      body.on("error", fail);
      file.on("error", fail);
      file.on("finish", () => {
        if (settled) {
          return;
        }
        settled = true;
        detachAbort();
        resolve();
      });
      body.pipe(file);
    });
    req.on("error", (error: Error) => {
      fail(error);
    });
    req.end();
  });
}

async function checkSelfUpdate(): Promise<SelfUpdateStatus> {
  try {
    const release = await fetchLatest();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const ymlAsset = assets.find((a) => a.name === "latest.yml");

    if (!ymlAsset?.browser_download_url) {
      ready = null;

      return statusOf("error", { message: "发布里没有 latest.yml" });
    }

    const parsed = parseLatestYml(
      await fetchText(ymlAsset.browser_download_url)
    );

    if (!parsed || !parseSemver(parsed.version)) {
      ready = null;

      return statusOf("error", { message: "latest.yml 无法解析" });
    }

    const releaseFields: Pick<
      SelfUpdateStatus,
      "notes" | "publishedAt" | "releaseUrl"
    > = {
      notes: release.body?.trim() ? release.body : null,
      publishedAt: release.published_at ?? null,
      releaseUrl: release.html_url ?? null,
    };

    if (!isNewer(currentVersion(), parsed.version)) {
      ready = null;

      return statusOf("latest", {
        version: parsed.version,
        ...releaseFields,
      });
    }

    const map = new Map<string, string>();

    for (const asset of assets) {
      if (asset.name && asset.browser_download_url) {
        map.set(asset.name, asset.browser_download_url);
      }
    }

    ready = { version: parsed.version, files: parsed.files, assets: map };

    return statusOf("available", {
      version: parsed.version,
      size: pickFile(parsed.files, isPortable())?.size ?? null,
      ...releaseFields,
    });
  } catch (error) {
    ready = null;

    return statusOf("error", { message: readable(error) });
  }
}

function detach(cmd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  const options: SpawnOptions = {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: env ?? process.env,
  };

  const child = spawn(cmd, args, options);
  child.unref();

  if (typeof child.pid !== "number") {
    throw new Error(`无法启动 ${cmd}`);
  }
}

function launchSetup(exe: string): void {
  detach(exe, ["/S", "--updated", "--force-run"]);
}

function swapPortable(next: string, current: string): void {
  const script = join(tmpdir(), `explorer-update-${process.pid}.ps1`);

  // shortcut: 固定等 2 秒，不等进程句柄；便携版替换失败时再改成等 pid 退出
  const body = [
    "$ErrorActionPreference = 'Stop'",
    "Start-Sleep -Seconds 2",
    "Move-Item -LiteralPath $env:EXPLORER_UPDATE_NEW -Destination $env:EXPLORER_UPDATE_OLD -Force",
    "Start-Process -FilePath $env:EXPLORER_UPDATE_OLD",
  ].join("\r\n");

  writeFileSync(
    script,
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body, "utf-8")])
  );
  detach(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    {
      ...process.env,
      EXPLORER_UPDATE_NEW: next,
      EXPLORER_UPDATE_OLD: current,
    }
  );
}

/** 主窗口与进度窗口都由应用入口提供，service 不直接依赖 index.ts */
interface SelfUpdateHost {
  showMainWindow: () => void;
  hideMainWindow: () => void;
  /** preload 脚本路径，进度窗口要用同一套 IPC */
  preload: string;
  /** 进度页地址（不带查询串），例如 https://app.localhost/update.html */
  updatePageBase: string;
}

let progressWindow: UpdateProgressWindow | null = null;

type InstallPhase = "running" | "error" | "quitting";

const closeProgressWindow = (): void => {
  progressWindow?.close();
  progressWindow = null;
};

/**
 * 下载 → 校验 → 启动安装程序。
 * 主窗口在进度窗口立起来之后才藏；进度只发给进度窗口，
 * 失败时窗口留着让用户点「返回启动器」，取消则直接收窗口回主界面。
 */
async function installSelfUpdate(host: SelfUpdateHost): Promise<void> {
  if (!app.isPackaged) {
    throw new Error("开发模式不会替换当前进程，请用安装版或便携版测试自更新。");
  }
  if (
    !isPortable() &&
    process.execPath.toLowerCase().includes("win-unpacked")
  ) {
    throw new Error("解包目录不能原地更新，请用安装版或便携版。");
  }
  if (busy) {
    throw new Error("正在更新，请稍候。");
  }

  busy = true;
  const controller = new AbortController();
  abortRef = controller;
  let phase: InstallPhase = "running";
  let progressWin: UpdateProgressWindow | null = null;

  try {
    if (!ready) {
      const status = await checkSelfUpdate();

      if (status.state !== "available" || !ready) {
        throw new Error(status.message || "没有可安装的更新");
      }
    }

    const target = ready;
    const portable = isPortable();
    const file = pickFile(target.files, portable);

    if (!file) {
      throw new Error(portable ? "发布里没有便携版" : "发布里没有安装包");
    }
    const name = fileNameOf(file.url);

    if (!isLauncherAsset(name)) {
      throw new Error(`更新包文件名不符合预期：${name}`);
    }
    const url = target.assets.get(name);

    if (!url) {
      throw new Error(`发布里没有 ${name}`);
    }
    const dest = join(tmpdir(), name);

    await rm(dest, { force: true }).catch(() => undefined);

    // 先让进度窗口挂载，再藏主窗口：界面上不会出现「什么都没有」的空档
    progressWin = new UpdateProgressWindow({
      preload: host.preload,
      url: `${host.updatePageBase}?from=${encodeURIComponent(
        currentVersion()
      )}&to=${encodeURIComponent(target.version)}`,
      onClosed: () => {
        if (phase === "quitting") {
          return;
        }
        if (phase === "running") {
          controller.abort();
        }
        host.showMainWindow();
      },
    });
    progressWindow = progressWin;
    await progressWin.open();
    host.hideMainWindow();

    const emit = (progress: SelfUpdateProgress): void => {
      progressWin?.send(progress);
    };

    const meter = createSpeedMeter();
    const total = file.size;
    let lastSentAt = 0;

    emit(progressOf("downloading", { percent: 0, totalBytes: total }));

    try {
      await downloadTo(
        url,
        dest,
        (received) => {
          const now = Date.now();

          meter.sample(received, now);
          if (now - lastSentAt < PROGRESS_INTERVAL_MS) {
            return;
          }
          lastSentAt = now;
          emit(
            progressOf("downloading", {
              percent:
                total > 0
                  ? Math.min(99, Math.floor((received / total) * 100))
                  : null,
              receivedBytes: received,
              totalBytes: total,
              bytesPerSecond: meter.rate(),
            })
          );
        },
        controller.signal
      );
    } catch (error) {
      await rm(dest, { force: true }).catch(() => undefined);
      throw error;
    }

    emit(
      progressOf("downloading", {
        percent: 100,
        receivedBytes: total,
        totalBytes: total,
        bytesPerSecond: meter.rate(),
      })
    );
    emit(progressOf("verifying", { message: "正在校验更新包…" }));

    const info = await stat(dest);
    const digest = sha512Base64(await readFile(dest));

    if (info.size !== file.size || digest !== file.sha512) {
      await rm(dest, { force: true }).catch(() => undefined);
      throw new Error("更新包校验失败，已删除下载文件，请重试。");
    }

    logToFile("自更新：校验通过，准备退出", {
      version: target.version,
      name,
    });
    emit(
      progressOf("installing", {
        message: portable ? "正在替换便携版并重启…" : "正在启动安装程序…",
      })
    );

    if (portable) {
      swapPortable(dest, process.env.PORTABLE_EXECUTABLE_FILE ?? "");
    } else {
      launchSetup(dest);
    }
    phase = "quitting";
    app.quit();
  } catch (error) {
    logToFile("自更新失败", error);

    if (controller.signal.aborted) {
      closeProgressWindow();
      host.showMainWindow();
    } else if (progressWin !== null && progressWin.opened) {
      phase = "error";
      progressWin.send(progressOf("error", { message: readable(error) }));
    } else {
      throw error;
    }
  } finally {
    busy = false;
    abortRef = null;
  }
}

export function registerSelfUpdateIpc(host: SelfUpdateHost): void {
  ipcMain.handle(IPC.selfUpdateStatus, async () => checkSelfUpdate());
  ipcMain.handle(IPC.selfUpdateInstall, async () => {
    await installSelfUpdate(host);
  });
  ipcMain.handle(IPC.selfUpdateCancel, () => {
    abortRef?.abort();
  });
  ipcMain.handle(IPC.selfUpdateDismiss, () => {
    closeProgressWindow();
    host.showMainWindow();
  });
}
