import { mkdir, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { shell } from 'electron'
import type {
  InstallResult,
  InstalledNode,
  LogStream,
  NodeDepsDetail,
  NodeDepsEntry,
  NodeDepsReport,
  NodeReleases,
  NodeUpdateInfo
} from '@shared/types'
import { buildChildEnv } from '../lib/childEnv'
import { run } from '../lib/exec'
import { pipInstall, pipInstallPackages } from '../lib/pip'
import { resolveComfyPaths } from '../lib/paths'
import { git, gitRaw, gitSoft } from './git'
import {
  DISABLED_SUFFIX,
  listNodeDirs,
  pathExists,
  readNodeGitInfo,
  readNodeManifest,
  readRequirements,
  requirementName,
  toRequirementEntries
} from './nodeScan'
import { getRegistryNode } from './registry'
import { serviceManager } from './service'

/* ══════════════════════════════════════════════════════════
 * 插件（custom_nodes）管理
 *
 * 设计前提（实测）：
 *  - 本机未安装 ComfyUI-Manager，custom_nodes 为空
 *  - 因此本模块自研：Registry API 取元数据 + git 取代码 + 内置 pip 装依赖，
 *    完全不依赖 ComfyUI 服务是否在运行。
 *  - 依赖装进 python_embeded 的全局 site-packages（便携版固有行为），
 *    卸载插件时不删依赖，避免误删多个插件共用的包。
 * ══════════════════════════════════════════════════════════ */

const CLONE_TIMEOUT_MS = 1_800_000
const PIP_TIMEOUT_MS = 1_800_000

function requireStopped(action: string): void {
  const st = serviceManager.status()
  if (st.state === 'running' || st.state === 'launching') {
    throw new Error(`ComfyUI 正在运行，请先停止后再${action}。`)
  }
}

/* ── 列表 ── */

export async function listInstalledNodes(root: string): Promise<InstalledNode[]> {
  const paths = resolveComfyPaths(root)
  const dirs = await listNodeDirs(paths.customNodesDir)

  const out: InstalledNode[] = []
  for (const d of dirs) {
    const [info, manifest, requirements] = await Promise.all([
      readNodeGitInfo(d.path),
      readNodeManifest(d.path),
      readRequirements(d.path)
    ])

    out.push({
      dirName: d.dirName,
      baseName: d.baseName,
      path: d.path,
      enabled: d.enabled,
      isGit: info.isGit,
      remote: info.remote,
      commit: info.commit,
      shortCommit: info.shortCommit,
      commitDate: info.commitDate,
      subject: info.subject,
      branch: info.branch,
      detached: info.detached,
      dirty: info.dirty,
      hasRequirements: requirements.length > 0,
      requirementsCount: requirements.length,
      displayName: manifest.displayName ?? d.baseName,
      registryId: manifest.registryId,
      version: manifest.version,
      description: manifest.description,
      missingDeps: [],
      hasUpdate: null,
      error: null
    })
  }
  return out
}

/* ── 远端更新检查 ── */

/** 长短 SHA 都算同一提交。比对失败不能当成「已是最新」。 */
function sameCommit(local: string, remote: string): boolean {
  const a = local.trim().toLowerCase()
  const b = remote.trim().toLowerCase()
  if (!a || !b) return false
  return a === b || a.startsWith(b) || b.startsWith(a)
}

/** 并发受限地检查每个插件的远端 HEAD 是否领先于本地 */
export async function checkNodeUpdates(root: string): Promise<NodeUpdateInfo[]> {
  const paths = resolveComfyPaths(root)
  const dirs = await listNodeDirs(paths.customNodesDir)

  const tasks = dirs.map(async (d): Promise<NodeUpdateInfo> => {
    const blank: NodeUpdateInfo = {
      dirName: d.dirName,
      hasUpdate: false,
      localCommit: null,
      remoteCommit: null,
      error: null
    }
    const remote = await gitSoft(d.path, ['remote', 'get-url', 'origin'])
    if (!remote) return blank

    const local = await gitSoft(d.path, ['rev-parse', 'HEAD'])
    const r = await gitRaw(d.path, ['ls-remote', 'origin', 'HEAD'], { timeoutMs: 30_000 })
    if (r.code !== 0) {
      return { ...blank, localCommit: local, error: '无法访问远端仓库' }
    }
    const m = r.stdout.match(/^([0-9a-f]{7,40})\s+HEAD/im)
    const remoteCommit = m ? m[1] : null
    if (!local || !remoteCommit) {
      return { ...blank, localCommit: local, remoteCommit, error: '读不到远端版本' }
    }
    return {
      dirName: d.dirName,
      hasUpdate: !sameCommit(local, remoteCommit),
      localCommit: local,
      remoteCommit,
      error: null
    }
  })

  return Promise.all(tasks)
}

/* ── 启用 / 禁用 ── */

export async function setNodeEnabled(
  root: string,
  dirName: string,
  enabled: boolean
): Promise<InstalledNode[]> {
  requireStopped('修改插件启用状态')
  const paths = resolveComfyPaths(root)

  const dirs = await listNodeDirs(paths.customNodesDir)
  const entry = dirs.find((d) => d.dirName === dirName)
  if (!entry) throw new Error(`找不到插件目录：${dirName}`)
  if (entry.enabled === enabled) return listInstalledNodes(root)

  const target = enabled
    ? entry.path
    : `${entry.path}${DISABLED_SUFFIX}`

  if (await pathExists(target)) {
    throw new Error(`目标路径已存在：${target}`)
  }

  await rename(entry.path, target)
  return listInstalledNodes(root)
}

/* ── 卸载（移入回收站，不做永久删除） ── */

export async function uninstallNode(
  root: string,
  dirName: string,
  onLine?: (s: LogStream, t: string) => void
): Promise<void> {
  requireStopped('卸载插件')
  const paths = resolveComfyPaths(root)
  const full = join(paths.customNodesDir, dirName)

  if (!(await pathExists(full))) throw new Error(`插件目录不存在：${dirName}`)

  const info = await readNodeGitInfo(full)
  onLine?.('system', `[插件] 正在卸载 ${dirName}（移入回收站，可恢复）`)
  if (info.remote) onLine?.('system', `[插件] 来源仓库：${info.remote}`)

  await shell.trashItem(full)
  onLine?.('system', `[插件] 已移入回收站：${dirName}`)
  onLine?.('system', '[插件] 注意：该插件安装过的 Python 依赖不会被自动删除（可能与其他插件共用）。')
}

/* ── 更新 ── */

export async function updateNode(
  root: string,
  dirName: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<void> {
  requireStopped('更新插件')
  const paths = resolveComfyPaths(root)
  const dir = join(paths.customNodesDir, dirName)

  if (!(await pathExists(join(dir, '.git')))) {
    throw new Error(`${dirName} 不是 git 仓库，无法更新。`)
  }

  const log = (t: string): void => onLine?.('system', t)

  const dirty = await gitSoft(dir, ['status', '--porcelain'])
  if (dirty) {
    log(`[插件] 检测到本地改动，先 stash 保存…`)
    await git(dir, ['stash', 'push', '--include-untracked', '-m', `explorer-launcher-node-update-${Date.now()}`], {
      onLine,
      signal
    })
  }

  const branch = await gitSoft(dir, ['symbolic-ref', '--short', '-q', 'HEAD'])

  if (branch) {
    log(`[插件] 更新 ${dirName}（分支 ${branch}）…`)
    await git(dir, ['pull', '--ff-only', '--depth=1'], { onLine, signal, timeoutMs: CLONE_TIMEOUT_MS })
  } else {
    // 游离 HEAD（安装时按 tag/commit 拉的）→ 直接对齐远端 HEAD
    log(`[插件] ${dirName} 处于游离 HEAD，改为对齐远端 HEAD…`)
    await git(dir, ['fetch', '--depth=1', 'origin'], { onLine, signal, timeoutMs: CLONE_TIMEOUT_MS })
    await git(dir, ['reset', '--hard', 'FETCH_HEAD'], { onLine, signal })
  }

  const head = await git(dir, ['rev-parse', '--short', 'HEAD'])
  log(`[插件] ${dirName} 已更新到 ${head}`)

  if (dirty) log('[插件] 本地改动已保存在 stash 中（git stash list 可查看）。')
}

export async function updateAllNodes(
  root: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<string[]> {
  const info = await checkNodeUpdates(root)
  const targets = info.filter((i) => i.hasUpdate).map((i) => i.dirName)
  if (targets.length === 0) {
    onLine?.('system', '[插件] 所有插件都已是最新。')
    return []
  }

  const updated: string[] = []
  for (const name of targets) {
    if (signal?.aborted) throw new Error('操作已取消')
    try {
      await updateNode(root, name, onLine, signal)
      updated.push(name)
    } catch (err) {
      onLine?.('stderr', `[插件] ${name} 更新失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return updated
}

/* ── 依赖 ── */

const DEPS_MARKER = '__XL_DEPS__'

const DEPS_SCRIPT = `
import json, sys
from importlib import metadata

def norm(n):
    return n.lower().replace('_', '-').replace('.', '-')

names = json.loads(sys.argv[1])
installed = set()
try:
    for dist in metadata.distributions():
        try:
            n = dist.metadata['Name']
        except Exception:
            n = None
        if n:
            installed.add(norm(n))
except Exception as e:
    print("${DEPS_MARKER}" + json.dumps({"error": str(e)}))
    raise SystemExit(0)

wanted = {norm(n) for n in names}
print("${DEPS_MARKER}" + json.dumps({
    "packageCount": len(installed),
    "missing": sorted(wanted - installed),
}))
`

/** 一次性批量检查所有插件依赖是否满足（单次 python 调用，避免 N 次启动开销） */
export async function checkNodeDeps(
  root: string,
  onLine?: (s: LogStream, t: string) => void
): Promise<NodeDepsReport> {
  const paths = resolveComfyPaths(root)
  const dirs = await listNodeDirs(paths.customNodesDir)

  const report: NodeDepsReport = {
    checkedAt: Date.now(),
    entries: [],
    totalMissing: 0,
    pythonPackageCount: 0,
    error: null
  }

  /* 收集所有 requirement 名 */
  const perNode: { dirName: string; displayName: string | null; enabled: boolean; reqs: string[]; names: string[] }[] = []
  const allNames = new Set<string>()

  for (const d of dirs) {
    const [reqs, manifest] = await Promise.all([readRequirements(d.path), readNodeManifest(d.path)])
    const names = reqs.map(requirementName)
    for (const n of names) allNames.add(n)
    perNode.push({
      dirName: d.dirName,
      displayName: manifest.displayName ?? d.baseName,
      enabled: d.enabled,
      reqs,
      names
    })
  }

  if (allNames.size === 0) {
    report.entries = perNode.map((n) => ({
      dirName: n.dirName,
      displayName: n.displayName,
      enabled: n.enabled,
      requirements: [],
      missing: [],
      satisfied: 0,
      error: null
    }))
    onLine?.('system', '[依赖] 没有插件声明 requirements.txt，无需检查。')
    return report
  }

  if (!(await pathExists(paths.pythonExe))) {
    report.error = `未找到内置解释器：${paths.pythonExe}`
    return report
  }

  onLine?.('system', `[依赖] 正在检查 ${allNames.size} 个依赖包…`)

  const r = await run(
    paths.pythonExe,
    ['-s', '-c', DEPS_SCRIPT, JSON.stringify([...allNames])],
    {
      cwd: paths.root,
      env: buildChildEnv(),
      timeoutMs: 180_000
    }
  )

  if (r.spawnError || r.code !== 0) {
    report.error = `依赖检查失败：${r.spawnError ?? (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join('\n')}`
    return report
  }

  const line = r.stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith(DEPS_MARKER))

  if (!line) {
    report.error = '依赖检查脚本没有返回结果。'
    return report
  }

  let missingSet = new Set<string>()
  let packageCount = 0
  try {
    const data = JSON.parse(line.slice(DEPS_MARKER.length)) as {
      packageCount?: number
      missing?: string[]
      error?: string
    }
    if (data.error) {
      report.error = `依赖检查出错：${data.error}`
      return report
    }
    packageCount = data.packageCount ?? 0
    missingSet = new Set(data.missing ?? [])
  } catch (err) {
    report.error = `依赖检查结果解析失败：${err instanceof Error ? err.message : String(err)}`
    return report
  }

  const entries: NodeDepsEntry[] = perNode.map((n) => {
    const missing = n.names.filter((name) => missingSet.has(name))
    return {
      dirName: n.dirName,
      displayName: n.displayName,
      enabled: n.enabled,
      requirements: n.reqs,
      missing,
      satisfied: n.names.length - missing.length,
      error: null
    }
  })

  report.entries = entries
  report.totalMissing = entries.reduce((sum, e) => sum + e.missing.length, 0)
  report.pythonPackageCount = packageCount

  onLine?.(
    'system',
    report.totalMissing === 0
      ? `[依赖] 全部满足（环境中共 ${packageCount} 个包）。`
      : `[依赖] 发现 ${report.totalMissing} 个缺失依赖。`
  )

  return report
}

/** 为单个插件安装 requirements.txt 中的依赖 */
export async function installNodeDeps(
  root: string,
  dirName: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const paths = resolveComfyPaths(root)
  const dir = join(paths.customNodesDir, dirName)
  const reqFile = join(dir, 'requirements.txt')

  if (!(await pathExists(reqFile))) {
    throw new Error(`${dirName} 没有 requirements.txt，无需安装依赖。`)
  }

  onLine?.('system', `[依赖] 开始为 ${dirName} 安装依赖…`)

  const r = await pipInstall(paths.pythonExe, reqFile, {
    cwd: paths.root,
    onLine: (stream, text) => onLine?.(stream, text),
    timeoutMs: PIP_TIMEOUT_MS,
    signal
  })

  if (r.spawnError) throw new Error(`无法启动 pip：${r.spawnError}`)
  if (r.timedOut) throw new Error('pip 安装超时（30 分钟）')
  if (r.aborted) throw new Error('pip 安装已取消')
  if (r.code !== 0) {
    const tail = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-10).join('\n')
    throw new Error(`pip 安装失败（退出码 ${r.code}）\n${tail}`)
  }

  onLine?.('system', `[依赖] ${dirName} 的依赖安装完成。`)
}

/* ── 安装 ── */

function deriveDirName(url: string): string {
  const clean = url.replace(/\.git$/, '').replace(/\/+$/, '')
  const name = basename(clean)
  return name || `node_${Date.now()}`
}

/**
 * 克隆仓库到 dest。
 *
 * 注意：cwd 必须传一个「已存在」的目录（custom_nodes），
 * 不能传 dest —— dest 此刻还不存在，spawn 会直接 ENOENT 失败。
 */
async function cloneInto(
  cwd: string,
  dest: string,
  url: string,
  onLine: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<void> {
  onLine('system', `[插件] git clone --depth=1 ${url}`)
  const r = await gitRaw(cwd, ['clone', '--depth=1', url, dest], {
    onLine,
    signal,
    timeoutMs: CLONE_TIMEOUT_MS
  })
  if (r.code === 0) return

  if (r.spawnError) onLine('stderr', `[插件] 无法启动 git：${r.spawnError}`)
  // 失败时清掉半成品，避免下次 clone 因目录非空而失败
  await rm(dest, { recursive: true, force: true }).catch(() => undefined)
  const tail = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-4).join('\n')
  onLine('stderr', `[插件] clone 失败（退出码 ${r.code}）：${tail}`)
  throw new Error('git clone 失败，请检查网络后重试。')
}

async function finishInstall(
  root: string,
  dirName: string,
  remote: string,
  source: InstallResult['source'],
  onLine: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<InstallResult> {
  const paths = resolveComfyPaths(root)
  const dest = join(paths.customNodesDir, dirName)

  const commit = await gitSoft(dest, ['rev-parse', 'HEAD'])
  const reqs = await readRequirements(dest)
  const warnings: string[] = []
  let requirementsTried = false
  let requirementsOk = true

  if (reqs.length > 0) {
    requirementsTried = true
    onLine('system', `[插件] 检测到 requirements.txt（${reqs.length} 项），开始安装依赖…`)
    try {
      await installNodeDeps(root, dirName, onLine, signal)
    } catch (err) {
      requirementsOk = false
      warnings.push(
        `依赖安装失败，插件代码已就位但可能无法加载：${err instanceof Error ? err.message : String(err)}`
      )
      onLine('stderr', `[插件] ${warnings[warnings.length - 1]}`)
    }
  } else {
    onLine('system', '[插件] 该插件没有 requirements.txt，跳过依赖安装。')
  }

  onLine('system', `[插件] 安装完成：${dirName}（${commit?.slice(0, 8) ?? '未知提交'}）`)
  onLine('system', '[插件] 需要重启 ComfyUI 后生效。')

  return {
    dirName,
    path: dest,
    source,
    remote,
    commit,
    requirementsTried,
    requirementsOk,
    warnings
  }
}

/** 从 GitHub（或任意 git 地址）安装 */
export async function installFromGit(
  root: string,
  url: string,
  dirNameOverride?: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<InstallResult> {
  requireStopped('安装插件')

  const paths = resolveComfyPaths(root)
  const log = (s: LogStream, t: string): void => onLine?.(s, t)

  if (!/^https?:\/\/|^git@/i.test(url.trim())) {
    throw new Error('请输入合法的 git 仓库地址（https://... 或 git@...）。')
  }

  await mkdir(paths.customNodesDir, { recursive: true })

  const dirName = (dirNameOverride?.trim() || deriveDirName(url)).replace(/[\\/:*?"<>|]/g, '_')
  const dest = join(paths.customNodesDir, dirName)

  if (await pathExists(dest)) {
    throw new Error(`目标目录已存在：${dirName}。请先卸载或改名后重试。`)
  }

  log('system', `[插件] 准备安装到 ${dest}`)
  await cloneInto(paths.customNodesDir, dest, url.trim(), log, signal)
  return finishInstall(root, dirName, url.trim(), 'git', log, signal)
}

/** 从 ComfyUI Registry 安装 */
export async function installFromRegistry(
  root: string,
  nodeId: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<InstallResult> {
  requireStopped('安装插件')

  const log = (s: LogStream, t: string): void => onLine?.(s, t)
  log('system', `[插件] 正在从 Registry 查询 ${nodeId} 的元数据…`)

  const node = await getRegistryNode(nodeId)
  if (!node) throw new Error(`在 Registry 中找不到插件：${nodeId}`)
  if (!node.repository) {
    throw new Error(
      `Registry 中 ${node.name} 没有登记代码仓库地址，无法自动安装。请到其 GitHub 页面手动安装。`
    )
  }

  log('system', `[插件] ${node.name} ${node.latestVersion ?? ''} · ${node.repository}`)
  if (node.dependencies.length > 0) {
    log('system', `[插件] Registry 声明依赖：${node.dependencies.join('、')}`)
  }

  const paths = resolveComfyPaths(root)
  await mkdir(paths.customNodesDir, { recursive: true })

  const dirName = deriveDirName(node.repository).replace(/[\\/:*?"<>|]/g, '_')
  const dest = join(paths.customNodesDir, dirName)

  if (await pathExists(dest)) {
    throw new Error(`目标目录已存在：${dirName}，说明该插件可能已安装。`)
  }

  await cloneInto(paths.customNodesDir, dest, node.repository, log, signal)
  const result = await finishInstall(root, dirName, node.repository, 'registry', log, signal)

  if (node.latestVersion && result.commit) {
    const head = await gitSoft(dest, ['rev-parse', '--short', 'HEAD'])
    log('system', `[插件] Registry 最新版本为 ${node.latestVersion}，当前检出的提交为 ${head}。`)
  }

  return result
}

/** 校验 npm 风格的包名（防止把异常字符串透传给 pip） */
export function isSafeNodeDirName(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,120}$/.test(name)
}

/* ══════════════════════════════════════════════════════════
 * 依赖查看 / 版本切换
 * ══════════════════════════════════════════════════════════ */

/** 一次 python 调用把所有已安装包名→版本捞出来（依赖面板用） */
const INSTALLED_VERSIONS_SCRIPT = `
import json
from importlib import metadata
out = {}
for dist in metadata.distributions():
    try:
        name = dist.metadata['Name']
        ver = dist.version
    except Exception:
        continue
    if name:
        out[name.lower().replace('_', '-').replace('.', '-')] = ver
print("${DEPS_MARKER}" + json.dumps(out))
`

/** 和 python 侧同样的规范化：小写、下划线与点都算连字符 */
function normPkg(name: string): string {
  return name.toLowerCase().replace(/_/g, '-').replace(/\./g, '-')
}

/** 从 "pillow>=11.0.0  # 注释" 里取出 ">=11.0.0" */
function specOf(raw: string): string {
  const noComment = raw.split('#')[0].trim()
  const rest = noComment.replace(/^[A-Za-z0-9._-]+\s*(\[[^\]]*\])?/, '').split(';')[0].trim()
  return rest
}

/** 单个插件的依赖明细：requirements.txt 声明 vs 实际装到的版本 */
export async function nodeDepsDetail(root: string, dirName: string): Promise<NodeDepsDetail> {
  const paths = resolveComfyPaths(root)
  const dir = join(paths.customNodesDir, dirName)
  const lines = await readRequirements(dir)
  const entries = toRequirementEntries(lines)

  const out: NodeDepsDetail = {
    dirName,
    hasRequirements: entries.length > 0,
    entries: [],
    error: null
  }
  if (entries.length === 0) return out

  if (!(await pathExists(paths.pythonExe))) {
    out.error = `未找到内置解释器：${paths.pythonExe}`
    return out
  }

  const r = await run(paths.pythonExe, ['-s', '-c', INSTALLED_VERSIONS_SCRIPT], {
    cwd: paths.root,
    env: buildChildEnv(),
    timeoutMs: 120_000
  })
  const line = (r.stdout ?? '').split(/\r?\n/).find((l) => l.startsWith(DEPS_MARKER))
  if (!line) {
    out.error = '读取已安装版本失败（内置解释器没有返回结果）。'
    return out
  }

  let installed: Record<string, string> = {}
  try {
    installed = JSON.parse(line.slice(DEPS_MARKER.length)) as Record<string, string>
  } catch {
    out.error = '读取已安装版本失败（返回内容无法解析）。'
    return out
  }

  out.entries = entries.map((e) => ({
    name: e.name,
    spec: specOf(e.raw),
    installed: installed[normPkg(e.name)] ?? null
  }))
  return out
}

/** 插件可切换的版本：本地分支/标签指向的提交（fetch=true 时先联网拉一次） */
export async function nodeReleases(
  root: string,
  dirName: string,
  fetch = false
): Promise<NodeReleases> {
  const paths = resolveComfyPaths(root)
  const dir = join(paths.customNodesDir, dirName)
  const out: NodeReleases = {
    dirName,
    remote: null,
    branch: null,
    branches: [],
    entries: [],
    error: null
  }

  if (!(await pathExists(join(dir, '.git')))) {
    out.error = `${dirName} 不是 git 仓库，没有可切换的版本。`
    return out
  }

  /*
   * 装插件用的是 git clone --depth=1，浅克隆只有一条提交 ——
   * 版本列表会假得只有一行。所以打开面板时自动补历史（用户不用点任何按钮）。
   */
  if (fetch) {
    await gitSoft(dir, ['fetch', '--all', '--tags', '--prune', '--quiet'], { timeoutMs: 300_000 })
  } else if (await pathExists(join(dir, '.git', 'shallow'))) {
    const un = await gitRaw(dir, ['fetch', '--unshallow', '--tags', '--quiet'], {
      timeoutMs: 300_000
    })
    // 仓库本来就不完整（比如只有某个分支的浅记录）时退回加深 100 条
    if (un.code !== 0) {
      await gitSoft(dir, ['fetch', '--depth=100', '--tags', '--quiet'], { timeoutMs: 300_000 })
    }
  }

  const [head, branch, remote, log, branchLines, defaultRef] = await Promise.all([
    gitSoft(dir, ['rev-parse', '--short', 'HEAD']),
    gitSoft(dir, ['symbolic-ref', '--short', '-q', 'HEAD']),
    gitSoft(dir, ['remote', 'get-url', 'origin']),
    gitSoft(dir, ['log', '--all', '-n', '80', '--date=iso-strict', '--pretty=format:%H|%h|%cI|%s']),
    gitSoft(dir, ['for-each-ref', '--format=%(refname:short)|%(HEAD)', 'refs/heads']),
    gitSoft(dir, ['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD'])
  ])

  const defaultBranch = (defaultRef ?? '').replace(/^origin\//, '')
  out.remote = remote ?? null
  out.branch = branch ?? null
  out.branches = (branchLines ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, marker] = line.split('|')
      return { name, current: marker === '*', isDefault: name === defaultBranch }
    })
  out.entries = (log ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sha, short, date, ...rest] = line.split('|')
      return {
        sha,
        short,
        date: date ?? null,
        subject: rest.join('|').trim(),
        current: Boolean(head && short === head)
      }
    })
  return out
}

/** 把插件切到某个提交 / 分支 / 标签；有未提交改动直接拒绝，不替用户丢东西 */
export async function checkoutNode(root: string, dirName: string, ref: string): Promise<void> {
  requireStopped('切换插件版本')
  const paths = resolveComfyPaths(root)
  const dir = join(paths.customNodesDir, dirName)

  if (!(await pathExists(join(dir, '.git')))) {
    throw new Error(`${dirName} 不是 git 仓库，无法切换版本。`)
  }
  // 只看已跟踪文件的改动：未跟踪的杂物（__pycache__、自己加的备注）不该挡住切换
  const dirty = (await gitSoft(dir, ['status', '--porcelain', '--untracked-files=no'])) ?? ''
  if (dirty.trim().length > 0) {
    throw new Error('该插件有未提交的本地改动，先在插件目录里提交或丢弃后再切换。')
  }
  /*
   * ref 可能是：本地分支名（切分支）、origin/xxx（建同名本地分支再切）、
   * 或提交/标签（游离 HEAD，看某个历史版本用）。
   */
  const locals =
    (await gitSoft(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']))?.split(
      /\r?\n/
    ).filter(Boolean) ?? []
  if (locals.includes(ref)) {
    await git(dir, ['checkout', '--force', ref])
  } else if (ref.startsWith('origin/')) {
    await git(dir, ['checkout', '--force', '-B', ref.slice('origin/'.length), ref])
  } else {
    await git(dir, ['checkout', '--force', ref])
  }
}

/** 装/重装单个依赖包（依赖浮层里每一行那个按钮） */
export async function installOneNodeDep(
  root: string,
  dirName: string,
  name: string,
  spec: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<void> {
  requireStopped('安装依赖')
  // 包名要进命令行参数：只允许 pip 认得的字符
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(name)) throw new Error(`非法的依赖包名：${name}`)

  const paths = resolveComfyPaths(root)
  if (!(await pathExists(join(paths.customNodesDir, dirName)))) {
    throw new Error(`插件目录不存在：${dirName}`)
  }
  if (!(await pathExists(paths.pythonExe))) {
    throw new Error(`未找到内置解释器：${paths.pythonExe}`)
  }

  const target = `${name}${spec}`
  onLine?.('system', `[依赖] 安装 ${target}…`)
  const r = await pipInstallPackages(paths.pythonExe, [target], {
    cwd: paths.root,
    onLine,
    signal
  })

  if (r.spawnError) throw new Error(`无法启动 pip：${r.spawnError}`)
  if (r.timedOut) throw new Error('pip 安装超时')
  if (r.aborted) throw new Error('pip 安装已取消')
  if (r.code !== 0) {
    const tail = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-6).join('\n')
    throw new Error(`安装 ${target} 失败（退出码 ${r.code}）\n${tail}`)
  }
}

/**
 * 逐个重装所有已启用插件的依赖（表头那个「重装所有插件依赖」）。
 * 串行跑：pip 同时装多个包会互相抢锁，也会把日志搅成一团。
 */
export async function reinstallAllNodeDeps(
  root: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<string[]> {
  requireStopped('重装插件依赖')
  const paths = resolveComfyPaths(root)
  const dirs = (await listNodeDirs(paths.customNodesDir)).filter((d) => d.enabled)

  const done: string[] = []
  for (const d of dirs) {
    if (!(await pathExists(join(d.path, 'requirements.txt')))) continue
    onLine?.('system', `[依赖] 重装 ${d.dirName} 的依赖…`)
    await installNodeDeps(root, d.dirName, onLine, signal)
    done.push(d.dirName)
  }
  if (done.length === 0) onLine?.('system', '[依赖] 没有已启用且带 requirements.txt 的插件。')
  return done
}
