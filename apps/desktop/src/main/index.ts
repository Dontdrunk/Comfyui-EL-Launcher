import path from "node:path";

import type { BrowserWindow } from "electron";
import { app } from "electron";

import { IPC, rendererOrigin } from "@explorer-launcher/electron";

import { defaultApiOrigin } from "#src/main/config.ts";
import { registerIpc, wireEventForwarding } from "#src/main/ipc.ts";
import { installCrashHandlers, logToFile } from "#src/main/lib/logger.ts";
import {
  parseHttpOrigin,
  parseLoopbackOrigin,
} from "#src/main/renderer-route.ts";
import { serveRenderer } from "#src/main/renderer.ts";
import { serviceManager } from "#src/main/services/service.ts";
import { settingsStore } from "#src/main/services/settings.ts";
import { createTray, destroyTray } from "#src/main/tray.ts";
import { closeTrayMenu } from "#src/main/trayMenu.ts";
import { createMainWindow, installCaptureHook } from "#src/main/window.ts";

/**
 * 应用入口。
 *
 * 启动顺序很重要：必须先加载设置，窗口才能按用户主题与折叠状态渲染。
 * 打包后没有控制台，因此关键里程碑都写进 <userData>/logs/launcher.log，
 * 出现「双击没反应」时可直接查看该文件。
 */

const origin = (
  name: string,
  parse: (value: string) => string | null
): string | null => {
  const value = process.env[name];

  if (value === undefined || value === "") {
    return null;
  }
  const parsed = parse(value);

  if (parsed === null) {
    throw new Error(`${name} is not a valid origin: ${value}`);
  }
  return parsed;
};

const devOrigin = origin("ELECTRON_RENDERER_URL", parseLoopbackOrigin);

const apiOrigin =
  origin("API_ORIGIN", parseHttpOrigin) ?? parseHttpOrigin(defaultApiOrigin);

if (apiOrigin === null) {
  throw new Error(`defaultApiOrigin is not an origin: ${defaultApiOrigin}`);
}

// 应用身份沿用旧版：userData 目录（config.json / logs / 备份）原样继承，
// 用户升级后不用重设 ComfyUI 路径、主题与启动参数。
app.setName("explorer-launcher");

installCrashHandlers();

logToFile("--- 启动 ---", {
  version: process.versions.electron,
  packaged: app.isPackaged,
  cwd: process.cwd(),
});

let mainWindow: BrowserWindow | null = null;
let disposeEvents: (() => void) | null = null;

/** 托盘是否真的挂上了。没挂上时退回「关闭即退出」，否则用户没有别的出口。 */
let trayReady = false;

/** 真正结束进程（托盘「退出」/自更新/自检截图）才置 true；普通关闭只收窗口 */
let quitting = false;

/**
 * 关窗 ≠ 退出。
 *
 * 标题栏 X、Alt+F4、任务栏右键「关闭窗口」都只把窗口收进托盘，
 * 进程、托盘图标和 ComfyUI 状态都继续留着；重新打开时无需等待冷启动。
 * 真正退出进程只有托盘菜单「退出」一条路（before-quit 里置 quitting）。
 * 托盘图标缺失时退回旧行为，避免出现「关不掉」的窗口。
 */
function trackWindow(win: BrowserWindow): void {
  win.on("close", (event) => {
    closeTrayMenu();

    if (quitting) {
      return;
    }
    if (!trayReady) {
      // 没有托盘就没有「打开/退出」入口，这时关闭窗口必须等于退出
      quitting = true;

      return;
    }

    event.preventDefault();
    win.hide();
    logToFile("主窗口已隐藏到托盘");
  });
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
}

function ensureMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow({
      devOrigin,
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      url: devOrigin ?? `${rendererOrigin}/`,
    });
    trackWindow(mainWindow);
  }

  return mainWindow;
}

/** 把主窗口带到前台。最小化或被别的窗口挡住时都能拉回来。 */
function presentMainWindow(): BrowserWindow {
  const win = ensureMainWindow();

  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
  // 隐藏后再显示时，Windows 不一定把窗口顶到最前，这里补一下
  win.moveTop();

  return win;
}

function openSettings(): void {
  const win = presentMainWindow();

  const send = (): void => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.evtNavigate, "settings");
    }
  };

  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

const gotLock = app.requestSingleInstanceLock();

logToFile("requestSingleInstanceLock", { gotLock });

if (gotLock) {
  app.on("second-instance", () => {
    logToFile("second-instance：把已有窗口拉到前台");
    if (app.isReady()) presentMainWindow();
  });

  app
    .whenReady()
    .then(async () => {
      logToFile("whenReady");

      await settingsStore.load();
      logToFile("设置已加载", {
        path: settingsStore.path,
        root: settingsStore.get().comfyRoot,
      });

      // 生产环境走自定义 https 源提供渲染资源（app.localhost），开发环境直连 vite dev server
      if (devOrigin === null) {
        serveRenderer({
          apiOrigin,
          rendererRoot: path.join(import.meta.dirname, "../renderer"),
        });
      }

      registerIpc(() => mainWindow);
      disposeEvents = wireEventForwarding(() => mainWindow);

      const win = ensureMainWindow();
      logToFile("窗口已创建");

      // 托盘和窗口一起起来，右下角图标不依赖窗口是否在前台
      trayReady = createTray({
        open: () => presentMainWindow(),
        openSettings,
        // 唯一真正结束进程的入口
        quit: () => {
          app.quit();
        },
      });

      // 上次启动器被强杀时 ComfyUI 会剩下来继续占着端口：能接管就直接接管
      void serviceManager.adoptExisting();

      installCaptureHook(win, () => {
        app.quit();
      });

      app.on("activate", () => {
        presentMainWindow();
      });
    })
    .catch((err) => {
      // 启动失败必须留痕，否则用户只能看到「双击没反应」
      logToFile("启动失败", err);
      app.quit();
    });

  // 常驻托盘应用：最后一个窗口关掉也不退出，否则托盘会跟着消失、
  // 用户再双击图标只会撞上单实例锁（看起来就是「打不开」）。
  // 例外：托盘没挂上时保持旧行为，否则窗口关掉后进程就没法结束了。
  app.on("window-all-closed", () => {
    logToFile("window-all-closed（托盘驻留，不退出）", { trayReady });
    if (!trayReady) app.quit();
  });

  // 退出前务必收掉 ComfyUI 进程，否则会留下占着显存的孤儿进程
  app.on("before-quit", () => {
    quitting = true;
    logToFile("before-quit");
    destroyTray();
    disposeEvents?.();
    serviceManager.dispose();
  });
} else {
  app.quit();
}
