import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EnvBackupFile, OpResult, PipPackage } from '@shared/types'
import { FolderOpen, Package, RefreshCw, Search } from 'lucide'
import { Icon } from '../components/Icon'
import { Empty, Modal, Notice, Panel, Spinner } from '../components/ui'
import { formatBytes, formatDateTime } from '../lib/format'
import { useApp } from '../store'

/* ══════════════════════════════════════════════════════════
 * 环境管理
 *
 * 对应原版 AI 引擎里的 pip 管理：已装包清单、按名称或文件安装、
 * 卸载、按当前版本强制重装、打开包目录、freeze 备份与按清单恢复。
 * 版本页继续管 ComfyUI 自己的 requirements，插件页继续管单个插件依赖。
 * ══════════════════════════════════════════════════════════ */

const INSTALL_PLACEHOLDER =
  '请填写pip名称（例1：onnxruntime  例2：onnxruntime>=1.17） 或选择.whl / requirements.txt文件进行安装'

const CORE_PACKAGES = new Set(['pip', 'setuptools', 'wheel'])

function matchesPackage(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const n = name.toLowerCase()
  const alts = new Set([q, q.replaceAll('-', '_'), q.replaceAll('_', '-')])
  for (const alt of alts) {
    if (alt && n.includes(alt)) return true
  }
  return false
}

function lockTitle(serviceRunning: boolean, busy: boolean): string | undefined {
  if (serviceRunning) return '请先停止 ComfyUI'
  if (busy) return '有任务正在进行'
  return undefined
}

export default function Packages(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const env = useApp((s) => s.env)
  const jobs = useApp((s) => s.jobs)
  const service = useApp((s) => s.service)
  const setPage = useApp((s) => s.setPage)
  const pushToast = useApp((s) => s.pushToast)

  const root = settings?.comfyRoot ?? ''
  const pythonOk = Boolean(root && env?.pythonExe)
  const serviceRunning = service?.state === 'running' || service?.state === 'launching'

  const [packages, setPackages] = useState<PipPackage[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [spec, setSpec] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)

  const [uninstallTarget, setUninstallTarget] = useState<PipPackage | null>(null)
  const [backupOpen, setBackupOpen] = useState(false)
  const [backupName, setBackupName] = useState('')
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [backups, setBackups] = useState<EnvBackupFile[]>([])
  const [backupsLoading, setBackupsLoading] = useState(false)
  const [restorePath, setRestorePath] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (!root || !env?.pythonExe) {
      setPackages([])
      return
    }
    setLoading(true)
    try {
      setPackages(await window.launcher.listPipPackages(root))
      setListError(null)
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [root, env?.pythonExe])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runningJob = useMemo(
    () => jobs.find((j) => j.status === 'running' && j.kind.startsWith('pip-')) ?? null,
    [jobs]
  )
  const pinnedJob = useMemo(
    () => jobs.find((j) => j.id === activeJobId) ?? null,
    [jobs, activeJobId]
  )
  const activeJob = runningJob ?? pinnedJob
  const busy = pending || activeJob?.status === 'running'
  const writeLocked = serviceRunning || busy

  const visible = useMemo(
    () => packages.filter((pkg) => matchesPackage(pkg.name, filter)),
    [packages, filter]
  )

  const fail = (message: string): void => {
    if (message.includes('已取消')) {
      pushToast(message, 'warn')
      return
    }
    setError(message)
    pushToast('操作失败', 'error')
  }

  const runJob = async (
    fn: () => Promise<OpResult<unknown>>,
    onOk: (value: unknown) => void
  ): Promise<void> => {
    setPending(true)
    setError(null)
    setActiveJobId(null)
    try {
      const res = await fn()
      setActiveJobId(res.jobId)
      if (res.ok) onOk(res.value)
      else fail(res.error)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  const doInstall = (): void => {
    const text = spec.trim()
    if (!text || writeLocked || !pythonOk) return
    void runJob(() => window.launcher.installPip(text, root), () => {
      setSpec('')
      pushToast('安装完成')
      void refresh()
    })
  }

  const doUninstall = (): void => {
    const pkg = uninstallTarget
    if (!pkg || writeLocked || !pythonOk) return
    setUninstallTarget(null)
    void runJob(() => window.launcher.uninstallPip(pkg.name, root), () => {
      pushToast(`已卸载 ${pkg.name}`)
      void refresh()
    })
  }

  const doReinstall = (pkg: PipPackage): void => {
    if (writeLocked || !pythonOk) return
    void runJob(
      () => window.launcher.reinstallPip(pkg.name, pkg.version, root),
      () => {
        pushToast(`已重装 ${pkg.name} ${pkg.version}`)
        void refresh()
      }
    )
  }

  const doBackup = (): void => {
    const name = backupName.trim()
    if (!name || busy || !pythonOk) return
    setBackupOpen(false)
    void runJob(() => window.launcher.backupEnv(name, root), (value) => {
      const file = value as EnvBackupFile
      pushToast(`环境已备份到 ${file.path}`)
    })
  }

  const openRestore = async (): Promise<void> => {
    if (writeLocked || !pythonOk) return
    setRestoreOpen(true)
    setBackupsLoading(true)
    setRestorePath(null)
    try {
      const list = await window.launcher.listEnvBackups(root)
      setBackups(list)
      setRestorePath(list[0]?.path ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBackupsLoading(false)
    }
  }

  const pickExternal = async (): Promise<void> => {
    const picked = await window.launcher.pickPipFile(root)
    if (picked) setRestorePath(picked)
  }

  const doRestore = (): void => {
    if (!restorePath || writeLocked || !pythonOk) return
    const filePath = restorePath
    setRestoreOpen(false)
    void runJob(() => window.launcher.restoreEnv(filePath, root), () => {
      pushToast('环境已按清单安装')
      void refresh()
    })
  }

  const pickInstallFile = async (): Promise<void> => {
    const picked = await window.launcher.pickPipFile(root)
    if (picked) {
      setSpec(picked)
      setError(null)
    }
  }

  const openDir = async (pkg: PipPackage): Promise<void> => {
    try {
      await window.launcher.locatePipPackage(pkg.name, root)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDragOver(false)
    const file = Array.from(e.dataTransfer.files).find((item) => /\.(whl|txt)$/i.test(item.name))
    if (!file) {
      setError('请拖入 .whl 或 requirements.txt')
      return
    }
    try {
      const filePath = window.launcher.pathForFile(file)
      if (!filePath) throw new Error('没有拿到文件路径')
      setSpec(filePath)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const backupActions = (
    <>
      <button
        type="button"
        className="btn btn--sm"
        disabled={!pythonOk || busy}
        title={busy ? '有任务正在进行' : '把当前已安装的包冻结成一份清单'}
        onClick={() => {
          setBackupName('')
          setBackupOpen(true)
        }}
      >
        备份环境
      </button>
      <button
        type="button"
        className="btn btn--sm"
        disabled={!pythonOk || writeLocked}
        title={lockTitle(serviceRunning, busy) ?? '按清单安装或降级已记录的包'}
        onClick={() => void openRestore()}
      >
        恢复环境
      </button>
    </>
  )

  const coreTarget = uninstallTarget ? CORE_PACKAGES.has(uninstallTarget.name.toLowerCase()) : false
  const knownRestore = backups.some((file) => file.path === restorePath)

  return (
    <>
      {!root && (
        <Notice
          tone="error"
          title="未设置便携版根目录"
          actions={
            <button type="button" className="btn btn--sm" onClick={() => setPage('settings')}>
              去设置
            </button>
          }
        >
          请先指定 ComfyUI 便携版根目录。环境管理使用其中的 python_embeded\python.exe。
        </Notice>
      )}
      {root && env && !env.pythonExe && (
        <Notice
          tone="error"
          title="未找到内置 Python"
          actions={
            <button type="button" className="btn btn--sm" onClick={() => setPage('settings')}>
              去设置
            </button>
          }
        >
          缺少 {root}\python_embeded\python.exe。请改到官方便携版的根目录。
        </Notice>
      )}
      {serviceRunning && (
        <Notice
          tone="warn"
          title="ComfyUI 正在运行"
          actions={
            <button type="button" className="btn btn--sm" onClick={() => setPage('dashboard')}>
              去停止
            </button>
          }
        >
          安装、卸载、重装和恢复都会改 site-packages，必须先停止服务。查看、搜索、打开目录和备份不受影响。
        </Notice>
      )}
      {(error || listError) && (
        <Notice tone="error" title={error ? '操作失败' : '读取失败'}>
          {error || listError}
        </Notice>
      )}

      <div className="section-title">环境管理</div>
      <Panel
        fill
        flush
        title={loading ? '已安装' : `已安装 ${packages.length}`}
        actions={
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void refresh()}
            disabled={loading || !pythonOk}
            title="重新读取已安装的包"
          >
            {loading ? <Spinner /> : <Icon icon={RefreshCw} size={13} />}
          </button>
        }
      >
        <div className="plugin-page">
          {packages.length === 0 ? (
            <div className="plugin-page__body">
              {loading ? (
                <div style={{ padding: 'var(--sp-4)' }}>
                  <Spinner label="正在读取已安装的包…" />
                </div>
              ) : (
                <Empty
                  icon={Package}
                  title={pythonOk ? '还没有读到已安装的包' : '无法读取环境'}
                  hint={
                    pythonOk
                      ? '在下方填写包名，或选择 .whl / requirements.txt 安装。'
                      : '设置好便携版根目录和内置 Python 之后，这里会列出 site-packages。'
                  }
                  actions={pythonOk ? backupActions : undefined}
                />
              )}
            </div>
          ) : (
            <div className="table-wrap plugin-page__body">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>序号</th>
                    <th>
                      <div className="table__search">
                        <Icon icon={Search} size={12} />
                        <input
                          className="table__search-input"
                          value={filter}
                          spellCheck={false}
                          placeholder="已安装名称：搜索pip名称"
                          onChange={(e) => setFilter(e.target.value)}
                        />
                      </div>
                    </th>
                    <th style={{ width: 150 }}>版本</th>
                    <th style={{ width: 248 }}>
                      <div className="table__ops">
                        <span>操作</span>
                        <div className="table__actions">{backupActions}</div>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr>
                      <td colSpan={4}>
                        <Empty title="没有匹配的包" />
                      </td>
                    </tr>
                  ) : (
                    visible.map((pkg, index) => (
                      <tr key={pkg.name.toLowerCase()}>
                        <td className="num">{index + 1}</td>
                        <td>
                          <button
                            type="button"
                            className="rowlink"
                            title="打开包目录"
                            onClick={() => void openDir(pkg)}
                          >
                            {pkg.name}
                          </button>
                        </td>
                        <td className="mono">{pkg.version}</td>
                        <td>
                          <div className="table__actions">
                            <button
                              type="button"
                              className="rowlink"
                              disabled={writeLocked}
                              title={lockTitle(serviceRunning, busy)}
                              onClick={() => setUninstallTarget(pkg)}
                            >
                              卸载
                            </button>
                            <button
                              type="button"
                              className="rowlink"
                              disabled={writeLocked}
                              title={lockTitle(serviceRunning, busy) ?? '按当前版本强制重装'}
                              onClick={() => doReinstall(pkg)}
                            >
                              重装
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div
            className={'gitbar' + (dragOver ? ' gitbar--drop' : '')}
            onDragOver={(e) => {
              if (![...e.dataTransfer.types].includes('Files')) return
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={(e) => {
              const next = e.relatedTarget
              if (next instanceof Node && e.currentTarget.contains(next)) return
              setDragOver(false)
            }}
            onDrop={onDrop}
          >
            <div className="gitbar__group">
              <span className="gitbar__label">包名</span>
              <input
                className="input"
                value={spec}
                spellCheck={false}
                disabled={!pythonOk}
                placeholder={INSTALL_PLACEHOLDER}
                title="可以把 .whl 或 requirements.txt 拖到这里"
                onChange={(e) => setSpec(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') doInstall()
                }}
              />
            </div>
            <button
              type="button"
              className="btn"
              disabled={!pythonOk}
              onClick={() => void pickInstallFile()}
            >
              <Icon icon={FolderOpen} size={14} />
              选择 .whl 或依赖.txt
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!pythonOk || writeLocked || !spec.trim()}
              title={lockTitle(serviceRunning, busy)}
              onClick={doInstall}
            >
              安装
            </button>
          </div>
        </div>
      </Panel>

      {uninstallTarget && (
        <Modal
          title="卸载包"
          subtitle={`${uninstallTarget.name} ${uninstallTarget.version}`}
          onClose={() => setUninstallTarget(null)}
          width={560}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setUninstallTarget(null)}>
                取消
              </button>
              <button type="button" className="btn btn--danger" onClick={doUninstall}>
                卸载
              </button>
            </>
          }
        >
          {coreTarget ? (
            <Notice tone="warn" title="卸掉它会让后续安装失效">
              {uninstallTarget.name} 是这套 Python 的安装底座。卸掉之后，安装、重装和恢复都会失败，直到把{' '}
              {uninstallTarget.name} 装回去。
            </Notice>
          ) : (
            <Notice tone="warn" title="将从嵌入式 Python 中移除这个包">
              依赖 {uninstallTarget.name} 的插件和 ComfyUI 之后可能无法启动。
            </Notice>
          )}
        </Modal>
      )}

      {backupOpen && (
        <Modal
          title="备份环境"
          subtitle="把当前已安装的包冻结成一份清单"
          onClose={() => setBackupOpen(false)}
          width={480}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setBackupOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!backupName.trim() || busy}
                onClick={doBackup}
              >
                开始备份
              </button>
            </>
          }
        >
          <label className="field">
            <span className="field__label">备份名称</span>
            <input
              className="input"
              value={backupName}
              autoFocus
              spellCheck={false}
              placeholder="输入名称方便下次恢复（支持中英文）"
              onChange={(e) => setBackupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doBackup()
              }}
            />
          </label>
        </Modal>
      )}

      {restoreOpen && (
        <Modal
          title="恢复环境"
          subtitle="按清单安装或降级"
          onClose={() => setRestoreOpen(false)}
          width={640}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRestoreOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={!restorePath || writeLocked}
                title={lockTitle(serviceRunning, busy)}
                onClick={doRestore}
              >
                开始恢复
              </button>
            </>
          }
        >
          <Notice tone="warn" title="清单之外的包会保留">
            已记录的包会被安装或降到清单里的版本。清单里没有的包留在环境中，这可能和当前依赖冲突。
          </Notice>
          <div className="pip-backups">
            {backupsLoading ? (
              <Spinner label="正在读取备份…" />
            ) : backups.length === 0 ? (
              <div className="dim">还没有备份。可以先做一次备份，或选择一个外部 txt。</div>
            ) : (
              backups.map((file) => (
                <label key={file.path} className="pip-backups__item">
                  <input
                    type="radio"
                    name="env-backup"
                    checked={restorePath === file.path}
                    onChange={() => setRestorePath(file.path)}
                  />
                  <span className="pip-backups__name">{file.name}</span>
                  <span className="dim">{formatDateTime(file.mtime)}</span>
                  <span className="mono dim">{formatBytes(file.bytes)}</span>
                </label>
              ))
            )}
          </div>
          {restorePath && !knownRestore && (
            <div className="dim" style={{ marginTop: 'var(--sp-2)' }}>
              当前选择：{restorePath}
            </div>
          )}
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <button type="button" className="btn btn--sm" onClick={() => void pickExternal()}>
              <Icon icon={FolderOpen} size={13} />
              选择其他 txt
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
