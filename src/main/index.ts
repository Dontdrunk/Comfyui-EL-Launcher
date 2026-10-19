import { app, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { registerIpc, wireEventForwarding } from './ipc'
import { installCrashHandlers, logToFile } from './lib/logger'
import { serviceManager } from './services/service'
import { settingsStore } from './services/settings'
import { createTray, destroyTray } from './tray'
import { closeTrayMenu } from './trayMenu'
import { createMainWindow, installCaptureHook } from './window'

/**
 * 应用入口。
 *
 * 启动顺序很重要：必须先加载设置，窗口才能按用户主题与折叠状态渲染。
 * 打包后没有控制台，因此关键里程碑都写进 <userData>/logs/launcher.log，
 * 出现「双击没反应」时可直接查看该文件。
 */

installCrashHandlers()
logToFile('--- 启动 ---', {
  version: process.versions.electron,
  packaged: app.isPackaged,
  cwd: process.cwd()
})

let mainWindow: BrowserWindow | null = null
let disposeEvents: (() => void) | null = null

function trackWindow(win: BrowserWindow): void {
  win.on('close', () => {
    closeTrayMenu()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
}

function ensureMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
    trackWindow(mainWindow)
  }
  return mainWindow
}

/** 把主窗口带到前台。最小化或被别的窗口挡住时都能拉回来。 */
function presentMainWindow(): BrowserWindow {
  const win = ensureMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}

function openSettings(): void {
  const win = presentMainWindow()
  const send = (): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.evtNavigate, 'settings')
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
}

const gotLock = app.requestSingleInstanceLock()
logToFile('requestSingleInstanceLock', { gotLock })

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (app.isReady()) presentMainWindow()
  })

  app
    .whenReady()
    .then(async () => {
      logToFile('whenReady')

      await settingsStore.load()
      logToFile('设置已加载', { path: settingsStore.path, root: settingsStore.get().comfyRoot })

      registerIpc(() => mainWindow)
      disposeEvents = wireEventForwarding(() => mainWindow)

      const win = ensureMainWindow()
      logToFile('窗口已创建')

      // 托盘和窗口一起起来，右下角图标不依赖窗口是否在前台
      createTray({
        open: () => presentMainWindow(),
        openSettings,
        quit: () => app.quit()
      })

      installCaptureHook(win, () => app.quit())

      app.on('activate', () => {
        presentMainWindow()
      })
    })
    .catch((err) => {
      // 启动失败必须留痕，否则用户只能看到「双击没反应」
      logToFile('启动失败', err)
      app.quit()
    })

  app.on('window-all-closed', () => {
    logToFile('window-all-closed → 退出')
    app.quit()
  })

  // 退出前务必收掉 ComfyUI 进程，否则会留下占着显存的孤儿进程
  app.on('before-quit', () => {
    logToFile('before-quit')
    destroyTray()
    disposeEvents?.()
    serviceManager.dispose()
  })
}
