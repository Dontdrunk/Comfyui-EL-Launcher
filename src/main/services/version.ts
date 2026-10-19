import type {
  BackupSnapshot,
  HeadInfo,
  LogStream,
  CommitInfo,
  RefKind,
  RequirementsDiff,
  SwitchPlan,
  SwitchResult,
  VersionRef,
  VersionState
} from '@shared/types'
import { buildChildEnv } from '../lib/childEnv'
import { run } from '../lib/exec'
import { pipInstall } from '../lib/pip'
import { resolveComfyPaths } from '../lib/paths'
import { createBackup } from './backup'
import { readAppVersion } from './env'
import { git, gitSoft } from './git'
import { parseRequirements, toRequirementEntries } from './nodeScan'
import { compareSemverDesc, parseSemver } from './semver.mjs'
import { serviceManager } from './service'

export { compareSemverDesc, parseSemver }

/* ══════════════════════════════════════════════════════════
 * 版本管理
 *
 * 为什么不用官方 update/update.py：
 *   它只能「更新到最新」或「更新到最新稳定 tag」，无法切到任意历史版本，
 *   而回滚恰恰是版本管理最核心的价值。
 *
 * 为什么用定向浅取（--depth=1）而不是 fetch --tags：
 *   便携版 ComfyUI 是浅克隆（实测 .git 仅 35MB / 150 个 commit），
 *   远端有 204 个 tag。全量 fetch 代价高；定向浅取实测 2.1 秒 / 0.6MB。
 * ══════════════════════════════════════════════════════════ */

/* ── 当前版本状态 ── */

export async function getVersionState(root: string): Promise<VersionState> {
  const paths = resolveComfyPaths(root)

  const inside = await gitSoft(paths.comfyDir, ['rev-parse', '--is-inside-work-tree'])
  if (inside !== 'true') {
    return {
      isRepo: false,
      head: null,
      clean: true,
      dirtyCount: 0,
      stashedCount: 0,
      remote: null,
      refs: [],
      release: null,
      error: 'ComfyUI 目录不是 git 仓库（缺少 .git），版本管理不可用。'
    }
  }

  try {
    const [commit, shortCommit, branch, tag, logLine, porcelain, stashList, remote, tagRefs, branchRefs] =
      await Promise.all([
        git(paths.comfyDir, ['rev-parse', 'HEAD']),
        git(paths.comfyDir, ['rev-parse', '--short', 'HEAD']),
        gitSoft(paths.comfyDir, ['symbolic-ref', '--short', '-q', 'HEAD']),
        gitSoft(paths.comfyDir, ['describe', '--tags', '--exact-match', 'HEAD']),
        gitSoft(paths.comfyDir, ['log', '-1', '--format=%cI%n%s']),
        gitSoft(paths.comfyDir, ['status', '--porcelain']),
        gitSoft(paths.comfyDir, ['stash', 'list']),
        gitSoft(paths.comfyDir, ['remote', 'get-url', 'origin']),
        gitSoft(paths.comfyDir, [
          'for-each-ref',
          // 轻量 tag 没有 tag 对象，%(contents:subject) 取到的是它指向提交的首行
          '--format=%(refname:short)|%(objectname)|%(creatordate:iso-strict)|%(contents:subject)',
          'refs/tags'
        ]),
        gitSoft(paths.comfyDir, [
          'for-each-ref',
          '--format=%(refname:short)|%(objectname)|%(creatordate:iso-strict)',
          'refs/heads'
        ])
      ])

    const [date, subject] = (logLine ?? '').split('\n')
    const appVersion = await readAppVersion(paths.versionFile)

    const head: HeadInfo = {
      commit,
      shortCommit,
      tag: tag ?? null,
      branch: branch ?? null,
      detached: !branch,
      date: date ?? null,
      subject: subject ?? null,
      appVersion
    }

    const dirtyLines = (porcelain ?? '').split(/\r?\n/).filter((l) => l.trim().length > 0)
    const stashCount = (stashList ?? '').split(/\r?\n/).filter((l) => l.trim().length > 0).length

    /* 本地 tag */
    const localTags: VersionRef[] = (tagRefs ?? '')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        // subject 是最后一个字段，本身可能含 |，所以要把它后面的一起接回来
        const [name, obj, created, ...rest] = line.split('|')
        const subject = rest.join('|').trim()
        return {
          name,
          kind: 'tag' as RefKind,
          commit: obj ?? '',
          shortCommit: (obj ?? '').slice(0, 8),
          date: created ?? null,
          subject: subject || null,
          isCurrent: Boolean(tag && tag === name),
          fetched: true
        }
      })
      .sort((a, b) => compareSemverDesc(a.name, b.name))

    /* 本地分支（含官方 update.py 留下的 backup_branch_*） */
    const localBranches: VersionRef[] = (branchRefs ?? '')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [name, obj, created] = line.split('|')
        const isBackup = name.startsWith('backup_branch_')
        return {
          name,
          kind: (isBackup ? 'backup-branch' : 'branch') as RefKind,
          commit: obj ?? '',
          shortCommit: (obj ?? '').slice(0, 8),
          date: created ?? null,
          subject: isBackup ? '官方更新脚本自动创建的回滚点' : null,
          isCurrent: Boolean(branch && branch === name),
          fetched: true
        }
      })
      .sort((a, b) => b.name.localeCompare(a.name))

    /*
     * 与最新发版的谱系关系。
     *
     * 判「是否最新」不能看 comfyui_version.py：发行线以外的提交（PR 分支、浅取碎片）
     * 会停在旧值 —— 实测 1d7c66608 比 v0.41.2 还晚 5 小时，文件里却写着 0.41.0。
     * 两次 git 调用就够：--left-right --count 给出双向差集，describe --contains 给出
     * 「这个提交将来随哪个发版发布」（不属于任何 tag 时失败 → 不在发版线上）。
     */
    const newestTag = localTags.find((t) => parseSemver(t.name))?.name ?? null
    const release = newestTag
      ? await (async () => {
          const [lr, ship] = await Promise.all([
            gitSoft(paths.comfyDir, ['rev-list', '--left-right', '--count', `${newestTag}...HEAD`]),
            gitSoft(paths.comfyDir, ['describe', '--tags', '--contains', 'HEAD'])
          ])
          const [behind, ahead] = (lr ?? '').split(/\s+/).map((n) => Number(n))
          return {
            newestTag,
            ahead: Number.isFinite(ahead) ? ahead : 0,
            behind: Number.isFinite(behind) ? behind : 0,
            willShipIn: ship && parseSemver(ship) ? ship : null
          }
        })()
      : null

    return {
      isRepo: true,
      head,
      clean: dirtyLines.length === 0,
      dirtyCount: dirtyLines.length,
      stashedCount: stashCount,
      remote: remote ?? null,
      refs: [...localBranches, ...localTags],
      release,
      error: null
    }
  } catch (err) {
    return {
      isRepo: true,
      head: null,
      clean: true,
      dirtyCount: 0,
      stashedCount: 0,
      remote: null,
      refs: [],
      release: null,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/* ── 远端 tag 列表（不下载对象，仅列引用） ── */

export async function listRemoteTags(root: string): Promise<{ name: string; commit: string }[]> {
  const paths = resolveComfyPaths(root)

  const r = await run('git', ['ls-remote', '--tags', '--refs', 'origin'], {
    cwd: paths.comfyDir,
    env: buildChildEnv(),
    timeoutMs: 120_000
  })

  if (r.spawnError) throw new Error(`无法执行 git：${r.spawnError}`)
  if (r.code !== 0) {
    const detail = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join('\n')
    throw new Error(`获取远端版本列表失败（退出码 ${r.code}）${detail ? `\n${detail}` : ''}`)
  }

  const out: { name: string; commit: string }[] = []
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{7,40})\s+refs\/tags\/(.+)$/)
    if (!m) continue
    out.push({ commit: m[1], name: m[2] })
  }
  return out.sort((a, b) => compareSemverDesc(a.name, b.name))
}

/* ── 定向浅取 ── */

export interface FetchResult {
  ref: string
  seconds: number
}

/**
 * 本地提交历史，供版本列表直接展示。
 *
 * 起点是所有 ref（--all），不做发行线筛选：若这里只看 HEAD + tag，
 * 「全部提交」就和「发版版本」几乎一样了 —— 本机上百个 refs/remotes/origin/* 分支尖端上
 * 正在进行的提交（merge / spike / CI）会一条都看不到。
 * 刷新会补齐 origin/master 的完整历史；其余条目来自本地可见 refs。
 * 代价是列表里会混进版本号比当前更低的提交；这种回退风险不在这里提前筛掉，
 * 而是在点「切换使用」时由 planSwitch 提醒（见下方）。
 */
export async function listCommits(root: string): Promise<CommitInfo[]> {
  const paths = resolveComfyPaths(root)
  const out = await gitSoft(paths.comfyDir, [
    'log',
    '--all',
    '--no-decorate',
    '--format=%H|%h|%cI|%s'
  ])

  return (out ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      // subject 是最后一个字段，本身可能含 |，所以把它后面的一起接回来
      const [sha, shortSha, date, ...rest] = line.split('|')
      return {
        sha: sha ?? '',
        shortSha: shortSha ?? '',
        date: date || null,
        subject: rest.join('|').trim()
      }
    })
    .filter((c) => c.sha.length > 0)
}

export async function fetchTag(
  root: string,
  tag: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<FetchResult> {
  const paths = resolveComfyPaths(root)
  const started = Date.now()
  onLine?.('system', `[版本] 正在下载 ${tag}（浅取，仅该版本的代码快照）…`)
  await git(paths.comfyDir, ['fetch', '--depth=1', 'origin', `refs/tags/${tag}:refs/tags/${tag}`], {
    onLine,
    signal,
    timeoutMs: 600_000
  })
  const seconds = (Date.now() - started) / 1000
  onLine?.('system', `[版本] ${tag} 下载完成（${seconds.toFixed(1)} 秒）`)
  return { ref: tag, seconds }
}

/**
 * 把「远端有、本地没有」的 tag 取回本地。
 * 只取缺的那些：官方便携版自带全部历史 tag，正常一次刷新就是 1~2 个。
 * master 不在这里取，见 fetchRemote。
 */
export async function fetchRemoteTags(
  root: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal,
  timeoutMs = 600_000
): Promise<string[]> {
  const paths = resolveComfyPaths(root)
  const remote = await listRemoteTags(root)
  const localOut = await gitSoft(paths.comfyDir, ['tag', '--list'])
  const local = new Set((localOut ?? '').split(/\r?\n/).filter(Boolean))
  const missing = remote.filter((t) => !local.has(t.name)).map((t) => t.name)

  if (missing.length === 0) {
    onLine?.('system', '[版本] 远端没有新的版本 tag。')
    return []
  }

  const started = Date.now()
  onLine?.('system', `[版本] 正在下载 ${missing.length} 个新版本 tag（浅取）：${missing.join('、')}`)
  // 合成一条命令只建一次连接；这些都是本地没有的 ref，不会再有 non-fast-forward
  await git(
    paths.comfyDir,
    ['fetch', '--depth=1', 'origin', ...missing.map((t) => `refs/tags/${t}:refs/tags/${t}`)],
    { onLine, signal, timeoutMs }
  )
  onLine?.(
    'system',
    `[版本] ${missing.length} 个新版本 tag 下载完成（${((Date.now() - started) / 1000).toFixed(1)} 秒）`
  )
  return missing
}

/** 定向取 master。切换分支只取尖端；刷新时补齐 master 全部历史。 */
export async function fetchMaster(
  root: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal,
  depth: number | 'all' = 1,
  timeoutMs = 120_000
): Promise<FetchResult> {
  const paths = resolveComfyPaths(root)
  const started = Date.now()
  onLine?.(
    'system',
    depth === 'all'
      ? '[版本] 正在下载 master 全部提交历史…'
      : depth > 1
        ? `[版本] 正在下载 master 最近 ${depth} 条提交…`
        : '[版本] 正在下载 master 最新代码（浅取）…'
  )
  // 加 + 强制更新：浅克隆里 origin/master 是深度 1 的碎片，新的 master 尖端与它没有
  // 父子关系，不加 + 会被判 non-fast-forward 直接失败（刷新因此曾经每次都报联网失败）。
  const fetchDepth =
    depth === 'all'
      ? (await git(paths.comfyDir, ['rev-parse', '--is-shallow-repository'])) === 'true'
        ? ['--unshallow']
        : []
      : [`--depth=${depth}`]
  await git(paths.comfyDir, ['fetch', ...fetchDepth, 'origin', '+master:refs/remotes/origin/master'], {
    onLine,
    signal,
    timeoutMs
  })
  const seconds = (Date.now() - started) / 1000
  const tip = await gitSoft(paths.comfyDir, ['rev-parse', '--short', 'refs/remotes/origin/master'])
  onLine?.('system', `[版本] master 已更新到 ${tip ?? '未知'}（${seconds.toFixed(1)} 秒）`)
  return { ref: 'master', seconds }
}

/**
 * 刷新按钮的联网步骤。
 *
 * 发版 tag 和 master 各取各的：tag 决定「发版版本」和「是否最新」；
 * master 补齐完整提交历史，供「全部提交」展示。两边互不影响，一边失败另一边的结果留着。
 */
export async function fetchRemote(
  root: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal,
  timeoutMs = 600_000
): Promise<void> {
  const errors: string[] = []
  try {
    await fetchRemoteTags(root, onLine, signal, timeoutMs)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  }
  try {
    await fetchMaster(root, onLine, signal, 'all', timeoutMs)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  }
  if (errors.length > 0) throw new Error(errors.join('；'))
}

/* ── requirements 差异 ── */

/** 读取某个 ref 的 requirements.txt；该对象不存在时返回 null */
export async function requirementsAt(root: string, ref: string): Promise<string[] | null> {
  const paths = resolveComfyPaths(root)
  const content = await gitSoft(paths.comfyDir, ['show', `${ref}:requirements.txt`])
  if (content === null) return null
  return parseRequirements(content)
}

export function diffRequirements(from: string[] | null, to: string[] | null): RequirementsDiff {
  const mapOf = (lines: string[] | null): Map<string, string> => {
    const m = new Map<string, string>()
    for (const e of toRequirementEntries(lines ?? [])) m.set(e.name, e.raw)
    return m
  }
  const a = mapOf(from)
  const b = mapOf(to)

  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  let same = 0

  for (const [name, raw] of b) {
    if (!a.has(name)) added.push(raw)
    else if (a.get(name) !== raw) changed.push(`${a.get(name)} → ${raw}`)
    else same++
  }
  for (const [name, raw] of a) {
    if (!b.has(name)) removed.push(raw)
  }

  return { from: from ? 'requirements.txt' : null, to: to ? 'requirements.txt' : null, added, removed, changed, same }
}

/* ── 切换预检 ── */

async function refExists(root: string, ref: string): Promise<boolean> {
  const paths = resolveComfyPaths(root)
  const out = await gitSoft(paths.comfyDir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  return Boolean(out)
}

export async function planSwitch(
  root: string,
  target: string,
  refKind: RefKind
): Promise<SwitchPlan> {
  const paths = resolveComfyPaths(root)
  const blockers: string[] = []
  const warnings: string[] = []

  const serviceState = serviceManager.status()
  if (serviceState.state === 'running' || serviceState.state === 'launching') {
    blockers.push('ComfyUI 正在运行，请先停止后再切换版本。')
  }

  const state = await getVersionState(root)
  if (!state.isRepo) {
    return {
      target,
      refKind,
      currentRef: null,
      currentCommit: null,
      targetCommit: null,
      fetched: false,
      willStash: false,
      dirtyCount: 0,
      willBackup: false,
      requirementsDiff: null,
      commitCount: null,
      aheadCount: null,
      blockers: [...blockers, '当前不是 git 仓库'],
      warnings
    }
  }

  if (!state.clean) {
    warnings.push(
      `工作区有 ${state.dirtyCount} 处未提交改动，切换前会自动 stash 保存（不会丢失，可用 git stash pop 取回）。`
    )
  }

  /*
   * 回退提醒：只有「这个提交将来会在哪个发版里发布」低于当前版本，才是真的退版。
   * 不能用 comfyui_version.py 的版本号判方向 —— 发行线以外的提交（PR 分支、浅取碎片）
   * 会停在旧值：实测 1d7c66608 的提交时间比 v0.41.2 还晚 5 小时，版本号却是 0.41.0。
   * git describe --contains 找的是「第一个包含该提交的 tag」，也就是它会随哪个版本发布；
   * 不属于任何 tag 的提交（分支中间状态）describe 会失败，这种情况不提醒。
   */
  const current = state.head?.appVersion ?? null
  const releaseTag = await gitSoft(paths.comfyDir, ['describe', '--tags', '--contains', target])
  const targetRelease = releaseTag?.match(/^v?\d+\.\d+(?:\.\d+)?/)?.[0] ?? null
  if (current && targetRelease && compareSemverDesc(targetRelease, `v${current}`) > 0) {
    warnings.push(
      `目标提交属于 ${targetRelease}，比当前 ${current} 旧：切换后是回退到旧版本。`
    )
  }

  const fetched = await refExists(root, target)
  let targetCommit: string | null = null
  let requirementsDiff: RequirementsDiff | null = null
  let commitCount: number | null = null
  let aheadCount: number | null = null

  if (fetched) {
    targetCommit = await gitSoft(paths.comfyDir, ['rev-parse', '--short', target])
    const [fromReq, toReq] = await Promise.all([
      requirementsAt(root, 'HEAD'),
      requirementsAt(root, target)
    ])
    if (fromReq && toReq) {
      requirementsDiff = diffRequirements(fromReq, toReq)
      if (
        requirementsDiff.added.length + requirementsDiff.removed.length + requirementsDiff.changed.length >
        0
      ) {
        warnings.push(
          `依赖清单有差异：新增 ${requirementsDiff.added.length}、移除 ${requirementsDiff.removed.length}、变更 ${requirementsDiff.changed.length}。切换后会自动同步依赖。`
        )
      }
    }
    const [count, ahead] = await Promise.all([
      gitSoft(paths.comfyDir, ['rev-list', '--count', `HEAD..${target}`]),
      // 目标里没有、当前提交里有的：分叉时这些改动不再属于切换后的版本
      gitSoft(paths.comfyDir, ['rev-list', '--count', `${target}..HEAD`])
    ])
    commitCount = count ? Number(count) : null
    aheadCount = ahead ? Number(ahead) : null
    if (aheadCount && aheadCount > 0) {
      warnings.push(
        `当前提交有 ${aheadCount} 个提交不在目标里（分叉）：切过去这些改动不在此版本中，随时可以切回来。`
      )
    }
  } else {
    warnings.push('该版本尚未在本地，切换时会先联网下载（浅取，通常几秒）。')
  }

  return {
    target,
    refKind,
    currentRef: state.head?.tag ?? state.head?.shortCommit ?? null,
    currentCommit: state.head?.commit ?? null,
    targetCommit,
    fetched,
    willStash: !state.clean,
    dirtyCount: state.dirtyCount,
    willBackup: true,
    requirementsDiff,
    commitCount,
    aheadCount,
    blockers,
    warnings
  }
}

/* ── 执行切换 ── */

export interface SwitchOptions {
  /** 切换前是否创建备份，默认 true */
  backup?: boolean
}

export async function switchVersion(
  root: string,
  target: string,
  refKind: RefKind,
  opts: SwitchOptions,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<SwitchResult> {
  const paths = resolveComfyPaths(root)
  const log = (t: string): void => onLine?.('system', t)

  /* 0. 硬性前置：服务必须停止 */
  const st = serviceManager.status()
  if (st.state === 'running' || st.state === 'launching') {
    throw new Error('ComfyUI 正在运行，请先停止后再切换版本。')
  }

  const before = await getVersionState(root)
  if (!before.isRepo || !before.head) throw new Error('当前不是有效的 git 仓库，无法切换版本。')

  const fromCommit = before.head.commit
  const fromRef = before.head.tag ?? before.head.shortCommit

  /* 1. 备份 */
  let backupId: string | null = null
  if (opts.backup !== false) {
    log('[版本] 正在创建切换前备份…')
    const snapshot: BackupSnapshot = await createBackup(root, `switch-${target}`)
    backupId = snapshot.id
    log(`[版本] 备份完成：${snapshot.id}（记录 ${snapshot.nodeCount} 个插件）`)
  } else {
    log('[版本] 已跳过备份（用户选择）')
  }

  /* 2. 必要时浅取目标 */
  let fetched = false
  if (!(await refExists(root, target))) {
    if (refKind === 'tag') {
      await fetchTag(root, target, onLine, signal)
    } else if (refKind === 'commit') {
      // 列表里的提交都来自本地历史，正常不会走到这里
      throw new Error(`提交 ${target.slice(0, 8)} 不在本地历史中，无法切换。`)
    } else {
      await fetchMaster(root, onLine, signal)
    }
    fetched = true
  }

  /* 3. 需求差异在实际切换前算好（避免切换后无法对比） */
  const [fromReq, toReq] = await Promise.all([
    requirementsAt(root, 'HEAD'),
    requirementsAt(root, target)
  ])
  const requirementsDiff = fromReq && toReq ? diffRequirements(fromReq, toReq) : null

  /* 4. 变更摘要 */
  const stat = await gitSoft(paths.comfyDir, ['diff', '--shortstat', `HEAD..${target}`])
  const changeSummary = parseShortstat(stat)
  const commitLog = await gitSoft(paths.comfyDir, [
    'log',
    '--oneline',
    '--no-decorate',
    '-n',
    '200',
    `HEAD..${target}`
  ])
  const commits = (commitLog ?? '').split(/\r?\n/).filter(Boolean)

  /* 5. 脏工作区先 stash */
  let stashed = false
  if (!before.clean) {
    log(`[版本] 检测到 ${before.dirtyCount} 处未提交改动，正在 stash 保存…`)
    const msg = `explorer-launcher-before-${target}-${Date.now()}`
    await git(paths.comfyDir, ['stash', 'push', '--include-untracked', '-m', msg], { onLine, signal })
    stashed = true
    log(`[版本] 已保存为 stash：${msg}`)
  }

  /* 6. 切换 */
  log(`[版本] 正在切换到 ${target}…`)
  if (refKind === 'tag' || refKind === 'backup-branch' || refKind === 'commit') {
    await git(paths.comfyDir, ['checkout', '--force', target], { onLine, signal })
  } else {
    // 分支：优先本地同名分支，其次远端跟踪分支
    const hasLocal = await refExists(root, `refs/heads/${target}`)
    const refspec = hasLocal ? target : `refs/remotes/origin/${target}`
    if (!hasLocal) {
      const remoteExists = await refExists(root, refspec)
      if (!remoteExists) {
        await fetchMaster(root, onLine, signal)
      }
    }
    await git(paths.comfyDir, ['checkout', '--force', '-B', target, refspec], { onLine, signal })
  }

  const toCommit = await git(paths.comfyDir, ['rev-parse', 'HEAD'])
  const toTag = await gitSoft(paths.comfyDir, ['describe', '--tags', '--exact-match', 'HEAD'])
  const appVersion = await readAppVersion(paths.versionFile)
  log(
    `[版本] 切换完成：${target} → ${toCommit.slice(0, 8)}` +
      (appVersion ? `（ComfyUI ${appVersion}）` : '')
  )

  /*
   * 7. 同步依赖：不做成选项。
   * 上面已经算出了 requirements.txt 的差异，「有差异就装、没差异本来也无事可做」，
   * 再让用户勾一次只是把同一件事问两遍，勾错了还得多跑一趟手动同步。
   */
  if (!requirementsDiff) {
    log('[版本] 两侧缺少 requirements.txt，无法比对依赖；如有需要请手动执行「同步 Python 依赖」。')
  } else {
    const total =
      requirementsDiff.added.length + requirementsDiff.removed.length + requirementsDiff.changed.length
    if (total > 0) {
      log(`[版本] 依赖清单有 ${total} 处差异，自动同步 Python 依赖（pip install -r requirements.txt）…`)
      await syncRequirements(root, onLine, signal)
    } else {
      log(`[版本] 依赖清单无差异（${requirementsDiff.same} 项相同），跳过依赖同步。`)
    }
  }

  return {
    target,
    refKind,
    fromRef,
    fromCommit,
    toCommit,
    toTag,
    backupId,
    stashed,
    fetched,
    requirementsDiff,
    changeSummary,
    commits
  }
}

function parseShortstat(
  line: string | null
): { filesChanged: number; insertions: number; deletions: number } | null {
  if (!line) return null
  const files = line.match(/(\d+)\s+files? changed/)
  const ins = line.match(/(\d+)\s+insertions?\(\+\)/)
  const del = line.match(/(\d+)\s+deletions?\(-\)/)
  if (!files && !ins && !del) return null
  return {
    filesChanged: files ? Number(files[1]) : 0,
    insertions: ins ? Number(ins[1]) : 0,
    deletions: del ? Number(del[1]) : 0
  }
}

/* ── 同步依赖 ── */

export async function syncRequirements(
  root: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const paths = resolveComfyPaths(root)

  const r = await pipInstall(paths.pythonExe, paths.requirementsFile, {
    cwd: paths.root,
    onLine: (stream, text) => onLine?.(stream, text),
    timeoutMs: 1_800_000,
    signal
  })

  if (r.spawnError) throw new Error(`无法启动 pip：${r.spawnError}`)
  if (r.timedOut) throw new Error('pip 安装超时（30 分钟）')
  if (r.aborted) throw new Error('pip 安装已取消')
  if (r.code !== 0) {
    const tail = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-8).join('\n')
    throw new Error(`pip 安装失败（退出码 ${r.code}）\n${tail}`)
  }
  onLine?.('system', '[版本] Python 依赖同步完成。')
}

/* ── 官方更新脚本入口（保留官方完整更新通道） ── */

export function officialUpdaterCommand(root: string, stable: boolean): {
  cmd: string
  args: string[]
  cwd: string
  label: string
} {
  const paths = resolveComfyPaths(root)
  return {
    cmd: paths.pythonExe,
    args: [
      '-s',
      paths.updateScript,
      paths.comfyDir,
      ...(stable ? ['--stable'] : []),
      '--skip_self_update'
    ],
    cwd: paths.updateDir,
    label: stable ? '官方更新（稳定版）' : '官方更新（master）'
  }
}

