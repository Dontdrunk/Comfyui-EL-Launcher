/** 渲染进程通用格式化工具 */
import type { ServiceState } from '@shared/types'

/** 服务状态 → 界面中文。界面任何位置都不直接显示 ServiceState 原始值。 */
export function formatServiceState(state: ServiceState | null | undefined): string {
  switch (state) {
    case 'running':
      return '运行中'
    case 'launching':
      return '启动中'
    case 'stopping':
      return '停止中'
    case 'error':
      return '异常'
    default:
      return '未启动'
  }
}

export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / Math.pow(1024, i)
  return `${v.toFixed(i === 0 ? 0 : digits)} ${units[i]}`
}

export function formatDateTime(input: number | string | null | undefined): string {
  if (input === null || input === undefined || input === '') return '—'
  const d = typeof input === 'number' ? new Date(input) : new Date(input)
  if (Number.isNaN(d.getTime())) return String(input)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  )
}

export function formatRelative(ts: number | null | undefined): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}
