import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { EnvBackupFile, OpResult, PipPackage } from '@shared/types'
import { runOp } from './lib/runOp'
import { pathExists } from './services/nodeScan'
import {
  freezeEnv,
  installTarget,
  listEnvBackups,
  listPackages,
  locatePackage,
  pipFileDialogDir,
  reinstallPackage,
  restoreEnv,
  uninstallPackage
} from './services/pipEnv'
import { resolveComfyPaths } from './lib/paths'
import { pickRoot } from './services/settings'

/* ══════════════════════════════════════════════════════════
 * 环境管理 IPC
 * 列表、打开目录、枚举备份是短调用；安装和恢复走任务。
 * ══════════════════════════════════════════════════════════ */

export function registerPipIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.pipList, async (_e, root?: string): Promise<PipPackage[]> => {
    return listPackages(pickRoot(root))
  })

  ipcMain.handle(IPC.pipLocate, async (_e, name: string, root?: string): Promise<string> => {
    return locatePackage(pickRoot(root), name ?? '')
  })

  ipcMain.handle(IPC.pipBackups, async (_e, root?: string): Promise<EnvBackupFile[]> => {
    return listEnvBackups(pickRoot(root))
  })

  ipcMain.handle(IPC.pipInstall, async (_e, spec: string, root?: string): Promise<OpResult<null>> => {
    const target = pickRoot(root)
    const label = (spec ?? '').trim() || '包'
    return runOp('pip-install', `安装 ${label}`, async (ctx) => {
      await installTarget(target, spec ?? '', (stream, text) => ctx.log(text, stream), ctx.signal)
      return null
    })
  })

  ipcMain.handle(IPC.pipUninstall, async (_e, name: string, root?: string): Promise<OpResult<null>> => {
    const target = pickRoot(root)
    return runOp('pip-uninstall', `卸载 ${name}`, async (ctx) => {
      await uninstallPackage(target, name ?? '', (stream, text) => ctx.log(text, stream), ctx.signal)
      return null
    })
  })

  ipcMain.handle(
    IPC.pipReinstall,
    async (_e, name: string, version: string, root?: string): Promise<OpResult<null>> => {
      const target = pickRoot(root)
      return runOp('pip-reinstall', `重装 ${name}==${version}`, async (ctx) => {
        await reinstallPackage(
          target,
          name ?? '',
          version ?? '',
          (stream, text) => ctx.log(text, stream),
          ctx.signal
        )
        return null
      })
    }
  )

  ipcMain.handle(
    IPC.pipBackup,
    async (_e, label: string, root?: string): Promise<OpResult<EnvBackupFile>> => {
      const target = pickRoot(root)
      return runOp('pip-backup', `备份环境 ${label ?? ''}`, async (ctx) => {
        return freezeEnv(target, label ?? '', (stream, text) => ctx.log(text, stream), ctx.signal)
      })
    }
  )

  ipcMain.handle(
    IPC.pipRestore,
    async (_e, filePath: string, root?: string): Promise<OpResult<null>> => {
      const target = pickRoot(root)
      return runOp('pip-restore', '恢复环境', async (ctx) => {
        await restoreEnv(target, filePath ?? '', (stream, text) => ctx.log(text, stream), ctx.signal)
        return null
      })
    }
  )

  ipcMain.handle(IPC.dialogPickPipFile, async (_e, defaultPath?: string): Promise<string | null> => {
    const root = pickRoot()
    const suggested = defaultPath?.trim() || pipFileDialogDir(root)
    const paths = root.trim() ? resolveComfyPaths(root) : null
    const start = suggested && (await pathExists(suggested))
      ? suggested
      : paths && (await pathExists(paths.pythonDir))
        ? paths.pythonDir
        : undefined

    const win = getWindow()
    const options: Electron.OpenDialogOptions = {
      title: '选择 .whl 或依赖.txt',
      defaultPath: start,
      properties: ['openFile'],
      buttonLabel: '选择',
      filters: [{ name: 'whl 或 requirements.txt', extensions: ['whl', 'txt'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
