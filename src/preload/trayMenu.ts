import { contextBridge, ipcRenderer } from 'electron'

/**
 * 只给托盘菜单这个小窗口用，不挂到主界面的 launcher 上。
 * 不要从这里 import @shared：两个 preload 入口一旦共享模块，
 * 构建会拆出 chunks/，Electron 加载主界面 preload 时会失败。
 */
const TRAY_MENU_ACT = 'tray-menu:act'

contextBridge.exposeInMainWorld('trayMenu', {
  act(action: string): void {
    ipcRenderer.send(TRAY_MENU_ACT, action)
  }
})
