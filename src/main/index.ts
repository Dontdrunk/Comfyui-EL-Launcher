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
/** 托盘是否真的挂上了。没挂上时退回「关闭即退出」，否则用户没有别的出口。 */
let trayReady = false
/** 真正结束进程（托盘「退出」/自更新/自检截图）才置 true；普通关闭只收窗口 */
let quitting = false

/**
 * 关窗 ≠ 退出。
 *
 * 标题栏 X、Alt+F4、任务栏右键「关闭窗口」都只把窗口收进托盘，
 * 进程、托盘图标和 ComfyUI 状态都继续留着；重新打开时无需等待冷启动。
 * 真正退出进程只有托盘菜单「退出」一条路（before-quit 里置 quitting）。
 * 托盘图标缺失时退回旧行为，避免出现「关不掉」的窗口。
 */
function trackWindow(win: BrowserWindow): void {
  win.on('close', (event) => {
    closeTrayMenu()
    if (quitting) return
    if (!trayReady) {
      // 没有托盘就没有「打开/退出」入口，这时关闭窗口必须等于退出
      quitting = true
      return
    }
    event.preventDefault()
    win.hide()
    logToFile('主窗口已隐藏到托盘')
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
  // 隐藏后再显示时，Windows 不一定把窗口顶到最前，这里补一下
  win.moveTop()
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
    logToFile('second-instance：把已有窗口拉到前台')
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
      trayReady = createTray({
        open: () => presentMainWindow(),
        openSettings,
        // 唯一真正结束进程的入口
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

  // 常驻托盘应用：最后一个窗口关掉也不退出，否则托盘会跟着消失、
  // 用户再双击图标只会撞上单实例锁（看起来就是「打不开」）。
  // 例外：托盘没挂上时保持旧行为，否则窗口关掉后进程就没法结束了。
  app.on('window-all-closed', () => {
    logToFile('window-all-closed（托盘驻留，不退出）', { trayReady })
    if (!trayReady) app.quit()
  })

  // 退出前务必收掉 ComfyUI 进程，否则会留下占着显存的孤儿进程
  app.on('before-quit', () => {
    quitting = true
    logToFile('before-quit')
    destroyTray()
    disposeEvents?.()
    serviceManager.dispose()
  })
}
