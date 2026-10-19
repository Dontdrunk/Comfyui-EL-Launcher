import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BackupSnapshot,
  CommitInfo,
  GitAvailability,
  RefKind,
  SwitchPlan,
  SwitchResult,
  UpdateCheck,
  VersionState
} from '@shared/types'
import { ArrowRight, Check, Download, ExternalLink, Folder, RefreshCw, Shield, Trash2 } from 'lucide'
import { Icon } from '../components/Icon'
import {
  Empty,
  Led,
  Modal,
  Notice,
  Panel,
  Readout,
  Readouts,
  Segmented,
  Spinner,
  Switch,
  Tag
} from '../components/ui'
import { formatDateTime, formatRelative } from '../lib/format'
import { useApp } from '../store'

/* ══════════════════════════════════════════════════════════
 * 版本更新与管理
 *
 * 核心事实（决定了本页的实现方式）：
 *  1. 官方便携版是「浅克隆」，本地只有当前版本的 tag，远端有 204 个 tag。
 *     因此切换版本时必须定向浅取（实测 2.1 秒 / 0.6MB），而非全量 fetch。
 *  2. 官方 update.py 只能升到最新，无法回滚 —— 所以本页用 git 直管版本。
 * ══════════════════════════════════════════════════════════ */

interface Row {
  /** React key。提交与 tag 可能撞同一个 sha，所以带来源前缀 */
  key: string
  /** 「版本ID」列显示的内容：提交显示短 SHA，发版版本显示 tag 名 */
  id: string
  date: string | null
  subject: string
  /** 传给 openPlan 的引用：提交是 SHA，发版版本是 tag 名 */
  ref: string
  refKind: RefKind
  isCurrent: boolean
}

export default function Versions(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const jobs = useApp((s) => s.jobs)
  const service = useApp((s) => s.service)
  const setPage = useApp((s) => s.setPage)
  const refreshEnv = useApp((s) => s.refreshEnv)
  const probeRuntime = useApp((s) => s.probeRuntime)
  const pushToast = useApp((s) => s.pushToast)

  const [state, setState] = useState<VersionState | null>(null)
  const [git, setGit] = useState<GitAvailability | null>(null)
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [backups, setBackups] = useState<BackupSnapshot[]>([])
  const [backupsDir, setBackupsDir] = useState('')
  const [restoreTarget, setRestoreTarget] = useState<BackupSnapshot | null>(null)
  const [tab, setTab] = useState<'list' | 'backup' | 'log'>('list')
  const [listLoading, setListLoading] = useState(false)
  const [update, setUpdate] = useState<UpdateCheck | null>(null)
  const [updateLoading, setUpdateLoading] = useState(false)

  const [query, setQuery] = useState('')
  /** 版本列表范围筛选：默认只列发版版本（提交列表里混着 PR 分支尖端，翻起来没意义） */
  const [listFilter, setListFilter] = useState<'all' | 'release'>('release')
  const [busy, setBusy] = useState(false)

  /**
   * 切换弹窗。除服务端给的 SwitchPlan 外，额外挂两个纯展示字段：
   * label 是标题上的可读标识，subject 是目标提交的说明。
   * 挂在 plan 上而不是另开 state——plan 一清空，这两个自然跟着没了。
   */
  const [plan, setPlan] = useState<(SwitchPlan & PlanDisplay) | null>(null)
  const [optBackup, setOptBackup] = useState(true)

  const [planning, setPlanning] = useState<string | null>(null)

  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<SwitchResult | null>(null)
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)

  const running = service?.state === 'running' || service?.state === 'launching'
  const root = settings?.comfyRoot

  /* ── 数据加载 ── */

  /**
   * 刷新。
   *
   * online=true（点刷新按钮）：先联网把远端拉下来，再读，最后一次性提交到界面 ——
   *   整个过程界面保持原样，不会先显示旧数据再悄悄换掉。
   * online=false（首次进入）：只读本地，毫秒级出内容，不联网。
   *
   * 列表读的是本地 git 历史，所以联网这一步不能省，否则永远停在旧状态。
   */
  const refreshAll = useCallback(
    async (online: boolean): Promise<void> => {
      if (!root) return
      setBusy(true)
      setListLoading(true)
      setUpdateLoading(true)

      try {
        if (online) {
          const res = await window.launcher.fetchRemote(root)
          setFetchError(res.ok ? null : res.error)
        }

        const [v, g, c, b, d] = await Promise.all([
          window.launcher.getVersionState(root),
          window.launcher.gitCheck(),
          window.launcher.listCommits(root),
          window.launcher.listBackups(root),
          window.launcher.getBackupsDir(root)
        ])
        setState(v)
        setGit(g)
        setCommits(c)
        setBackups(b)
        setBackupsDir(d)
        setListError(null)

        setUpdate(await window.launcher.checkUpdate(root, online))
      } catch (err) {
        setListError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
        setListLoading(false)
        setUpdateLoading(false)
      }
    },
    [root]
  )

  useEffect(() => {
    void refreshAll(false)
  }, [refreshAll])

  /* 任务结束后自动刷新（用 ref 去重，避免重复触发） */
  const activeJob = useMemo(
    () => jobs.find((j) => j.id === activeJobId) ?? null,
    [jobs, activeJobId]
  )
  const handledRef = useRef<string | null>(null)

  useEffect(() => {
    if (!activeJob || activeJob.status === 'running') return
    if (handledRef.current === activeJob.id) return
    handledRef.current = activeJob.id
    if (activeJob.status === 'failed') setLastResult(null)

    // 版本切换会改掉 comfyui_version.py，必须重算环境，否则标题栏与总览页仍是旧版本号
    void refreshEnv()
    // 换版本后 torch/CUDA 可能变了，顺手重探一次运行时
    void probeRuntime()
    void refreshAll(false)
  }, [activeJob, refreshAll, refreshEnv, probeRuntime])

  /* ── 版本行 ── */

  /*
   * 发版版本直接列本地 tag，而不是在提交历史里筛。
   *
   * 提交列表只有 300 条（git log --all -n300），本地却有 200+ 个 tag，
   * 绝大多数 tag 指向的提交压根不在这个窗口里 —— 早先在窗口内筛 tag，
   * 200 多个版本只能筛出两三个。tag 才是权威口径，也和上面判定
   * 「最新版本」用的是同一份 state.refs，两处不会打架。
   */
  const releaseTags = useMemo(
    () => (state?.refs ?? []).filter((r) => r.kind === 'tag' && /^v\d+\.\d+/i.test(r.name)),
    [state]
  )

  const rows: Row[] = useMemo(() => {
    const head = state?.head?.commit ?? ''
    const q = query.trim().toLowerCase()
    const hit = (id: string, subject: string): boolean =>
      !q || id.toLowerCase().includes(q) || subject.toLowerCase().includes(q)

    /* 发版版本：一行一个 tag，切过去走 tag 通道（必要时浅取） */
    if (listFilter === 'release') {
      return releaseTags.filter((r) => hit(r.name, r.subject ?? '')).map((r) => ({
        key: `tag:${r.name}`,
        id: r.name,
        date: r.date,
        subject: r.subject ?? '（该 tag 未记录提交说明）',
        ref: r.name,
        refKind: 'tag' as RefKind,
        isCurrent: r.isCurrent
      }))
    }

    return commits.filter((c) => hit(c.shortSha, c.subject)).map((c) => ({
      key: `commit:${c.sha}`,
      id: c.shortSha,
      date: c.date,
      subject: c.subject,
      ref: c.sha,
      refKind: 'commit' as RefKind,
      isCurrent: head.length > 0 && c.sha === head
    }))
  }, [commits, state, query, listFilter, releaseTags])

  const listTotal = listFilter === 'release' ? releaseTags.length : commits.length
  const listUnit = listFilter === 'release' ? '个版本' : '个提交'

  /*
   * 是否最新只看 git 谱系（state.release），不看 comfyui_version.py ——
   * 发行线以外的提交里那个文件停在旧值：实测 1d7c66608 比 v0.41.2 还晚 5 小时，却写着 0.41.0。
   *
   *   current  就在最新 tag 上
   *   behind   落后：当前提交在某个发版的历史里，而那个发版比它新
   *   devAhead 开发版：不在任何 tag 上，但完全领先最新发版（未发版的更新代码）
   *   offline  不在发版线上：与最新发版分叉（各有对方没有的提交）
   */
  const rel = state?.release ?? null
  const newestTag = rel?.newestTag ?? null
  const verdict: 'current' | 'behind' | 'devAhead' | 'offline' =
    !rel || !newestTag
      ? 'current'
      : rel.willShipIn !== null
        ? rel.willShipIn === newestTag && rel.ahead === 0 && rel.behind === 0
          ? 'current'
          : 'behind'
        : rel.behind === 0
          ? 'devAhead'
          : 'offline'
  /** 只有真落后才催更新；开发版/分叉不催，按钮降级为「切到」（切走会丢当前线，得你自己决定） */
  const newerTag = verdict === 'behind' ? newestTag : null
  const currentVer = state?.head?.tag ?? (state?.head?.appVersion ? `v${state.head.appVersion}` : null)
  const count = (v: number | undefined): string => String(v ?? 0)
  const ledLabel =
    verdict === 'behind'
      ? `有新版本 ${newestTag}（落后 ${count(rel?.behind)} 个提交）`
      : verdict === 'devAhead'
        ? `开发版：领先 ${newestTag} ${count(rel?.ahead)} 个提交（未发版）`
        : verdict === 'offline'
          ? `不在发版线上（领先 ${newestTag} ${count(rel?.ahead)} / 落后 ${count(rel?.behind)}）`
          : `已是最新版本（${currentVer ?? '未知'}）`
  const ledTone: 'ok' | 'warn' | 'off' =
    verdict === 'behind' ? 'warn' : verdict === 'offline' ? 'off' : 'ok'
  const versionHint =
    verdict === 'behind'
      ? `落后 ${newestTag} ${count(rel?.behind)} 个提交`
      : verdict === 'devAhead'
        ? `未发版 · 领先 ${newestTag} ${count(rel?.ahead)} 个提交`
        : verdict === 'offline'
          ? `未发版 · 领先 ${count(rel?.ahead)} / 落后 ${count(rel?.behind)}`
          : state?.head?.tag
            ? `tag ${state.head.tag}`
            : '未发版'
  /**
   * 面板正在展示的那个版本：有更新时是最新 tag，否则就是当前所在的 tag。
   * 都不在时退回最新 tag（离线分叉状态下「更新日志」按钮仍能查最新发版的说明）。
   */
  const shownTag = newerTag ?? state?.head?.tag ?? newestTag ?? null
  /** 对应的 GitHub Release；没有就说明这个版本还没发布说明 */
  const releaseForShown = shownTag
    ? (update?.releases.find((r) => r.tag === shownTag) ?? null)
    : null
  /** 没有 Release 时退而求其次：直接去 GitHub 看这个版本的提交 */
  const repoUrl = (state?.remote ?? '').replace(/\.git$/, '')
  const commitsUrl = repoUrl && shownTag ? `${repoUrl}/commits/${shownTag}` : null
  /** 状态条下方的附加内容（错误提示 / 展开的更新日志）；没有时面板体必须收成 0 高 */
  const statusExtra = Boolean(update?.error || (showReleaseNotes && releaseForShown))

  /* ── 操作 ── */

  const openPlan = async (
    name: string,
    kind: RefKind,
    display?: PlanDisplay
  ): Promise<void> => {
    if (!root) return
    setPlanning(name)
    try {
      const p = await window.launcher.planSwitch(name, kind, root)
      setPlan({ ...p, ...display })
      setOptBackup(p.willBackup)
    } catch (err) {
      setLastResult(null)
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      setPlanning(null)
    }
  }

  const doSwitch = async (): Promise<void> => {
    if (!plan || !root) return
    const target = plan.target
    const kind = plan.refKind
    setPlan(null)
    setLastResult(null)
    handledRef.current = null

    const res = await window.launcher.switchVersion(
      target,
      kind,
      { backup: optBackup },
      root
    )
    setActiveJobId(res.jobId)
    if (res.ok) {
      setLastResult(res.value)
      setTab('log')
    } else {
      pushToast(`切换失败：${res.error}`, 'error')
    }
    handledRef.current = null
  }

  const doSyncDeps = async (): Promise<void> => {
    if (!root) return
    handledRef.current = null
    const res = await window.launcher.syncDependencies(root)
    if (!res.ok) pushToast(`依赖同步失败：${res.error}`, 'error')
    else pushToast('依赖同步完成')
    setActiveJobId(res.jobId)
  }

  /* ── 备份操作 ── */

  const doCreateBackup = async (): Promise<void> => {
    if (!root) return
    handledRef.current = null
    const res = await window.launcher.createBackup('manual', root)
    setActiveJobId(res.jobId)
    if (!res.ok) pushToast(`备份失败：${res.error}`, 'error')
    else pushToast('备份已创建')
  }

  const doRestore = async (): Promise<void> => {
    const target = restoreTarget
    if (!target || !root) return
    setRestoreTarget(null)
    handledRef.current = null
    const res = await window.launcher.restoreBackup(target.id, root)
    setActiveJobId(res.jobId)
    if (!res.ok) pushToast(`还原失败：${res.error}`, 'error')
    else pushToast(`已还原到 ${target.id}`)
  }

  const doDeleteBackup = async (b: BackupSnapshot): Promise<void> => {
    if (!root) return
    await window.launcher.deleteBackup(b.id, root)
    await refreshAll(false)
  }

  /* ── 渲染 ── */

  if (git && !git.ok) {
    return (
      <>
        <Panel title="前置条件未满足">
          <Notice tone="error" title="未检测到可用的 Git">
            {git.error}
            <br />
            版本切换与回滚依赖 Git，请先安装 Git for Windows 并确保 <code className="mono">git</code>{' '}
            在系统 PATH 中，然后重启本启动器。
          </Notice>
        </Panel>
      </>
    )
  }

  return (
    <>
      {/* ── 运行中告警：切换版本必须先停服 ── */}
      {running && (
        <Notice
          tone="warn"
          title="ComfyUI 正在运行"
          actions={
            <button type="button" className="btn btn--sm" onClick={() => setPage('dashboard')}>
              去停止
            </button>
          }
        >
          切换版本会改动 ComfyUI 代码目录，必须先停止服务。停止后才能执行切换与还原。
        </Notice>
      )}

      {state?.error && (
        <Notice tone="error" title="版本状态读取异常">
          {state.error}
        </Notice>
      )}

      {fetchError && (
        <Notice tone="warn" title="联网拉取失败，下面显示的是本地已有历史">
          {fetchError}
        </Notice>
      )}

      {/* ── 当前版本 ── */}
      <div className="section-title">当前版本</div>
      <Readouts cols={3}>
        <Readout
          label="ComfyUI 版本"
          value={state?.head?.appVersion ?? '—'}
          tone={verdict === 'behind' || verdict === 'offline' ? 'warn' : 'ok'}
          hint={versionHint}
        />
        <Readout
          label="提交"
          value={state?.head?.shortCommit ?? '—'}
          hint={state?.head?.date ? formatDateTime(state.head.date) : undefined}
          small
        />
        <Readout
          label="工作区"
          value={state ? (state.clean ? '干净' : `${state.dirtyCount} 处改动`) : '—'}
          tone={state ? (state.clean ? 'ok' : 'warn') : 'none'}
          hint={state && state.stashedCount > 0 ? `${state.stashedCount} 条 stash` : '无 stash'}
        />
      </Readouts>

      {/* ── 最新版本：内容直接进标题栏，不再多占一行面板体 ── */}
      {(update || updateLoading || state) && (
        <Panel
          // 没有附加内容时必须 flush：否则空的面板体留着 24px 内边距，变成一条空带
          flush={!statusExtra}
          title={<Led tone={ledTone} label={ledLabel} />}
          actions={
            <>
              {verdict === 'behind' && !running && newestTag && (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => void openPlan(newestTag, 'tag', { label: newestTag })}
                  disabled={planning !== null}
                >
                  {planning === newestTag ? <Spinner /> : <Icon icon={Download} size={13} />}
                  更新到 {newestTag}
                </button>
              )}
              {(verdict === 'devAhead' || verdict === 'offline') && !running && newestTag && (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => void openPlan(newestTag, 'tag', { label: newestTag })}
                  disabled={planning !== null}
                  title="回到发版线：会切到该发版，当前线上的提交不在此版本中"
                >
                  {planning === newestTag ? <Spinner /> : <Icon icon={Download} size={13} />}
                  切到 {newestTag}
                </button>
              )}
              {releaseForShown ? (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => setShowReleaseNotes((v) => !v)}
                  disabled={updateLoading}
                >
                  {updateLoading ? <Spinner /> : null}
                  {showReleaseNotes ? '收起' : '查看'}更新日志
                </button>
              ) : (
                // 该版本没有 Release，就别留一个点不动的灰按钮
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={!commitsUrl || updateLoading}
                  title={commitsUrl ? `在 GitHub 上查看 ${shownTag} 的提交` : undefined}
                  onClick={() => commitsUrl && void window.launcher.openExternal(commitsUrl)}
                >
                  {updateLoading ? <Spinner /> : <Icon icon={ExternalLink} size={13} />}
                  在 GitHub 上查看
                </button>
              )}
            </>
          }
        >
              {update?.error && (
                <Notice tone="info" title="提示">
                  {update.error}
                </Notice>
              )}

              {showReleaseNotes && releaseForShown && (
                <>
                  <div className="kv" style={{ marginBottom: 'var(--sp-2)' }}>
                    <span className="kv__k">发布时间</span>
                    <span className="kv__v">{formatDateTime(releaseForShown.publishedAt)}</span>
                  </div>
                  <div className="release-body">
                    {releaseForShown.body || '（该 Release 没有填写说明）'}
                  </div>
                </>
              )}
        </Panel>
      )}

      {/* ── 版本：列表 / 备份，同一个面板两个页签 ── */}
      <Panel
        flush
        fill
        title={
          <Segmented<'list' | 'backup' | 'log'>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'list', label: '版本列表' },
              { value: 'backup', label: `版本备份 ${backups.length}` },
              { value: 'log', label: '更新日志' }
            ]}
          />
        }
        actions={
          tab === 'list' ? (
            <>
              <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                {/* 只有首次加载（还没有数据）才显示加载文案，刷新时保持原内容不动 */}
                {listLoading && commits.length === 0
                  ? '正在读取本地历史…'
                  : rows.length === listTotal
                    ? `共 ${listTotal} ${listUnit}`
                    : `筛出 ${rows.length} / ${listTotal} ${listUnit}`}
              </span>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => void refreshAll(true)}
                disabled={busy}
                title="重新读取版本状态，并联网检查远端版本与更新"
              >
                {busy ? <Spinner /> : <Icon icon={RefreshCw} size={13} />}
                刷新
              </button>
            </>
          ) : tab === 'backup' ? (
            <>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!backupsDir}
                onClick={() => backupsDir && void window.launcher.openPath(backupsDir)}
              >
                <Icon icon={Folder} size={13} />
                打开目录
              </button>
              <button type="button" className="btn btn--sm" onClick={() => void doCreateBackup()}>
                <Icon icon={Shield} size={13} />
                立即备份
              </button>
            </>
          ) : null
        }
      >
        {tab === 'list' && (
          <>
        <div className="toolbar">
          <input
            className="input"
            style={{ maxWidth: 200, fontFamily: 'var(--font-ui)' }}
            placeholder="搜索版本号…"
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="select"
            value={listFilter}
            aria-label="提交范围"
            onChange={(e) => setListFilter(e.target.value === 'all' ? 'all' : 'release')}
          >
            <option value="release">发版版本</option>
            <option value="all">全部提交</option>
          </select>
          {rows.length !== commits.length && (
            <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
              筛出 {rows.length} 个
            </span>
          )}
        </div>

        {listError && (
          <div style={{ padding: 'var(--sp-3)' }}>
            <Notice tone="warn" title="读取本地提交历史失败">
              {listError}
            </Notice>
          </div>
        )}

        {rows.length === 0 ? (
          <Empty
            title={query ? '没有匹配的版本' : listFilter === 'release' ? '本地没有可读的发版版本' : '本地没有可读的提交历史'}
            hint={
              query
                ? '换个关键字，或把范围切回「全部提交」试试。'
                : listFilter === 'release'
                  ? '本地没有形如 vX.Y.Z 的 tag。浅克隆下 tag 需要先浅取到本地，才会出现在这里。'
                  : '列表来自本地 git 历史；浅克隆下能看到的范围由已经浅取过的版本决定。'
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>版本ID</th>
                  <th>更新内容</th>
                  <th style={{ width: 170 }}>更新时间</th>
                  <th style={{ width: 120 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={r.isCurrent ? 'version-row--current' : ''}>
                    <td className="mono">{r.id}</td>
                    <td className="ellipsis" style={{ maxWidth: 560 }} title={r.subject}>
                      {r.subject}
                    </td>
                    <td className="mono" style={{ fontSize: 'var(--fs-xs)' }}>
                      {r.date ? formatDateTime(r.date) : '—'}
                    </td>
                    <td>
                      <div className="table__actions">
                        {r.isCurrent ? (
                          <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                            当前版本
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--sm"
                            disabled={running || planning !== null}
                            onClick={() =>
                              void openPlan(r.ref, r.refKind, {
                                label: r.id,
                                subject: r.subject
                              })
                            }
                            title={running ? '请先停止 ComfyUI' : `切换到 ${r.id}`}
                          >
                            {planning === r.ref ? <Spinner /> : <Icon icon={ArrowRight} size={13} />}
                            切换使用
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
          </>
        )}

        {tab === 'backup' &&
          (backups.length === 0 ? (
            <Empty
              title="还没有备份"
              hint="每次切换版本前会自动创建备份，也可以点右上角「立即备份」。备份包含版本信息、插件清单与用户配置，不含模型文件。"
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>备份 ID</th>
                    <th style={{ width: 130 }}>版本</th>
                    <th style={{ width: 110 }}>提交</th>
                    <th style={{ width: 190 }}>创建时间</th>
                    <th style={{ width: 90 }} className="num">
                      插件
                    </th>
                    <th style={{ width: 150 }}>状态</th>
                    <th style={{ width: 150 }} />
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.id}>
                      <td className="mono ellipsis" style={{ maxWidth: 460 }} title={b.id}>
                        {b.id}
                      </td>
                      <td className="mono">{b.tag ?? '—'}</td>
                      <td className="mono">{b.commit.slice(0, 8)}</td>
                      <td className="mono" style={{ fontSize: 'var(--fs-xs)' }}>
                        {formatDateTime(b.createdAt)}
                      </td>
                      <td className="num">{b.nodeCount}</td>
                      <td>
                        <span className="row" style={{ gap: 4 }}>
                          {b.dirty && <Tag tone="warn">脏工作区</Tag>}
                          {b.restoredAt ? (
                            <Tag tone="ok">已还原 {formatRelative(b.restoredAt)}</Tag>
                          ) : (
                            <Tag>未还原</Tag>
                          )}
                        </span>
                      </td>
                      <td>
                        <div className="table__actions">
                          <button
                            type="button"
                            className="btn btn--sm"
                            disabled={running}
                            title={running ? '请先停止 ComfyUI' : '还原到这个备份'}
                            onClick={() => setRestoreTarget(b)}
                          >
                            还原
                          </button>
                          <button
                            type="button"
                            className="btn btn--sm btn--danger"
                            onClick={() => void doDeleteBackup(b)}
                          >
                            <Icon icon={Trash2} size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        {tab === 'log' &&
          (lastResult ? (
            <div style={{ padding: 'var(--sp-3)' }}>
              <div className="kv" style={{ marginBottom: 'var(--sp-3)' }}>
                <span className="kv__k">版本变化</span>
                <span className="kv__v">
                  {lastResult.fromRef ?? '—'} → {lastResult.toTag ?? lastResult.toCommit.slice(0, 8)}
                </span>
                <span className="kv__k">备份</span>
                <span className="kv__v">{lastResult.backupId ?? '（未创建）'}</span>
                <span className="kv__k">工作区</span>
                <span className="kv__v">{lastResult.stashed ? '已 stash 保存' : '无需 stash'}</span>
                <span className="kv__k">代码变更</span>
                <span className="kv__v">
                  {lastResult.changeSummary
                    ? `${lastResult.changeSummary.filesChanged} 个文件 · +${lastResult.changeSummary.insertions} / -${lastResult.changeSummary.deletions}`
                    : '无差异'}
                </span>
              </div>

              {lastResult.requirementsDiff && <DiffView diff={lastResult.requirementsDiff} />}

              {lastResult.commits.length > 0 && (
                <>
                  <div className="section-title">区间提交（{lastResult.commits.length}）</div>
                  <div className="commit-list">
                    {lastResult.commits.map((c, i) => (
                      <div key={i}>{c}</div>
                    ))}
                  </div>
                </>
              )}

              <div className="row" style={{ marginTop: 'var(--sp-3)', gap: 'var(--sp-2)' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void doSyncDeps()}
                  disabled={running}
                >
                  <Icon icon={Download} size={14} />
                  同步 Python 依赖
                </button>
                <button type="button" className="btn" onClick={() => setTab('list')}>
                  返回列表
                </button>
              </div>
            </div>
          ) : (
            <Empty
              title="还没有切换结果"
              hint="切换版本之后，版本变化、依赖差异和区间提交会显示在这里。"
            />
          ))}
      </Panel>

      {/* ══════════ 切换确认 ══════════ */}
      {plan && (
        <Modal
          title={`切换到 ${planTitle(plan)}`}
          subtitle={`当前：${plan.currentRef ?? '—'}（${plan.currentCommit?.slice(0, 8) ?? '—'}）`}
          onClose={() => setPlan(null)}
          width={720}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPlan(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={plan.blockers.length > 0}
                onClick={() => void doSwitch()}
              >
                <Icon icon={Check} size={14} />
                确认切换
              </button>
            </>
          }
        >
          {plan.blockers.length > 0 && (
            <Notice tone="error" title="无法切换">
              {plan.blockers.map((b, i) => (
                <div key={i}>{b}</div>
              ))}
            </Notice>
          )}

          <div className="kv" style={{ marginBottom: 'var(--sp-3)' }}>
            <span className="kv__k">目标版本</span>
            <span className="kv__v">
              {plan.target} {plan.targetCommit ? `（${plan.targetCommit}）` : ''}
            </span>
            {plan.subject && (
              <>
                <span className="kv__k">提交</span>
                <span className="kv__v">{plan.subject}</span>
              </>
            )}
            <span className="kv__k">本地状态</span>
            <span className="kv__v">
              {plan.fetched
                ? '已下载，可离线切换'
                : '尚未下载 —— 切换时会先联网浅取（通常几秒）'}
            </span>
            {plan.commitCount !== null && (
              <>
                <span className="kv__k">提交跨度</span>
                <span className="kv__v">{plan.commitCount} 个提交</span>
              </>
            )}
          </div>

          {plan.warnings.length > 0 && (
            <div style={{ marginBottom: 'var(--sp-3)' }}>
              {plan.warnings.map((w, i) => (
                <Notice key={i} tone="warn">
                  {w}
                </Notice>
              ))}
            </div>
          )}

          {plan.requirementsDiff && (
            <>
              <div className="section-title" style={{ marginTop: 0 }}>
                依赖差异（requirements.txt）
              </div>
              <DiffView diff={plan.requirementsDiff} />
            </>
          )}

          <div className="section-title">执行选项</div>
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            <Switch
              checked={optBackup}
              onChange={setOptBackup}
              label="切换前创建备份（强烈建议保留）"
            />
            <DepSyncNote diff={plan.requirementsDiff} />
          </div>
        </Modal>
      )}

      {/* ══════════ 还原确认 ══════════ */}
      {restoreTarget && (
        <Modal
          title="还原备份"
          subtitle={restoreTarget.id}
          onClose={() => setRestoreTarget(null)}
          width={640}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRestoreTarget(null)}>
                取消
              </button>
              <button type="button" className="btn btn--danger" onClick={() => void doRestore()}>
                确认还原
              </button>
            </>
          }
        >
          <Notice tone="warn" title="还原会改动当前代码与你正在使用的版本">
            代码将强制切换到备份时的提交（
            <code className="mono">{restoreTarget.tag ?? restoreTarget.commit.slice(0, 8)}</code>
            ），user 目录配置会被覆盖。插件目录<strong>不会</strong>被还原，只会列出缺失项。
          </Notice>
          <div className="kv" style={{ marginTop: 'var(--sp-3)' }}>
            <span className="kv__k">备份时间</span>
            <span className="kv__v">{formatDateTime(restoreTarget.createdAt)}</span>
            <span className="kv__k">记录的插件数</span>
            <span className="kv__v">{restoreTarget.nodeCount}</span>
            <span className="kv__k">备份时工作区</span>
            <span className="kv__v">{restoreTarget.dirty ? '有未提交改动' : '干净'}</span>
          </div>
        </Modal>
      )}
    </>
  )
}

/* ── 切换目标的可读标识 ── */

/**
 * 弹窗标题上的目标标识。
 * 原先标题直接用 plan.target，切到某个提交时就是 40 位全量 SHA 铺在标题里，
 * 既读不出是哪个版本，也和列表里显示的短 SHA 对不上。
 * 现在 tag / 分支直接用名字，commit 用短 SHA —— 与「版本ID」列、按钮 tooltip 一致。
 */
type PlanDisplay = { label?: string; subject?: string }

function planTitle(plan: SwitchPlan & PlanDisplay): string {
  if (plan.label) return plan.label
  return plan.refKind === 'commit' ? (plan.targetCommit ?? plan.target.slice(0, 8)) : plan.target
}

/*
 * 依赖同步说明。
 * 原先这里是「切换后立即同步 Python 依赖」勾选项，默认不勾——
 * 但差异在上面刚算完，有差异就该装、没差异本来也无事可做，让用户再点一次毫无意义。
 * 现在同步是自动的，这里只负责把将要发生的事说清楚。
 */
function DepSyncNote({ diff }: { diff: SwitchPlan['requirementsDiff'] }): React.JSX.Element {
  if (!diff) {
    return (
      <span className="field__hint">
        两侧缺少 requirements.txt 无法比对；切换后如有需要，可在下方点「同步 Python 依赖」。
      </span>
    )
  }

  const total = diff.added.length + diff.removed.length + diff.changed.length
  if (total === 0) {
    return (
      <span className="field__hint">
        依赖清单两个版本完全一致（{diff.same} 项相同），切换后无需同步。
      </span>
    )
  }

  return (
    <span className="field__hint">
      切换后会自动同步 Python 依赖（pip install -r requirements.txt）：新增 {diff.added.length}、移除{' '}
      {diff.removed.length}、变更 {diff.changed.length}。
    </span>
  )
}

/* ── 依赖差异展示 ── */
function DiffView({
  diff
}: {
  diff: NonNullable<SwitchResult['requirementsDiff']>
}): React.JSX.Element {
  const total = diff.added.length + diff.removed.length + diff.changed.length
  if (total === 0) {
    return (
      <Notice tone="ok" title="依赖清单没有变化">
        requirements.txt 在两个版本之间完全一致（{diff.same} 项相同）。
      </Notice>
    )
  }
  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      {diff.added.length > 0 && (
        <div>
          <div className="field__label">新增 {diff.added.length}</div>
          <div className="diff-list">
            {diff.added.map((d) => (
              <span key={d} className="diff-item diff-item--add">
                + {d}
              </span>
            ))}
          </div>
        </div>
      )}
      {diff.changed.length > 0 && (
        <div>
          <div className="field__label">版本变更 {diff.changed.length}</div>
          <div className="diff-list">
            {diff.changed.map((d) => (
              <span key={d} className="diff-item diff-item--chg">
                ~ {d}
              </span>
            ))}
          </div>
        </div>
      )}
      {diff.removed.length > 0 && (
        <div>
          <div className="field__label">移除 {diff.removed.length}</div>
          <div className="diff-list">
            {diff.removed.map((d) => (
              <span key={d} className="diff-item diff-item--del">
                − {d}
              </span>
            ))}
          </div>
        </div>
      )}
      <span className="field__hint">另有 {diff.same} 项保持一致。</span>
    </div>
  )
}
