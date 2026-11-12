import { BrowserWindow, ipcMain } from "electron";

import { IPC } from "@explorer-launcher/electron";
import type { SelfUpdateProgress } from "@explorer-launcher/electron";

import { resolveAppIcon } from "./lib/icon";
import { logToFile } from "./lib/logger";
import { applyTitleBarTheme } from "./lib/titlebar";
import { settingsStore } from "./services/settings";

/* ══════════════════════════════════════════════════════════
 * 自更新进度窗口
 *
 * 主窗口在更新开始时就藏起来：下载、校验、跑安装程序都在这个
 * 独立小窗口里完成，免得把「正在退出」的界面留在屏幕上。
 * 无边框、不可缩放，只有一条拖拽区；窗口被用户关掉视为取消。
 * ══════════════════════════════════════════════════════════ */

const WIDTH = 460;
const HEIGHT = 196;

/** 进度页挂载后会回一条 ui-ready；超时也继续，宁可丢第一条事件也不卡住更新 */
const READY_TIMEOUT_MS = 2000;

const sleep = async (ms: number): Promise<boolean> => {
  const { promise, resolve } = Promise.withResolvers<boolean>();

  setTimeout(() => {
    resolve(true);
  }, ms);

  return await promise;
};

interface UpdateWindowOptions {
  preload: string;
  /** 指向 update.html，带版本号查询串 */
  url: string;
  /** 用户自己把窗口关掉（不是我们主动收的） */
  onClosed: () => void;
}

export class UpdateProgressWindow {
  private win: BrowserWindow | null = null;
  private disposing = false;
  private readonly options: UpdateWindowOptions;

  constructor(options: UpdateWindowOptions) {
    this.options = options;
  }

  get opened(): boolean {
    return this.win !== null && !this.win.isDestroyed();
  }

  async open(): Promise<void> {
    const { theme } = settingsStore.get();

    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      show: false,
      title: "更新启动器",
      backgroundColor: theme === "dark" ? "#171718" : "#ffffff",
      icon: resolveAppIcon() ?? undefined,
      webPreferences: {
        preload: this.options.preload,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });

    this.win = win;
    win.setMenuBarVisibility(false);

    const ready = Promise.withResolvers<boolean>();

    const done = (): void => {
      ipcMain.removeListener(IPC.selfUpdateUiReady, done);
      ready.resolve(true);
    };

    ipcMain.once(IPC.selfUpdateUiReady, done);
    win.once("closed", () => {
      ipcMain.removeListener(IPC.selfUpdateUiReady, done);
      ready.resolve(true);
    });

    win.once("ready-to-show", () => {
      applyTitleBarTheme(win, theme);
      win.show();
    });
    win.on("closed", () => {
      this.win = null;

      if (!this.disposing) {
        this.options.onClosed();
      }
    });

    try {
      await win.loadURL(this.options.url);
      await Promise.race([ready.promise, sleep(READY_TIMEOUT_MS)]);
    } catch (error) {
      // 进度页加载失败不拦更新本身：事件发不出去，但安装流程继续
      logToFile("自更新进度窗口加载失败", error);
    }
  }

  send(progress: SelfUpdateProgress): void {
    if (!this.win || this.win.isDestroyed()) {
      return;
    }

    this.win.webContents.send(IPC.evtSelfUpdate, progress);
  }

  close(): void {
    if (!this.win || this.win.isDestroyed()) {
      this.win = null;

      return;
    }

    this.disposing = true;
    this.win.destroy();
    this.win = null;
  }
}
