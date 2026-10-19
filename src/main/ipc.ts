import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppSettings,
  LaunchDefaults,
  RuntimeInfo,
  ServiceStatus,
  DiskProbe,
  EnvLayout,
  JobSnapshot
} from '@shared/types'
import { checkLayout, probeDisk, probeRuntime } from './services/env'
import { jobManager } from './services/jobs'
import { serviceManager } from './services/service'
import { pickRoot, settingsStore } from './services/settings'
import { applyTitleBarTheme } from './lib/titlebar'
import { registerVersionIpc } from './ipc-version'
import { registerNodesIpc } from './ipc-nodes'
import { registerModelsIpc } from './ipc-models'
import { registerPipIpc } from './ipc-pip'
import { registerSelfUpdateIpc } from './services/selfUpdate'

/* ══════════════════════════════════════════════════════════
 * IPC 注册
 *
 * 约定：所有 handler 都返回 Promise，失败时抛出可读错误，
 * 渲染进程统一在 invoke 处 catch 并展示。
 * ══════════════════════════════════════════════════════════ */

/** 只允许打开 http/https，防止自定义协议被执行 */
function isSafeExternal(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  /* ────────── 设置 ────────── */

  ipcMain.handle(IPC.settingsGet, async (): Promise<AppSettings> => {
    return settingsStore.get()
  })

  ipcMain.handle(
    IPC.settingsPatch,
    async (_e, patch: Partial<AppSettings>): Promise<AppSettings> => {
      const before = settingsStore.get()
      const next = await settingsStore.patch(patch ?? {})
      if (next.theme !== before.theme) applyTitleBarTheme(getWindow(), next.theme)

      // 说明：端口/启动参数只在下次启动生效。渲染进程会根据 service.status
      // 自行提示「重启后生效」，这里不做隐式重启，避免打断正在跑的任务。
      return next
    }
  )

  ipcMain.handle(IPC.dialogPickDirectory, async (_e, defaultPath?: string): Promise<string | null> => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '选择 ComfyUI 便携版根目录',
          defaultPath: defaultPath || undefined,
          properties: ['openDirectory'],
          buttonLabel: '选择此目录'
        })
      : await dialog.showOpenDialog({
          title: '选择 ComfyUI 便携版根目录',
          defaultPath: defaultPath || undefined,
          properties: ['openDirectory'],
          buttonLabel: '选择此目录'
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  /* ────────── 环境 ────────── */

  ipcMain.handle(IPC.envCheck, async (_e, root?: string): Promise<EnvLayout> => {
    return checkLayout(pickRoot(root))
  })

  ipcMain.handle(IPC.envProbeRuntime, async (_e, root?: string): Promise<RuntimeInfo> => {
    return probeRuntime(pickRoot(root))
  })

  ipcMain.handle(IPC.envProbeDisk, async (): Promise<DiskProbe> => {
    return probeDisk(settingsStore.get().comfyRoot)
  })

  /* ────────── 服务进程 ────────── */

  ipcMain.handle(IPC.serviceStatus, async (): Promise<ServiceStatus> => serviceManager.status())

  ipcMain.handle(
    IPC.serviceStart,
    async (_e, override?: Partial<LaunchDefaults>): Promise<ServiceStatus> => {
      return serviceManager.start(override)
    }
  )

  ipcMain.handle(IPC.serviceStop, async (): Promise<ServiceStatus> => serviceManager.stop())
  ipcMain.handle(IPC.serviceLogs, async () => serviceManager.getLogs())
  ipcMain.handle(IPC.serviceLogsClear, async () => {
    serviceManager.clearLogs()
  })

  /* ────────── 任务 ────────── */

  ipcMain.handle(IPC.jobList, async (): Promise<JobSnapshot[]> => jobManager.list())
  ipcMain.handle(IPC.jobGet, async (_e, id: string): Promise<JobSnapshot | null> => jobManager.get(id))
  ipcMain.handle(IPC.jobCancel, async (_e, id: string): Promise<boolean> => jobManager.cancel(id))

  /* ────────── 窗口控制 ────────── */

  ipcMain.handle(IPC.windowMinimize, async (): Promise<void> => {
    getWindow()?.minimize()
  })

  ipcMain.handle(IPC.windowMaximize, async (): Promise<boolean> => {
    const win = getWindow()
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  ipcMain.handle(IPC.windowClose, async (): Promise<void> => {
    getWindow()?.close()
  })

  ipcMain.handle(IPC.windowIsMaximized, async (): Promise<boolean> => {
    return getWindow()?.isMaximized() ?? false
  })

  /* ────────── 系统交互 ────────── */

  ipcMain.handle(IPC.shellOpenExternal, async (_e, url: string): Promise<void> => {
    if (!isSafeExternal(url)) throw new Error(`拒绝打开非 http(s) 链接：${url}`)
    await shell.openExternal(url)
  })

  ipcMain.handle(IPC.shellOpenPath, async (_e, target: string): Promise<void> => {
    const err = await shell.openPath(target)
    if (err) throw new Error(err)
  })

  ipcMain.handle(IPC.shellShowItem, async (_e, target: string): Promise<void> => {
    shell.showItemInFolder(target)
  })

  /* ────────── 版本管理 / 备份（M2） ────────── */
  registerVersionIpc()

  /* ────────── 插件管理（M3） ────────── */
  registerNodesIpc()

  /* ────────── 模型管理（M4） ────────── */
  registerModelsIpc()

  /* ────────── 环境管理 ────────── */
  registerPipIpc(getWindow)

  /* ────────── 启动器自身更新 ────────── */
  registerSelfUpdateIpc(getWindow)
}

/** 把主进程产生的日志/状态/任务事件推给渲染进程 */
export function wireEventForwarding(getWindow: () => BrowserWindow | null): () => void {
  const send = (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(channel, payload)
  }

  const offLog = serviceManager.onLog((line) => send(IPC.evtLog, line))
  const offStatus = serviceManager.onStatus((status) => send(IPC.evtServiceStatus, status))
  const offJob = jobManager.onEvent((event) => send(IPC.evtJob, event))

  return () => {
    offLog()
    offStatus()
    offJob()
  }
}
