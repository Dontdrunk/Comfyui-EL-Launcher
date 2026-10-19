import type { BrowserWindow } from 'electron'
import type { ThemeMode } from '@shared/types'

/**
 * 标题栏遮罩配色跟随主题。
 * Windows 下 titleBarStyle:'hidden' + titleBarOverlay 会保留原生最小化/最大化/关闭按钮，
 * 但遮罩颜色由我们指定，必须随亮/暗主题同步，否则按钮在浅色底上看不见。
 */
export const TITLEBAR_HEIGHT = 40

const COLORS: Record<ThemeMode, { color: string; symbolColor: string }> = {
  dark: { color: '#171718', symbolColor: '#d9d9d9' },
  light: { color: '#ffffff', symbolColor: '#202121' }
}

export function titleBarOverlayFor(theme: ThemeMode): {
  color: string
  symbolColor: string
  height: number
} {
  return { ...COLORS[theme], height: TITLEBAR_HEIGHT }
}

export function applyTitleBarTheme(win: BrowserWindow | null, theme: ThemeMode): void {
  if (!win || win.isDestroyed()) return
  try {
    win.setTitleBarOverlay(titleBarOverlayFor(theme))
  } catch {
    /* 平台不支持时忽略（非 Windows） */
  }
}
