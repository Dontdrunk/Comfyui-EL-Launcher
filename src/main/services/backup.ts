import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import type { BackupDetail, BackupNodeEntry, BackupSnapshot, LogStream, RestoreResult } from '@shared/types'
import { backupId, resolveComfyPaths } from '../lib/paths'
import { readAppVersion } from './env'
import { git, gitSoft } from './git'
import { listNodeDirs, pathExists, readNodeGitInfo } from './nodeScan'

/* ══════════════════════════════════════════════════════════
 * 轻量清单式备份
 *
 * 备份/还原 ComfyUI 目录下与「版本有关的元信息」：
 *   version.json          tag / commit / branch / 工作区是否干净
 *   custom_nodes.json     每个插件的仓库与 commit（仅清单）
 *   user/                 用户配置副本（排除可再生的 comfyui.db）
 *   extra_model_paths.yaml
 *
 * 刻意不备份 models/ 与插件文件本体：前者动辄数百 GB，
 * 后者可由清单按需重装。备份目录位于 <root>/_explorer-launcher/backups，
 * 在 git 仓库之外，不会污染版本管理。
 * ══════════════════════════════════════════════════════════ */

const META_FILE = 'version.json'
const NODES_FILE = 'custom_nodes.json'

interface VersionJson {
  id: string
  createdAt: number
  tag: string | null
  commit: string
  branch: string | null
  appVersion: string | null
  dirty: boolean
  dirtyCount: number
  remote: string | null
  launcher: string
  /** 还原时间，null 表示未还原过 */
  restoredAt: number | null
}

/** 从 user/ 目录复制时跳过的运行期文件（体积大且可自动重建） */
function skipUserFile(name: string): boolean {
  return /^comfyui\.db(-shm|-wal)?$/i.test(name) || name.endsWith('.lock')
}

async function currentHead(comfyDir: string): Promise<{
  commit: string
  tag: string | null
  branch: string | null
  dirty: boolean
  dirtyCount: number
  remote: string | null
}> {
  const [commit, tag, branch, porcelain, remote] = await Promise.all([
    git(comfyDir, ['rev-parse', 'HEAD']),
    gitSoft(comfyDir, ['describe', '--tags', '--exact-match', 'HEAD']),
    gitSoft(comfyDir, ['symbolic-ref', '--short', '-q', 'HEAD']),
    gitSoft(comfyDir, ['status', '--porcelain']),
    gitSoft(comfyDir, ['remote', 'get-url', 'origin'])
  ])
  const dirtyLines = (porcelain ?? '').split(/\r?\n/).filter((l) => l.trim().length > 0)
  return {
    commit,
    tag,
    branch,
    dirty: dirtyLines.length > 0,
    dirtyCount: dirtyLines.length,
    remote
  }
}

export async function snapshotNodes(customNodesDir: string): Promise<BackupNodeEntry[]> {
  const dirs = await listNodeDirs(customNodesDir)
  const out: BackupNodeEntry[] = []
  for (const d of dirs) {
    const info = await readNodeGitInfo(d.path)
    out.push({
      dirName: d.dirName,
      baseName: d.baseName,
      enabled: d.enabled,
      isGit: info.isGit,
      remote: info.remote,
      commit: info.commit,
      dirty: info.dirty
    })
  }
  return out
}

/**
 * 创建备份。
 * @param label 可选标签，会拼进 id 便于识别（如 switch-v0.39.2）
 */
export async function createBackup(root: string, label?: string): Promise<BackupSnapshot> {
  const paths = resolveComfyPaths(root)
  const now = new Date()
  const id = label ? `${backupId(now)}_${sanitize(label)}` : backupId(now)
  const dir = join(paths.backupsDir, id)

  await mkdir(dir, { recursive: true })

  const head = await currentHead(paths.comfyDir)
  const appVersion = await readAppVersion(paths.versionFile)
  const nodes = await snapshotNodes(paths.customNodesDir)

  const meta: VersionJson = {
    id,
    createdAt: now.getTime(),
    tag: head.tag,
    commit: head.commit,
    branch: head.branch,
    appVersion,
    dirty: head.dirty,
    dirtyCount: head.dirtyCount,
    remote: head.remote,
    launcher: '0.1.0',
    restoredAt: null
  }

  await writeJson(join(dir, META_FILE), meta)
  await writeJson(join(dir, NODES_FILE), nodes)

  // 用户配置（排除 comfyui.db 等可再生文件）
  try {
    await cp(paths.userDir, join(dir, 'user'), {
      recursive: true,
      filter: (src) => !skipUserFile(basename(src))
    })
  } catch {
    /* user 目录不存在时忽略 */
  }

  if (await pathExists(paths.extraModelPaths)) {
    await cp(paths.extraModelPaths, join(dir, 'extra_model_paths.yaml'))
  }

  return {
    id,
    dir,
    createdAt: meta.createdAt,
    tag: head.tag,
    commit: head.commit,
    branch: head.branch,
    appVersion,
    nodeCount: nodes.length,
    dirty: head.dirty,
    restoredAt: null
  }
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40)
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await writeFile(file, JSON.stringify(data, null, 2), 'utf-8')
}

export async function listBackups(root: string): Promise<BackupSnapshot[]> {
  const paths = resolveComfyPaths(root)
  let entries: { name: string; isDirectory: () => boolean }[]
  try {
    entries = await readdir(paths.backupsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const out: BackupSnapshot[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dir = join(paths.backupsDir, e.name)
    try {
      const meta = JSON.parse(await readFile(join(dir, META_FILE), 'utf-8')) as VersionJson
      const nodesRaw = await readFile(join(dir, NODES_FILE), 'utf-8').catch(() => '[]')
      const nodes = JSON.parse(nodesRaw) as unknown[]
      out.push({
        id: meta.id ?? e.name,
        dir,
        createdAt: meta.createdAt ?? 0,
        tag: meta.tag ?? null,
        commit: meta.commit ?? '',
        branch: meta.branch ?? null,
        appVersion: meta.appVersion ?? null,
        nodeCount: nodes.length,
        dirty: Boolean(meta.dirty),
        restoredAt: meta.restoredAt ?? null
      })
    } catch {
      /* 损坏的备份目录直接跳过，不阻塞列表 */
    }
  }

  return out.sort((a, b) => b.createdAt - a.createdAt)
}

export async function readBackupDetail(root: string, id: string): Promise<BackupDetail | null> {
  const paths = resolveComfyPaths(root)
  const dir = join(paths.backupsDir, id)

  try {
    const meta = JSON.parse(await readFile(join(dir, META_FILE), 'utf-8')) as VersionJson
    const nodes = JSON.parse(
      await readFile(join(dir, NODES_FILE), 'utf-8').catch(() => '[]')
    ) as BackupNodeEntry[]

    const files = await listFiles(dir)

    return {
      snapshot: {
        id: meta.id,
        dir,
        createdAt: meta.createdAt,
        tag: meta.tag,
        commit: meta.commit,
        branch: meta.branch,
        appVersion: meta.appVersion,
        nodeCount: nodes.length,
        dirty: meta.dirty,
        restoredAt: meta.restoredAt
      },
      remote: meta.remote,
      dirty: meta.dirty,
      hasUserConfig: await pathExists(join(dir, 'user')),
      hasExtraModelPaths: await pathExists(join(dir, 'extra_model_paths.yaml')),
      nodes,
      files,
      error: null
    }
  } catch (err) {
    return {
      snapshot: {
        id,
        dir,
        createdAt: 0,
        tag: null,
        commit: '',
        branch: null,
        appVersion: null,
        nodeCount: 0,
        dirty: false,
        restoredAt: null
      },
      remote: null,
      dirty: false,
      hasUserConfig: false,
      hasExtraModelPaths: false,
      nodes: [],
      files: [],
      error: `读取备份失败：${err instanceof Error ? err.message : String(err)}`
    }
  }
}

async function listFiles(dir: string, base = dir): Promise<{ relative: string; size: number }[]> {
  const out: { relative: string; size: number }[] = []
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      out.push(...(await listFiles(full, base)))
    } else if (e.isFile()) {
      try {
        const st = await stat(full)
        out.push({ relative: relative(base, full).replace(/\\/g, '/'), size: st.size })
      } catch {
        /* 忽略不可读文件 */
      }
    }
  }
  return out
}

/**
 * 还原一个备份。
 *
 * 语义说明（重要）：
 *  - 代码版本：精确还原到备份时的 commit（detached HEAD）
 *  - 用户配置：覆盖还原
 *  - 插件：只比对清单，**不自动重装**。备份里存在而当前缺失的插件会列出来，
 *    由用户在插件页决定是否重装。
 */
export async function restoreBackup(
  root: string,
  id: string,
  onLine?: (stream: LogStream, text: string) => void
): Promise<RestoreResult> {
  const paths = resolveComfyPaths(root)
  const dir = join(paths.backupsDir, id)

  const meta = JSON.parse(await readFile(join(dir, META_FILE), 'utf-8')) as VersionJson
  const nodes = JSON.parse(
    await readFile(join(dir, NODES_FILE), 'utf-8').catch(() => '[]')
  ) as BackupNodeEntry[]

  const log = (t: string): void => onLine?.('system', t)

  const fromCommit = await gitSoft(paths.comfyDir, ['rev-parse', 'HEAD'])

  log(`[还原] 目标版本：${meta.tag ?? meta.commit.slice(0, 8)}（备份于 ${new Date(meta.createdAt).toLocaleString()}）`)

  const targetRef = meta.tag ?? meta.commit
  await git(paths.comfyDir, ['checkout', '--force', targetRef], { onLine })
  const toCommit = (await git(paths.comfyDir, ['rev-parse', 'HEAD'])).trim()
  log(`[还原] 代码已切换到 ${meta.tag ?? toCommit.slice(0, 8)}`)

  // 用户配置还原（存在才覆盖）
  let userConfigRestored = false
  const backupUser = join(dir, 'user')
  if (await pathExists(backupUser)) {
    await rm(paths.userDir, { recursive: true, force: true })
    await mkdir(paths.userDir, { recursive: true })
    await cp(backupUser, paths.userDir, { recursive: true })
    userConfigRestored = true
    log('[还原] user 配置已还原')
  }

  const backupYaml = join(dir, 'extra_model_paths.yaml')
  if (await pathExists(backupYaml)) {
    await cp(backupYaml, paths.extraModelPaths)
    log('[还原] extra_model_paths.yaml 已还原')
  }

  // 插件清单比对（不自动重装）
  const current = await snapshotNodes(paths.customNodesDir)
  const currentNames = new Set(current.map((n) => n.baseName))
  const backupNames = new Set(nodes.map((n) => n.baseName))
  const missingNodes = nodes.filter((n) => !currentNames.has(n.baseName)).map((n) => n.baseName)
  const extraNodes = current.filter((n) => !backupNames.has(n.baseName)).map((n) => n.baseName)

  if (missingNodes.length > 0) {
    log(`[还原] 注意：备份中有 ${missingNodes.length} 个插件当前不存在（不会自动重装）：${missingNodes.join('、')}`)
  }

  // 标记已还原
  meta.restoredAt = Date.now()
  await writeJson(join(dir, META_FILE), meta)

  return {
    snapshotId: id,
    fromCommit,
    toCommit,
    userConfigRestored,
    missingNodes,
    extraNodes
  }
}

export async function deleteBackup(root: string, id: string): Promise<void> {
  const paths = resolveComfyPaths(root)
  const dir = join(paths.backupsDir, id)
  // 防御：只允许删除 backups 目录直属子目录
  if (!dir.startsWith(paths.backupsDir)) throw new Error('非法备份路径')
  await rm(dir, { recursive: true, force: true })
}
