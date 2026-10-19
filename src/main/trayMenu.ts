import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import { IPC } from '@shared/ipc'
import { logToFile } from './lib/logger'

export interface TrayMenuActions {
  open: () => void
  openSettings: () => void
  quit: () => void
}

/**
 * 系统托盘菜单按文字宽度收缩，「打开」两个字会把气泡收得很窄，两侧留白加不进去。
 * 这里改成贴在图标上方的小窗，宽度固定，文字居中，两边留出同样的空白。
 */
const MENU_WIDTH = 148
const MENU_HEIGHT = 132

let menuWindow: BrowserWindow | null = null
let allowBlurClose = false
let getActions: (() => TrayMenuActions | null) | null = null

function menuHtml(dark: boolean): string {
  const bg = dark ? '#2c2c2c' : '#f7f7f7'
  const fg = dark ? '#f5f5f5' : '#1c1c1c'
  const hover = dark ? '#3d3d3d' : '#e6e6e6'
  const line = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const shadow = dark ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.18)'
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  body {
    box-sizing: border-box;
    padding: 10px;
    font: 14px/1.2 "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif;
    user-select: none;
  }
  .menu {
    height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 6px;
    border-radius: 8px;
    background: ${bg};
    color: ${fg};
    box-shadow: 0 0 0 1px ${line}, 0 10px 28px ${shadow};
  }
  button {
    flex: 1;
    border: 0;
    margin: 0;
    padding: 0 28px;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: center;
    cursor: default;
  }
  button:hover, button:focus-visible { background: ${hover}; outline: none; }
</style>
</head>
<body>
  <div class="menu">
    <button type="button" data-act="open">打开</button>
    <button type="button" data-act="settings">设置</button>
    <button type="button" data-act="quit">退出</button>
  </div>
  <script>
    const api = window.trayMenu
    document.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => api && api.act(btn.getAttribute('data-act')))
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && api) api.act('dismiss')
    })
  </script>
</body>
</html>`
}

function placeMenu(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  let x = Math.round(cursor.x - MENU_WIDTH / 2)
  let y = Math.round(cursor.y - MENU_HEIGHT - 8)
  const area = screen.getDisplayNearestPoint(cursor).workArea
  x = Math.min(Math.max(x, area.x + 8), area.x + area.width - MENU_WIDTH - 8)
  y = Math.min(Math.max(y, area.y + 8), area.y + area.height - MENU_HEIGHT - 4)
  win.setBounds({ x, y, width: MENU_WIDTH, height: MENU_HEIGHT })
}

export function installTrayMenu(resolveActions: () => TrayMenuActions | null): void {
  if (getActions) return
  getActions = resolveActions
  ipcMain.on(IPC.trayMenuAct, (event, action: unknown) => {
    const win = menuWindow
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return
    const actions = getActions?.() ?? null
    closeTrayMenu()
    if (!actions || action === 'dismiss') return
    if (action === 'open') actions.open()
    else if (action === 'settings') actions.openSettings()
    else if (action === 'quit') actions.quit()
  })
}

export function closeTrayMenu(): void {
  const win = menuWindow
  if (!win || win.isDestroyed()) return
  menuWindow = null
  allowBlurClose = false
  win.close()
}

export function toggleTrayMenu(): void {
  if (menuWindow && !menuWindow.isDestroyed() && menuWindow.isVisible()) {
    closeTrayMenu()
    return
  }
  openTrayMenu()
}

function openTrayMenu(): void {
  closeTrayMenu()
  const preload = join(__dirname, '../preload/trayMenu.js')
  if (!existsSync(preload)) {
    logToFile('托盘菜单预加载缺失', preload)
    return
  }

  const win = new BrowserWindow({
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    thickFrame: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  menuWindow = win
  allowBlurClose = false
  win.setAlwaysOnTop(true, 'pop-up-menu')
  win.on('closed', () => {
    if (menuWindow === win) menuWindow = null
  })
  win.on('blur', () => {
    if (allowBlurClose && menuWindow === win) closeTrayMenu()
  })

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    placeMenu(win)
    win.show()
    win.focus()
    setTimeout(() => {
      if (menuWindow === win) allowBlurClose = true
    }, 180)
  })

  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(menuHtml(nativeTheme.shouldUseDarkColors))}`)
}
