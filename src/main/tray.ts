import { execFile } from 'node:child_process'
import { Tray, nativeImage } from 'electron'
import { logToFile } from './lib/logger'
import { resolveAppIcon } from './lib/icon'
import { closeTrayMenu, installTrayMenu, toggleTrayMenu } from './trayMenu'

export interface TrayActions {
  /** 把主窗口带到前台 */
  open: () => void
  /** 打开主窗口并切到设置页 */
  openSettings: () => void
  quit: () => void
}

let tray: Tray | null = null
let stopped = false
let actions: TrayActions | null = null

const MENU_LABELS = ['打开', '设置', '退出'] as const

function mount(current: TrayActions): boolean {
  if (tray) return true

  const iconPath = resolveAppIcon()
  if (!iconPath) {
    logToFile('托盘图标缺失，跳过托盘')
    return false
  }

  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    logToFile('托盘图标无法解码', iconPath)
    return false
  }

  tray = new Tray(image)
  tray.setToolTip('探索者启动器')
  let suppressClick = false
  tray.on('right-click', () => {
    suppressClick = true
    toggleTrayMenu()
    setTimeout(() => {
      suppressClick = false
    }, 250)
  })
  tray.on('click', () => {
    if (suppressClick) return
    closeTrayMenu()
    current.open()
  })
  logToFile('托盘已创建', { iconPath, menu: MENU_LABELS })
  return true
}

function unmount(): void {
  closeTrayMenu()
  if (!tray) return
  tray.destroy()
  tray = null
}

/**
 * Windows 11 会把新出现的托盘图标收进「^」溢出区，右下角看起来像没图标。
 * 把自己的 NotifyIconSettings\IsPromoted 写成 1，系统才会把它放在时钟旁边。
 * 只改当前进程 exe 对应的那一条，不碰别的程序。
 */
function promoteOwnTrayIcon(): Promise<'changed' | 'same' | 'missing' | 'error'> {
  if (process.platform !== 'win32') return Promise.resolve('same')

  // foreach 语句写在当前作用域。ForEach-Object 的脚本块有自己的作用域，
  // $found 赋进去外层看不见，结果会永远报 missing。
  const script = [
    "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$found = $false",
    "$changed = $false",
    "$items = @(Get-ChildItem 'HKCU:\\Control Panel\\NotifyIconSettings' -ErrorAction SilentlyContinue)",
    'foreach ($item in $items) {',
    '  $p = Get-ItemProperty -LiteralPath $item.PSPath',
    '  if ($p.ExecutablePath -and ($p.ExecutablePath -ieq $env:XL_TRAY_EXE)) {',
    '    $found = $true',
    '    if ($p.IsPromoted -ne 1) {',
    '      New-ItemProperty -LiteralPath $item.PSPath -Name IsPromoted -PropertyType DWord -Value 1 -Force | Out-Null',
    '      $changed = $true',
    '    }',
    '  }',
    '}',
    "if (-not $found) { 'missing' } elseif ($changed) { 'changed' } else { 'same' }"
  ].join('\n')

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        windowsHide: true,
        timeout: 8000,
        env: { ...process.env, XL_TRAY_EXE: process.execPath }
      },
      (err, stdout) => {
        if (err) {
          logToFile('托盘图标固定失败', err)
          resolve('error')
          return
        }
        const text = stdout.replace(/\0/g, '').trim()
        if (text.includes('changed')) resolve('changed')
        else if (text.includes('missing')) resolve('missing')
        else if (text.includes('same')) resolve('same')
        else {
          logToFile('托盘可见性返回异常', text || '(empty)')
          resolve('same')
        }
      }
    )
  })
}

async function promoteUntilRegistered(): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const result = await promoteOwnTrayIcon()
    if (result === 'changed') return true
    if (result === 'same' || result === 'error') return false
    await new Promise((r) => setTimeout(r, 400))
  }
  logToFile('托盘图标仍在溢出区，系统还没记下这个程序')
  return false
}

/**
 * 桌面右下角托盘图标。右键菜单三项：打开、设置、退出。
 * 左键单击等同于「打开」。
 */
export function createTray(next: TrayActions): void {
  stopped = false
  actions = next
  installTrayMenu(() => actions)
  if (!mount(next)) return

  void promoteUntilRegistered().then((changed) => {
    if (!changed || stopped || !actions) return
    unmount()
    if (stopped) return
    mount(actions)
    logToFile('托盘图标已显示在任务栏右下角')
  })
}

export function destroyTray(): void {
  stopped = true
  unmount()
}
