import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide'
import { formatServiceState } from '../lib/format'
import { useApp } from '../store'
import { Icon } from './Icon'
import { Led, Progress, type LedTone } from './ui'

/* ══════════════════════════════════════════════════════════
 * 底部状态轨道
 *
 * 服务状态在界面上只有这一处：标题栏、侧边栏、面板头都不再重复。
 * 数据全部来自既有的 ServiceStatus / JobSnapshot，不额外请求。
 * ══════════════════════════════════════════════════════════ */

const TONE: Record<string, LedTone> = {
  running: 'ok',
  launching: 'busy',
  stopping: 'busy',
  error: 'error',
  stopped: 'off'
}

function uptime(from: number, now: number): string {
  const s = Math.max(0, Math.floor((now - from) / 1000))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

export function StatusRail(): React.JSX.Element {
  const service = useApp((s) => s.service)
  const settings = useApp((s) => s.settings)
  const job = useApp((s) => s.jobs.find((j) => j.status === 'running') ?? null)

  const running = service?.state === 'running'
  const [now, setNow] = useState(() => Date.now())

  // 只在运行中走秒，停止时不留定时器
  useEffect(() => {
    if (!running || !service?.startedAt) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [running, service?.startedAt])

  const state = service?.state ?? 'stopped'
  const missingRoot = !settings?.comfyRoot

  return (
    <footer className={`statusrail${missingRoot ? ' statusrail--warn' : ''}`}>
      <span className="statusrail__item">
        <Led
          tone={missingRoot ? 'warn' : (TONE[state] ?? 'off')}
          label={missingRoot ? '未配置' : formatServiceState(service?.state)}
        />
      </span>

      {service && (
        <span className="statusrail__item">
          端口 <span className="statusrail__val">{service.port}</span>
        </span>
      )}

      {running && service?.ready && service.url && (
        <span className="statusrail__item">
          <button
            type="button"
            className="statusrail__link"
            title={`在浏览器打开 ${service.url}`}
            onClick={() => void window.launcher.openExternal(service.url!)}
          >
            {service.url.replace('http://', '')}
            <Icon icon={ExternalLink} size={11} />
          </button>
        </span>
      )}

      {running && service?.pid && (
        <span className="statusrail__item">
          PID <span className="statusrail__val">{service.pid}</span>
        </span>
      )}

      {running && service?.startedAt && (
        <span className="statusrail__item">
          已运行 <span className="statusrail__val">{uptime(service.startedAt, now)}</span>
        </span>
      )}

      {job && (
        <span className="statusrail__item statusrail__job">
          <span className="ellipsis" style={{ color: 'var(--fg)' }}>{job.title}</span>
          <span className="statusrail__track">
            <Progress percent={job.percent} />
          </span>
          <button
            type="button"
            className="statusrail__link"
            onClick={() => void window.launcher.cancelJob(job.id)}
          >
            取消
          </button>
        </span>
      )}

      {/* 有任务时让出空间：进度条要占满剩余宽度，否则被这条 spacer 挤成四百来像素 */}
      <span className="statusrail__spacer" style={job ? { flex: '0 1 0' } : undefined} />

      {missingRoot && <span className="statusrail__item">未配置 ComfyUI 目录，请到「设置」指定</span>}
      {service?.state === 'error' && service.lastError && (
        <span className="statusrail__item ellipsis" title={service.lastError}>
          {service.lastError}
        </span>
      )}
    </footer>
  )
}
