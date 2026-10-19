import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  BackupDetail,
  BackupSnapshot,
  GitAvailability,
  OpResult,
  RefKind,
  RestoreResult,
  SwitchPlan,
  SwitchResult,
  UpdateCheck,
  VersionState
} from '@shared/types'
import {
  createBackup,
  deleteBackup,
  listBackups,
  readBackupDetail,
  restoreBackup
} from './services/backup'
import { gitAvailable } from './services/git'
import { runOp } from './lib/runOp'
import { checkUpdate } from './services/releases'
import {
  fetchRemote,
  getVersionState,
  listCommits,
  listRemoteTags,
  officialUpdaterCommand,
  planSwitch,
  switchVersion,
  syncRequirements
} from './services/version'
import { pickRoot } from './services/settings'
import { buildChildEnv } from './lib/childEnv'
import { resolveComfyPaths } from './lib/paths'
import { run } from './lib/exec'

/* ══════════════════════════════════════════════════════════
 * 版本管理 / 备份 的 IPC 注册（M2）
 *
 * 长操作统一包成 Job，既产生日志流也让界面能取消；
 * 同时把最终结果通过 OpResult 直接返回，省去调用方回捞。
 * ══════════════════════════════════════════════════════════ */

export function registerVersionIpc(): void {
  /* ────────── git 可用性 ────────── */
  ipcMain.handle(IPC.gitCheck, async (): Promise<GitAvailability> => gitAvailable())

  /* ────────── 版本状态 ────────── */
  ipcMain.handle(IPC.versionState, async (_e, root?: string): Promise<VersionState> => {
    return getVersionState(pickRoot(root))
  })

  ipcMain.handle(IPC.versionRemoteTags, async (_e, root?: string) => {
    return listRemoteTags(pickRoot(root))
  })

  ipcMain.handle(IPC.versionCommits, async (_e, root?: string) => {
    return listCommits(pickRoot(root))
  })

  ipcMain.handle(
    IPC.versionFetchRemote,
    async (_e, root?: string): Promise<{ ok: boolean; error: string | null }> => {
      try {
        // 补齐缺的发版 tag 和 master 完整历史，供版本列表筛选与展示。
        await fetchRemote(pickRoot(root), undefined, undefined, 600_000)
        return { ok: true, error: null }
      } catch (err) {
        // 离线不该让整页失败：本地历史照样能看，只是不是最新的
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(
    IPC.versionCheckUpdate,
    async (_e, root?: string, force?: boolean): Promise<UpdateCheck> => {
      return checkUpdate(pickRoot(root), Boolean(force))
    }
  )

  ipcMain.handle(
    IPC.versionPlan,
    async (_e, target: string, refKind: RefKind, root?: string): Promise<SwitchPlan> => {
      return planSwitch(pickRoot(root), target, refKind)
    }
  )

  /* ────────── 切换版本 ────────── */
  ipcMain.handle(
    IPC.versionSwitch,
    async (
      _e,
      target: string,
      refKind: RefKind,
      opts: { backup?: boolean },
      root?: string
    ): Promise<OpResult<SwitchResult>> => {
      return runOp('version-switch', `切换版本 → ${target}`, async (ctx) => {
        ctx.log(`[任务] 目标：${target}（${refKind}）`)
        const value = await switchVersion(
          pickRoot(root),
          target,
          refKind,
          opts ?? {},
          (stream, text) => ctx.log(text, stream),
          ctx.signal
        )
        return value
      })
    }
  )

  /* ────────── 同步依赖 ────────── */
  ipcMain.handle(IPC.versionSyncDeps, async (_e, root?: string): Promise<OpResult<null>> => {
    return runOp('sync-deps', '同步 Python 依赖', async (ctx) => {
      await syncRequirements(
        pickRoot(root),
        (stream, text) => ctx.log(text, stream),
        ctx.signal
      )
      return null
    })
  })

  /* ────────── 官方完整更新通道 ────────── */
  ipcMain.handle(
    IPC.versionOfficialUpdate,
    async (_e, stable: boolean, root?: string): Promise<OpResult<null>> => {
      const target = pickRoot(root)
      const { cmd, args, cwd, label } = officialUpdaterCommand(target, Boolean(stable))
      return runOp('official-update', label, async (ctx) => {
        ctx.log(`[官方更新] ${label}`)
        ctx.log(`[官方更新] 说明：官方脚本只处理 ComfyUI 代码与依赖，失败时请改用本页的版本切换。`)

        const r = await run(cmd, args, {
          cwd,
          env: buildChildEnv(),
          onLine: (stream, text) => ctx.log(text, stream),
          timeoutMs: 1_800_000,
          signal: ctx.signal
        })

        if (r.spawnError) throw new Error(`无法启动更新脚本：${r.spawnError}`)
        if (r.timedOut) throw new Error('官方更新超时（30 分钟）')
        if (r.aborted) throw new Error('官方更新已取消')
        if (r.code !== 0) {
          const tail = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-8).join('\n')
          throw new Error(`官方更新脚本退出码 ${r.code}\n${tail}`)
        }
        ctx.log('[官方更新] 完成。')
        return null
      })
    }
  )

  /* ────────── 备份 ────────── */
  ipcMain.handle(IPC.backupList, async (_e, root?: string): Promise<BackupSnapshot[]> => {
    return listBackups(pickRoot(root))
  })

  ipcMain.handle(
    IPC.backupDetail,
    async (_e, id: string, root?: string): Promise<BackupDetail | null> => {
      return readBackupDetail(pickRoot(root), id)
    }
  )

  ipcMain.handle(
    IPC.backupCreate,
    async (_e, label?: string, root?: string): Promise<OpResult<BackupSnapshot>> => {
      const target = pickRoot(root)
      return runOp('backup-create', '创建备份', async (ctx) => {
        const snapshot = await createBackup(target, label || 'manual')
        ctx.log(`[备份] 已创建：${snapshot.id}`)
        ctx.log(`[备份] 版本：${snapshot.tag ?? snapshot.commit.slice(0, 8)} · 插件 ${snapshot.nodeCount} 个`)
        return snapshot
      })
    }
  )

  ipcMain.handle(
    IPC.backupRestore,
    async (_e, id: string, root?: string): Promise<OpResult<RestoreResult>> => {
      return runOp('backup-restore', `还原备份 ${id}`, async (ctx) => {
        const value = await restoreBackup(pickRoot(root), id, (stream, text) =>
          ctx.log(text, stream)
        )
        return value
      })
    }
  )

  ipcMain.handle(IPC.backupDelete, async (_e, id: string, root?: string): Promise<void> => {
    await deleteBackup(pickRoot(root), id)
  })

  /* 供渲染进程显示备份目录位置 */
  ipcMain.handle(IPC.backupDir, async (_e, root?: string): Promise<string> => {
    return resolveComfyPaths(pickRoot(root)).backupsDir
  })
}
