import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  InstallResult,
  InstalledNode,
  NodeDepsDetail,
  NodeReleases,
  NodeUpdateInfo,
  RegistryNode,
  RegistrySearchResult
} from '@shared/types'
import { Check, Download, ExternalLink, Plug, RefreshCw, Search } from 'lucide'
import { Icon } from '../components/Icon'
import {
  Empty,
  Led,
  Modal,
  Notice,
  Panel,
  Progress,
  Segmented,
  Spinner,
  Switch,
  Tag
} from '../components/ui'
import { formatDateTime } from '../lib/format'
import { useApp } from '../store'

/* ══════════════════════════════════════════════════════════
 * 插件管理安装
 *
 * 本机没有 ComfyUI-Manager，因此这里是自研实现：
 *   Registry（api.comfy.org）取元数据 → git clone 取代码 → 内置 pip 装依赖。
 * 全流程不依赖 ComfyUI 服务运行，装完提示重启生效。
 * ══════════════════════════════════════════════════════════ */

type Tab = 'installed' | 'search'

export default function Nodes(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const jobs = useApp((s) => s.jobs)
  const service = useApp((s) => s.service)
  const setPage = useApp((s) => s.setPage)
  const pushToast = useApp((s) => s.pushToast)
  const root = settings?.comfyRoot

  const running = service?.state === 'running' || service?.state === 'launching'

  const [tab, setTab] = useState<Tab>('installed')
  const [installed, setInstalled] = useState<InstalledNode[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')

  const [updates, setUpdates] = useState<Record<string, NodeUpdateInfo>>({})
  const [updating, setUpdating] = useState(false)
  /** 正在单独更新的插件目录名 */
  const [updatingDir, setUpdatingDir] = useState<string | null>(null)

  const [regQuery, setRegQuery] = useState('')
  const [regResult, setRegResult] = useState<RegistrySearchResult | null>(null)
  const [regLoading, setRegLoading] = useState(false)
  const [regPage, setRegPage] = useState(1)
  /** 页码输入框的草稿值：回车才提交，不然敲 "1"→"12"→"125" 会发三次请求 */
  const [pageDraft, setPageDraft] = useState('1')
  /** 网格实际布局（列数 / 行高 / 可视高）。都只有渲染完才知道，每页条数要靠它算 */
  const [grid, setGrid] = useState({ cols: 0, rowH: 0, viewH: 0 })

  /*
   * 每页条数按网格算：列数 × 能放下的行数。
   * 早先的做法是固定每页 24 条、末行拿空卡片补位——补出来的格子看着像没加载完，
   * 一眼就能看出"这里怎么是空的"。改成让服务端按网格给条数，每页正好铺满一屏，
   * 一个空格子都不需要。Registry 的 limit 上限是 100（要 200 只给 100）。
   */
  const regLimit = useMemo(() => {
    if (grid.cols < 1) return 24
    const maxRows = Math.floor(100 / grid.cols)
    const fitRows = grid.rowH > 0 && grid.viewH > 0 ? Math.floor(grid.viewH / grid.rowH) : 0
    const rows = Math.max(1, Math.min(fitRows || 3, maxRows))
    return grid.cols * rows
  }, [grid])
  const gridRef = useRef<HTMLDivElement>(null)
  /** 卡片区的滚动容器。分页条钉在底部后，翻页要把这一层滚回顶部 */
  const listRef = useRef<HTMLDivElement>(null)

  const [gitUrl, setGitUrl] = useState('')

  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<InstalledNode | null>(null)
  const [lastInstall, setLastInstall] = useState<InstallResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  /* 版本切换面板 */
  const [verTarget, setVerTarget] = useState<InstalledNode | null>(null)
  const [releases, setReleases] = useState<NodeReleases | null>(null)
  const [verLoading, setVerLoading] = useState(false)
  const [verSwitching, setVerSwitching] = useState<string | null>(null)

  /* ── 数据 ── */

  const refresh = useCallback(async (): Promise<InstalledNode[] | null> => {
    if (!root) return null
    setLoading(true)
    try {
      const list = await window.launcher.listInstalledNodes(root)
      setInstalled(list)
      return list
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setLoading(false)
    }
  }, [root])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activeJob = useMemo(
    () => jobs.find((j) => j.id === activeJobId) ?? null,
    [jobs, activeJobId]
  )
  const handledRef = useRef<string | null>(null)

  const doCheckUpdates = useCallback(async (quiet = false): Promise<void> => {
    if (!root) return
    setUpdating(true)
    if (!quiet) setError(null)
    try {
      const list = await window.launcher.checkNodeUpdates(root)
      const map: Record<string, NodeUpdateInfo> = {}
      for (const u of list) map[u.dirName] = u
      setUpdates(map)
      const failed = list.filter((u) => u.error)
      if (!quiet && list.length > 0 && failed.length === list.length) {
        setError(failed[0]?.error ?? '检查更新失败')
      }
    } catch (err) {
      if (!quiet) setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUpdating(false)
    }
  }, [root])

  /*
   * 进已安装页就核对一次远端。不核对的话，已经是最新的插件前面是空的，
   * 「最新」标识出不来。同一份目录列表不重复打远端。
   */
  const installedKey = installed.map((n) => n.dirName).join('\n')
  const autoCheckKey = useRef('')
  useEffect(() => {
    if (!root || tab !== 'installed' || installedKey.length === 0) return
    const key = `${root}\0${installedKey}`
    if (autoCheckKey.current === key) return
    autoCheckKey.current = key
    void doCheckUpdates(true)
  }, [root, tab, installedKey, doCheckUpdates])

  /**
   * 面板上那个刷新：重读本地目录，再强制核对远端。
   * 先记下这份目录名单，避免和「进页面自动检查」打两次远端。
   */
  const reload = useCallback(async (): Promise<void> => {
    const list = await refresh()
    if (!list || !root) return
    autoCheckKey.current = `${root}\0${list.map((n) => n.dirName).join('\n')}`
    await doCheckUpdates()
  }, [refresh, root, doCheckUpdates])

  useEffect(() => {
    if (!activeJob || activeJob.status === 'running') return
    if (handledRef.current === activeJob.id) return
    handledRef.current = activeJob.id
    void refresh()
    if (activeJob.status === 'succeeded' && activeJob.kind === 'node-install') {
      setLastInstall(null)
    }
    if (
      activeJob.status === 'succeeded' &&
      (activeJob.kind === 'node-update' || activeJob.kind === 'node-update-all')
    ) {
      void doCheckUpdates()
    }
  }, [activeJob, refresh, doCheckUpdates])

  const startJob = (res: { jobId: string }): void => {
    handledRef.current = null
    setActiveJobId(res.jobId)
    setError(null)
  }

  /* ── 操作 ── */

  const runSearch = useCallback(
    async (q: string, page: number, limit: number): Promise<void> => {
      setRegLoading(true)
      setError(null)
      try {
        setRegResult(await window.launcher.searchRegistry(q, page, limit))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setRegLoading(false)
      }
    },
    []
  )

  /* 首次进入搜索页给一批热门结果（Registry 支持空关键字） */
  useEffect(() => {
    if (tab !== 'search') return
    // 输入时防抖 400ms；只有每页条数因窗口变化时才用短防抖
    const timer = setTimeout(() => void runSearch(regQuery, regPage, regLimit), regQuery ? 400 : 150)
    return () => clearTimeout(timer)
  }, [tab, regQuery, regPage, regLimit, runSearch])

  const regTotalPages = regResult?.totalPages || 1
  const regCurrentPage = regResult?.page ?? regPage


  /* 结果换了就把输入框拉回当前页，别停在上一次没提交的草稿上 */
  useEffect(() => {
    if (regResult) setPageDraft(String(regResult.page))
  }, [regResult])

  /* 每页条数变了总页数也跟着变，页码要夹回范围内，否则会翻到空页 */
  useEffect(() => {
    if (regResult && regResult.totalPages > 0 && regPage > regResult.totalPages) {
      setRegPage(regResult.totalPages)
    }
  }, [regResult, regPage])

  /* 列数、行高、可视高度决定每页放几条，三者都只有渲染完才知道 */
  useLayoutEffect(() => {
    const el = gridRef.current
    const body = listRef.current
    if (!el || !body) return
    const measure = (): void => {
      const tpl = getComputedStyle(el).gridTemplateColumns
      const cols = tpl && tpl !== 'none' ? tpl.split(' ').filter(Boolean).length : 0
      const first = el.firstElementChild
      const rowH = first ? Math.round(first.getBoundingClientRect().height) : 0
      const viewH = body.clientHeight
      setGrid((prev) =>
        prev.cols === cols && prev.rowH === rowH && prev.viewH === viewH
          ? prev
          : { cols, rowH, viewH }
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(body)
    return () => ro.disconnect()
  }, [tab, regResult])

  /* 分页条在列表底部，翻页后新内容在顶部：不滚回去等于没翻 */
  const gotoPage = useCallback(
    (target: number): void => {
      const next = Math.min(Math.max(1, Math.floor(target) || 1), regTotalPages)
      if (next === regCurrentPage) {
        setPageDraft(String(next))
        return
      }
      setRegPage(next)
      listRef.current?.scrollTo({ top: 0 })
    },
    [regTotalPages, regCurrentPage]
  )

  /**
   * 装完的结果提示：插件本体 + 依赖是否跟上。
   * 依赖失败时页面里另有详细 Notice，这里只说结论，避免同一件事看两遍长文。
   */
  const toastInstall = (name: string, r: InstallResult | null): void => {
    if (!r) return
    const withDeps = r.requirementsTried && r.requirementsOk ? '（依赖已安装）' : ''
    pushToast(`插件 ${name} 安装成功${withDeps}`)
    if (r.requirementsTried && !r.requirementsOk) {
      pushToast(`插件已就位，但依赖没装成功：${r.warnings[0] ?? '请在插件页手动装依赖'}`, 'warn')
    }
  }

  const doInstallRegistry = async (node: RegistryNode): Promise<void> => {
    if (!root) return
    const res = await window.launcher.installFromRegistry(node.id, root)
    if (!res.ok) {
      setError(res.error)
      pushToast(`安装 ${node.name} 失败：${res.error}`, 'error')
      startJob(res)
      return
    }
    setLastInstall(res.value)
    toastInstall(node.name, res.value)
    startJob(res)
  }

  const doInstallGit = async (): Promise<void> => {
    if (!root || !gitUrl.trim()) return
    // 目录名留空，主进程按仓库名推导
    const res = await window.launcher.installFromGit(gitUrl.trim(), undefined, root)
    if (!res.ok) {
      setError(res.error)
      pushToast(`从 Git 安装失败：${res.error}`, 'error')
      startJob(res)
      return
    }
    setLastInstall(res.value)
    toastInstall(res.value.dirName, res.value)
    setGitUrl('')
    startJob(res)
  }

  const doToggle = async (node: InstalledNode): Promise<void> => {
    if (!root) return
    setError(null)
    try {
      setInstalled(await window.launcher.setNodeEnabled(node.dirName, !node.enabled, root))
      pushToast(`已${node.enabled ? '禁用' : '启用'} ${node.baseName}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      pushToast(`操作失败：${message}`, 'error')
    }
  }

  const doUpdateOne = async (node: InstalledNode): Promise<void> => {
    if (!root || updatingDir) return
    setUpdatingDir(node.dirName)
    setError(null)
    try {
      const res = await window.launcher.updateNode(node.dirName, root)
      if (!res.ok) {
        setError(res.error)
        pushToast(`更新 ${node.baseName} 失败：${res.error}`, 'error')
      } else {
        pushToast(`插件 ${node.baseName} 已更新（重启 ComfyUI 后生效）`)
        setUpdates((prev) => {
          const cur = prev[node.dirName]
          if (!cur?.remoteCommit) return prev
          return {
            ...prev,
            [node.dirName]: { ...cur, hasUpdate: false, localCommit: cur.remoteCommit, error: null }
          }
        })
      }
      startJob(res)
    } finally {
      setUpdatingDir(null)
    }
  }

  const doUpdateAll = async (): Promise<void> => {
    if (!root) return
    const res = await window.launcher.updateAllNodes(root)
    if (!res.ok) {
      setError(res.error)
      pushToast(`批量更新失败：${res.error}`, 'error')
    } else {
      pushToast(
        res.value.length > 0 ? `已更新 ${res.value.length} 个插件` : '所有插件都已是最新'
      )
    }
    startJob(res)
  }

  const doInstallAllDeps = async (): Promise<void> => {
    if (!root) return
    const res = await window.launcher.reinstallAllNodeDeps(root)
    if (!res.ok) {
      setError(res.error)
      pushToast(`重装插件依赖失败：${res.error}`, 'error')
      return
    }
    pushToast(
      res.value.length > 0 ? `已重装 ${res.value.length} 个插件的依赖` : '没有需要重装的依赖'
    )
  }

  const doUninstall = async (): Promise<void> => {
    const node = uninstallTarget
    if (!node || !root) return
    setUninstallTarget(null)
    const res = await window.launcher.uninstallNode(node.dirName, root)
    if (!res.ok) {
      setError(res.error)
      pushToast(`卸载 ${node.baseName} 失败：${res.error}`, 'error')
    } else {
      pushToast(`插件 ${node.baseName} 已卸载`)
    }
    startJob(res)
  }

  /* ── 版本切换 ── */

  const openVersions = async (node: InstalledNode, fetch = false): Promise<void> => {
    if (!root) return
    setVerTarget(node)
    setVerLoading(true)
    try {
      setReleases(await window.launcher.nodeReleases(node.dirName, root, fetch))
    } catch (err) {
      setReleases({
        dirName: node.dirName,
        remote: null,
        branch: null,
        branches: [],
        entries: [],
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setVerLoading(false)
    }
  }

  const doCheckout = async (node: InstalledNode, ref: string, label: string): Promise<void> => {
    if (!root) return
    setVerSwitching(ref)
    try {
      const res = await window.launcher.nodeCheckout(node.dirName, ref, root)
      if (!res.ok) {
        setError(res.error)
        pushToast(`切换 ${node.baseName} 到 ${label} 失败：${res.error}`, 'error')
        return
      }
      pushToast(`插件 ${node.baseName} 已切到 ${label}（重启 ComfyUI 后生效）`)
      await openVersions(node, false)
      await refresh()
    } finally {
      setVerSwitching(null)
    }
  }

  /* ── 派生数据 ── */

  const installedRemotes = useMemo(() => {
    const s = new Set<string>()
    for (const n of installed) {
      s.add(n.dirName.toLowerCase())
      s.add(n.baseName.toLowerCase())
      if (n.remote) {
        const clean = n.remote.replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase()
        s.add(clean.split('/').slice(-2).join('/'))
      }
    }
    return s
  }, [installed])

  const isInstalled = (node: RegistryNode): boolean => {
    if (installedRemotes.has(node.id.toLowerCase())) return true
    if (node.repository) {
      const clean = node.repository.replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase()
      return installedRemotes.has(clean.split('/').slice(-2).join('/'))
    }
    return false
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return installed
    return installed.filter(
      (n) =>
        n.baseName.toLowerCase().includes(q) ||
        (n.displayName ?? '').toLowerCase().includes(q) ||
        (n.remote ?? '').toLowerCase().includes(q)
    )
  }, [installed, filter])

  const updateCount = useMemo(
    () => Object.values(updates).filter((u) => u.hasUpdate).length,
    [updates]
  )

  /* ── 渲染 ── */

  return (
    <>
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
          安装、卸载、启停插件都会改动 custom_nodes 目录，必须先停止服务。查看与搜索不受影响。
        </Notice>
      )}

      {error && (
        <Notice tone="error" title="操作失败">
          {error}
        </Notice>
      )}

      {lastInstall && lastInstall.warnings.length > 0 && (
        <Notice tone="warn" title="安装完成，但有需要注意的地方">
          {lastInstall.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </Notice>
      )}

      {/* ── 标签页 ── */}
      <div className="section-title">插件操作</div>
      <Panel
        fill
        flush
        title={
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'installed', label: `已安装 ${installed.length}` },
              { value: 'search', label: '插件安装' }
            ]}
          />
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => void reload()}
              disabled={loading || updating}
              title="重新读取插件目录，并联网检查更新"
            >
              {loading || updating ? <Spinner /> : <Icon icon={RefreshCw} size={13} />}
              刷新
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => void doInstallAllDeps()}
              disabled={running || installed.length === 0}
              title={running ? '请先停止 ComfyUI' : undefined}
            >
              <Icon icon={Download} size={13} />
              重装所有插件依赖
            </button>
          </>
        }
      >
        {/* ══════════ 已安装：表头即工具栏（启用 / 名称+搜索 / 依赖 / 远程地址 / 版本ID / 更新时间 / 操作） ══════════ */}
        {/* ══════════ 已安装 ══════════ */}
        {tab === 'installed' &&
          (installed.length === 0 ? (
            <Empty
              icon={Plug}
              title="custom_nodes 目录为空"
              hint="从 ComfyUI Registry（6000+ 插件）搜索安装，或直接粘贴 Git 仓库地址。"
              actions={
                <button type="button" className="btn btn--sm" onClick={() => setTab('search')}>
                  插件安装
                </button>
              }
            />
          ) : visible.length === 0 ? (
            <Empty title="没有匹配的插件" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 64 }}>启用</th>
                    <th style={{ width: 250 }}>
                      <div className="table__search">
                        <Icon icon={Search} size={12} />
                        <input
                          className="table__search-input"
                          value={filter}
                          spellCheck={false}
                          placeholder={`名称：搜索插件名称 (${visible.length})`}
                          onChange={(e) => setFilter(e.target.value)}
                        />
                      </div>
                    </th>
                    <th style={{ width: 90 }}>依赖</th>
                    <th>远程地址</th>
                    <th style={{ width: 100 }}>版本ID</th>
                    <th style={{ width: 170 }}>更新时间</th>
                    <th style={{ width: 220 }}>
                      <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={running || updateCount === 0}
                          title={running ? '请先停止 ComfyUI' : undefined}
                          onClick={() => void doUpdateAll()}
                        >
                          一键更新{updateCount > 0 ? ` (${updateCount})` : ''}
                        </button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((n) => {
                    const up = updates[n.dirName]
                    return (
                      <tr key={n.dirName}>
                        <td>
                          <Switch
                            checked={n.enabled}
                            disabled={running}
                            onChange={() => void doToggle(n)}
                          />
                        </td>
                        <td>
                          <div className="row" style={{ gap: 6, minWidth: 0 }}>
                            <strong className="ellipsis" title={n.baseName}>
                              {n.displayName ?? n.baseName}
                            </strong>
                            {n.dirty && <Tag tone="warn">本地改动</Tag>}
                          </div>
                          {n.displayName && (
                            <div className="mono dim ellipsis" style={{ fontSize: 'var(--fs-xs)' }}>
                              {n.baseName}
                            </div>
                          )}
                        </td>
                        <td>
                          {root && <DepCell node={n} root={root} />}
                        </td>
                        <td>
                          <span
                            className="mono dim ellipsis"
                            style={{ display: 'inline-block', maxWidth: 340, verticalAlign: 'bottom' }}
                            title={n.remote ?? '非 git 目录'}
                          >
                            {n.remote ? n.remote.replace(/^https:\/\/github\.com\//, '') : '非 git 目录'}
                          </span>
                        </td>
                        <td className="mono">{n.shortCommit ?? '—'}</td>
                        <td className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                          {n.commitDate ? formatDateTime(n.commitDate) : '—'}
                        </td>
                        <td>
                          <div className="table__actions">
                            <NodeVersionMark
                              info={up}
                              busy={updatingDir === n.dirName}
                              running={running}
                              locked={updatingDir !== null}
                              onUpdate={() => void doUpdateOne(n)}
                            />
                            <button
                              type="button"
                              className="rowlink"
                              onClick={() => void openVersions(n)}
                            >
                              切换版本
                            </button>
                            <button
                              type="button"
                              className="rowlink rowlink--danger"
                              disabled={running}
                              title={running ? '请先停止 ComfyUI' : undefined}
                              onClick={() => setUninstallTarget(n)}
                            >
                              卸载
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}

        {/* ══════════ 插件安装 ══════════ */}
        {tab === 'search' && (
          <div className="plugin-page">
            <div className="toolbar">
              <div className="row" style={{ gap: 6, flex: 1, maxWidth: 420 }}>
                <Icon icon={Search} size={15} />
                <input
                  className="input"
                  style={{ fontFamily: 'var(--font-ui)' }}
                  placeholder="搜索 ComfyUI Registry（例如 impact、video、upscale）…"
                  value={regQuery}
                  spellCheck={false}
                  onChange={(e) => {
                    setRegQuery(e.target.value)
                    setRegPage(1)
                  }}
                />
              </div>
              {regLoading && <Spinner />}
            </div>

            <div className="plugin-page__body" ref={listRef}>
              {regResult?.error && (
              <div style={{ padding: 'var(--sp-3)' }}>
                <Notice tone="error" title="Registry 访问失败">
                  {regResult.error}
                </Notice>
              </div>
            )}

              {regLoading && !regResult ? (
                <div className="stack" style={{ padding: 'var(--sp-6) var(--sp-3)' }}>
                  <Led tone="busy" label="正在查询 ComfyUI Registry…" />
                  <Progress percent={null} />
                </div>
              ) : !regResult || regResult.nodes.length === 0 ? (
                <Empty title="没有结果" hint="换个关键字试试，或检查网络与代理设置。" />
              ) : (
              <div className="plugin-grid" ref={gridRef}>
                {regResult.nodes.map((node) => (
                  <PluginCard
                    key={node.id}
                    node={node}
                    installed={isInstalled(node)}
                    disabled={running}
                    onInstall={() => void doInstallRegistry(node)}
                  />
                ))}
              </div>
            )}

            </div>

            {regResult && regResult.nodes.length > 0 && (
              <div className="plugin-pager">
                <span className="plugin-pager__total">
                  共 {regResult.total.toLocaleString()} 个插件 · 每页 {regResult.pageSize} 条
                </span>
                <div className="plugin-pager__nav">
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={regLoading || regCurrentPage <= 1}
                    onClick={() => gotoPage(1)}
                  >
                    首页
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={regLoading || regCurrentPage <= 1}
                    onClick={() => gotoPage(regCurrentPage - 1)}
                  >
                    上一页
                  </button>
                  <span className="plugin-pager__pos">
                    第
                    <input
                      className="input plugin-pager__input"
                      value={pageDraft}
                      inputMode="numeric"
                      aria-label="跳转到指定页码"
                      spellCheck={false}
                      onChange={(e) => setPageDraft(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') gotoPage(Number(pageDraft))
                        if (e.key === 'Escape') setPageDraft(String(regCurrentPage))
                      }}
                      onBlur={() => setPageDraft(String(regCurrentPage))}
                    />
                    / {regTotalPages} 页
                  </span>
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={regLoading || regCurrentPage >= regTotalPages}
                    onClick={() => gotoPage(regCurrentPage + 1)}
                  >
                    下一页
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={regLoading || regCurrentPage >= regTotalPages}
                    onClick={() => gotoPage(regTotalPages)}
                  >
                    末页
                  </button>
                </div>
              </div>
            )}

            {/* 复刻原版：Git 安装不做独立标签页，直接钉在页面底部 */}
            <div className="gitbar">
              <div className="gitbar__group">
                <span className="gitbar__label">Git 地址</span>
                <input
                  className="input"
                  placeholder="请填写插件 git 地址"
                  value={gitUrl}
                  spellCheck={false}
                  title={running ? '请先停止 ComfyUI' : undefined}
                  onChange={(e) => setGitUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && gitUrl.trim() && !running) void doInstallGit()
                  }}
                />
              </div>
              <button
                type="button"
                className="btn btn--primary"
                disabled={running || !gitUrl.trim()}
                title={running ? '请先停止 ComfyUI' : undefined}
                onClick={() => void doInstallGit()}
              >
                <Icon icon={Download} size={14} />
                安装
              </button>
            </div>
          </div>
        )}


      </Panel>

      {/* ══════════ 卸载确认 ══════════ */}
      {uninstallTarget && (
        <Modal
          title="卸载插件"
          subtitle={uninstallTarget.baseName}
          onClose={() => setUninstallTarget(null)}
          width={620}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setUninstallTarget(null)}>
                取消
              </button>
              <button type="button" className="btn btn--danger" onClick={() => void doUninstall()}>
                移入回收站
              </button>
            </>
          }
        >
          <Notice tone="warn" title="将删除插件目录（可从回收站恢复）">
            插件目录会被移入系统回收站，不会永久删除。
          </Notice>
          <div className="kv" style={{ marginTop: 'var(--sp-3)' }}>
            <span className="kv__k">目录</span>
            <span className="kv__v">{uninstallTarget.path}</span>
            <span className="kv__k">仓库</span>
            <span className="kv__v">{uninstallTarget.remote ?? '非 git 目录'}</span>
          </div>
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <Notice tone="info" title="依赖不会被删除">
              该插件安装过的 Python 包会保留在 python_embeded 中。这是刻意设计：这些包很可能同时被其他插件或
              ComfyUI 本体使用，自动删除会导致其他功能损坏。
            </Notice>
          </div>
        </Modal>
      )}

      {/* ══════════ 版本切换 ══════════ */}
      {verTarget && (
        <Modal
          title="切换插件版本"
          subtitle={[
            verTarget.baseName,
            releases?.branch,
            releases?.remote?.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')
          ]
            .filter(Boolean)
            .join(' · ')}
          onClose={() => setVerTarget(null)}
          width={860}
          flush
          footer={
            <button type="button" className="btn" onClick={() => setVerTarget(null)}>
              关闭
            </button>
          }
        >
          {verLoading ? (
            <Spinner label="正在读取版本列表…" />
          ) : releases?.error ? (
            <Notice tone="warn" title="读不到版本列表">
              {releases.error}
            </Notice>
          ) : (releases?.entries.length ?? 0) === 0 ? (
            <Empty title="没有可切换的版本" hint="这个插件仓库还没有可读的历史。" />
          ) : (
            /*
             * 和参考同一套布局：五列，分支下拉就在「切换分支」表头格里。
             * 表头是 sticky 的，下拉放里面才会一直可见；放表体第一行会被表头压住。
             * table-layout: fixed 也是必须的 —— auto 布局下「更新说明」会被 nowrap
             * 的提交说明撑到 900px，把后面两列顶出可视区。
             */
            <div className="table-wrap" style={{ maxHeight: '58vh', overflowY: 'auto' }}>
              <table className="table" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: 92 }}>版本ID</th>
                  <th>更新说明</th>
                  <th style={{ width: 300 }}>
                    <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                      <span style={{ flex: '0 0 auto' }}>切换分支</span>
                      <select
                        className="select select--compact"
                        style={{ flex: 1, minWidth: 0 }}
                        value={releases?.branch ?? ''}
                        disabled={running || verSwitching !== null}
                        title={running ? '请先停止 ComfyUI' : undefined}
                        onChange={(e) => {
                          const name = e.target.value
                          if (name && name !== releases?.branch) {
                            void doCheckout(verTarget, name, `分支 ${name}`)
                          }
                        }}
                      >
                        {!releases?.branch && <option value="">（游离 HEAD）</option>}
                        {/* 选项里只放 ASCII 分支名：原生 select 渲染中文明显发糊 */}
                        {releases?.branches.map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                      {releases?.branches.find((b) => b.name === releases.branch)?.isDefault && (
                        <span style={{ flex: '0 0 auto' }}>主分支</span>
                      )}
                    </div>
                  </th>
                  <th style={{ width: 150 }}>更新时间</th>
                  <th style={{ width: 96 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {releases?.entries.map((r) => (
                  <tr key={r.sha}>
                    <td className="mono">{r.short}</td>
                    <td>
                      <div className="ellipsis" title={r.subject}>
                        {r.subject || '（无提交说明）'}
                      </div>
                    </td>
                    <td />
                    <td className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                      {r.date ? formatDateTime(r.date) : '—'}
                    </td>
                    <td>
                      {r.current ? (
                        <span className="dim">当前版本</span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={running || verSwitching !== null}
                          title={running ? '请先停止 ComfyUI' : undefined}
                          onClick={() => void doCheckout(verTarget, r.sha, r.short)}
                        >
                          {verSwitching === r.sha ? <Spinner /> : null}
                          切换
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Modal>
      )}
    </>
  )
}

/*
 * 切换版本前面的版本状态。
 * 比对过、且和远端一致：灰色「最新」，不是按钮，点不了。
 * 远端有新提交：蓝色「更新」，点了才拉取。
 * 还没比对完、或这次没读到远端：什么都不放，避免把未知说成最新。
 */
function NodeVersionMark({
  info,
  busy,
  running,
  locked,
  onUpdate
}: {
  info: NodeUpdateInfo | undefined
  busy: boolean
  running: boolean
  locked: boolean
  onUpdate: () => void
}): React.JSX.Element | null {
  const compared = Boolean(info && !info.error && info.localCommit && info.remoteCommit)
  if (!info || !compared) return null
  if (!info.hasUpdate) {
    return (
      <button type="button" className="rowlink latest-flag" disabled tabIndex={-1} title="已是最新版本">
        最新
      </button>
    )
  }
  return (
    <button
      type="button"
      className="rowlink"
      disabled={running || locked}
      title={running ? '请先停止 ComfyUI' : '更新到远端最新提交'}
      onClick={onUpdate}
    >
      {busy ? '更新中' : '更新'}
    </button>
  )
}

/* ── 依赖单元格：悬停出浮层，逐项状态 + 单项安装/重装 ── */

function DepCell({ node, root }: { node: InstalledNode; root: string }): React.JSX.Element {
  const pushToast = useApp((s) => s.pushToast)
  const [detail, setDetail] = useState<NodeDepsDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const closeTimer = useRef<number | null>(null)

  const load = async (force = false): Promise<void> => {
    if (loading || (detail && !force)) return
    setLoading(true)
    try {
      setDetail(await window.launcher.nodeDepsDetail(node.dirName, root))
    } catch (err) {
      setDetail({
        dirName: node.dirName,
        hasRequirements: false,
        entries: [],
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setLoading(false)
    }
  }

  const open = (el: HTMLElement): void => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    const r = el.getBoundingClientRect()
    setAnchor({ left: r.left, top: r.bottom + 4 })
    void load()
  }

  const scheduleClose = (): void => {
    closeTimer.current = window.setTimeout(() => setAnchor(null), 200)
  }

  const install = async (name: string, spec: string): Promise<void> => {
    setBusy(name)
    try {
      const res = await window.launcher.nodeDepInstall(node.dirName, name, spec, root)
      if (!res.ok) {
        pushToast(`安装 ${name} 失败：${res.error}`, 'error')
        return
      }
      pushToast(`依赖 ${name} 安装完成`)
      await load(true)
    } finally {
      setBusy(null)
    }
  }

  const missing = detail?.entries.filter((e) => !e.installed).length ?? 0
  const tone = !detail || detail.error ? '' : missing > 0 ? ' rowlink--danger' : ''

  return (
    <>
      <button
        type="button"
        className={`rowlink${tone}`}
        title={node.hasRequirements ? '悬停查看依赖明细' : '没有 requirements.txt'}
        onMouseEnter={(e) => open(e.currentTarget)}
        onMouseLeave={scheduleClose}
        onClick={(e) => open(e.currentTarget)}
      >
        {!node.hasRequirements
          ? '无'
          : loading
            ? '…'
            : !detail
              ? `${node.requirementsCount} 项`
              : detail.error
                ? '查看'
                : missing > 0
                  ? `缺 ${missing}`
                  : `${detail.entries.length} 项`}
      </button>

      {anchor && detail && (
        <div
          className="deppop"
          style={{ left: anchor.left, top: anchor.top }}
          onMouseEnter={() => closeTimer.current && window.clearTimeout(closeTimer.current)}
          onMouseLeave={scheduleClose}
        >
          <div className="deppop__head">
            <span>依赖 {detail.error ? '' : `${detail.entries.length} 项`}</span>
            {missing > 0 && <Tag tone="warn">缺 {missing}</Tag>}
          </div>
          {detail.error ? (
            <div className="deppop__err">{detail.error}</div>
          ) : (
            detail.entries.map((d) => (
              <div className="deppop__row" key={d.name}>
                <span className={`deppop__dot${d.installed ? ' deppop__dot--ok' : ' deppop__dot--warn'}`} />
                <span className="mono ellipsis" title={d.name}>
                  {d.name}
                </span>
                <span className="dim mono">{d.spec || '不限'}</span>
                <span className="mono">{d.installed ?? '未安装'}</span>
                <button
                  type="button"
                  className="rowlink"
                  disabled={busy !== null}
                  onClick={() => void install(d.name, d.spec)}
                >
                  {busy === d.name ? '…' : d.installed ? '重装' : '安装'}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </>
  )
}

/* ── Registry 插件卡片 ── */
function PluginCard({
  node,
  installed,
  disabled,
  onInstall
}: {
  node: RegistryNode
  installed: boolean
  disabled: boolean
  onInstall: () => void
}): React.JSX.Element {
  return (
    <div className="plugin-card card-in">
      <div className="plugin-card__head">
        <div style={{ minWidth: 0 }}>
          <div className="plugin-card__name ellipsis" title={node.name}>
            {node.name}
          </div>
          <div className="plugin-card__meta">
            <span className="mono">{node.id}</span>
            {node.author && <span>· {node.author}</span>}
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {installed && <Tag tone="ok">已安装</Tag>}
          {node.deprecated && <Tag tone="error">已弃用</Tag>}
          {node.latestVersion && <Tag tone="accent">v{node.latestVersion}</Tag>}
        </div>
      </div>

      <p className="plugin-card__desc">{node.description ?? '（该插件没有填写描述）'}</p>

      <div className="plugin-card__stats">
        {node.downloads !== null && <span title="下载量">↓ {formatCount(node.downloads)}</span>}
        {node.githubStars !== null && node.githubStars > 0 && (
          <span title="GitHub Stars">★ {formatCount(node.githubStars)}</span>
        )}
        {node.supportedComfyuiVersion && (
          <span className="mono" title="支持的 ComfyUI 版本">
            ComfyUI {node.supportedComfyuiVersion}
          </span>
        )}
        {node.dependencies.length > 0 && (
          <span title={node.dependencies.join('、')}>依赖 {node.dependencies.length}</span>
        )}
      </div>

      <div className="plugin-card__foot">
        {node.repository ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void window.launcher.openExternal(node.repository!)}
            title={node.repository}
          >
            <Icon icon={ExternalLink} size={12} />
            仓库
          </button>
        ) : (
          <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
            无仓库地址
          </span>
        )}
        <button
          type="button"
          className="btn btn--sm"
          style={{ marginLeft: 'auto' }}
          disabled={disabled || installed || !node.repository}
          onClick={onInstall}
          title={
            !node.repository
              ? '该插件未登记仓库地址，无法自动安装'
              : installed
                ? '已安装'
                : disabled
                  ? '请先停止 ComfyUI'
                  : `安装 ${node.name}`
          }
        >
          {installed ? <Icon icon={Check} size={12} /> : <Icon icon={Download} size={12} />}
          {installed ? '已装' : '安装'}
        </button>
      </div>
    </div>
  )
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
