import { writeFile } from "node:fs/promises";
import path from "node:path";

import { app, BrowserWindow, screen, shell } from "electron";

import { resolveAppIcon } from "./lib/icon";
import { applyTitleBarTheme } from "./lib/titlebar";
import { isExternalUrl, isTrustedUrl } from "./renderer-route";
import { settingsStore } from "./services/settings";
import { createWindowSizeStore, MIN_WINDOW_SIZE } from "./window-size";

/**
 * 创建主窗口。
 *
 * 外观：无边框标题栏（保留 Windows 原生窗口按钮）＋ 自绘标题区，
 * 这是「官方启动器」观感与「零事故拖动/缩放」之间的平衡点。
 */
export function createMainWindow({
  preload,
  url,
  devOrigin,
}: {
  preload: string;
  url: string;
  devOrigin: string | null;
}): BrowserWindow {
  const { theme } = settingsStore.get();

  // 每次启动都开成同一个尺寸：读上次退出时的长宽，没有记录才用默认值
  const windowSizeStore = createWindowSizeStore(
    path.join(app.getPath("userData"), "window-state.json"),
    screen.getPrimaryDisplay().workAreaSize
  );
  const { height, width } = windowSizeStore.read();

  const win = new BrowserWindow({
    width,
    height,
    minWidth: MIN_WINDOW_SIZE.width,
    // 侧栏 7 项（65px + 10px 间距）+ 顶栏 60 + 状态条 26，再留一条缝。
    // 再矮就会让侧栏压到状态条上。
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    backgroundColor: theme === "dark" ? "#171718" : "#ffffff",
    autoHideMenuBar: true,
    title: "探索者启动器",
    icon: resolveAppIcon() ?? undefined,
    // 无边框：与原版一致，最小化/最大化/关闭由渲染进程自绘
    frame: false,
    webPreferences: {
      preload,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  windowSizeStore.track(win);

  win.once("ready-to-show", () => {
    win.show();
    applyTitleBarTheme(win, settingsStore.get().theme);
  });

  // 站内链接一律用系统浏览器打开，避免应用内被导航走
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isExternalUrl(target)) {
      void shell.openExternal(target);
    }
    return { action: "deny" };
  });

  // 只允许停留在本应用自己的来源上，其他一律外抛
  win.webContents.on("will-navigate", (event, target) => {
    if (isTrustedUrl(target, devOrigin)) {
      return;
    }
    event.preventDefault();

    if (isExternalUrl(target)) {
      void shell.openExternal(target);
    }
  });

  void win.loadURL(url);

  return win;
}

/**
 * 自检截图：设置环境变量 XL_CAPTURE=<png 路径> 后启动，
 * 应用会在界面渲染完成后截图并退出。用于无人值守的 UI 验证。
 */
export function installCaptureHook(win: BrowserWindow, quit: () => void): void {
  const target = process.env.XL_CAPTURE;

  if (!target) {
    return;
  }

  const delay = Number(process.env.XL_CAPTURE_DELAY ?? 1800);
  const route = process.env.XL_CAPTURE_ROUTE;

  win.webContents.once("did-finish-load", () => {
    void (async () => {
      try {
        // 先等 React 首屏挂载并完成异步引导，再切路由（否则事件无人接收）
        await new Promise((r) => setTimeout(r, delay));

        if (route) {
          await win.webContents.executeJavaScript(
            `window.dispatchEvent(new CustomEvent('xl:navigate',{detail:${JSON.stringify(route)}}))`
          );
          await new Promise((r) => setTimeout(r, 700));
        }

        const image = await win.webContents.capturePage();
        await writeFile(target, image.toPNG());
        process.stdout.write(`[capture] saved ${target}\n`);
      } catch (error) {
        process.stderr.write(`[capture] failed: ${String(error)}\n`);
      } finally {
        quit();
      }
    })();
  });
}
