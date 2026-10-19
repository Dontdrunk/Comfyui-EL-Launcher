import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { LogLine } from '@shared/types'
import {
  CircleAlert,
  CircleCheck,
  Info,
  LoaderCircle,
  X
} from 'lucide'
import { Icon } from './Icon'

/* ══════════════════════════════════════════════════════════
 * 通用 UI 原子组件
 *
 * 仪表台约束：
 *   · 分组优先用间距与发丝线，其次是 .section-title，最后才是面板
 *   · 状态信息只在底部状态轨道显示，不在面板头重复
 *   · 读数条列数由调用方按项目数显式给出，不自动换行（避免空格子）
 * ══════════════════════════════════════════════════════════ */

/* ── 面板 ── */
export function Panel({
  title,
  actions,
  children,
  flush = false,
  fill = false,
  className
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  flush?: boolean
  /** 并排面板时用于等高收口 */
  fill?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <section className={['panel', fill ? 'panel--fill' : '', className ?? ''].join(' ')}>
      {(title || actions) && (
        <header className="panel__head">
          {title && <span className="panel__title">{title}</span>}
          {actions && <div className="panel__actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'panel__body panel__body--flush' : 'panel__body'}>{children}</div>
    </section>
  )
}

/* ── 状态灯 ── */
export type LedTone = 'off' | 'ok' | 'warn' | 'error' | 'busy'

export function Led({ tone, label }: { tone: LedTone; label: ReactNode }): React.JSX.Element {
  return (
    <span className={`led${tone === 'off' ? '' : ` led--${tone}`}`}>
      <span className="led__dot" />
      {label}
    </span>
  )
}

/* ── 数据读数 ── */
export function Readouts({
  cols,
  children
}: {
  /** 列数按项目数显式给定：6 项用 3（两行三列），4 项用 4 */
  cols: number
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="readouts" style={{ '--cols': cols } as React.CSSProperties}>
      {children}
    </div>
  )
}

/** 值变化时闪一下底，把视线引到变化处（不做滚动计数器） */
function useFlash(value: string): boolean {
  const [on, setOn] = useState(false)
  const prev = useRef(value)

  useEffect(() => {
    if (prev.current === value) return
    prev.current = value
    setOn(true)
    const t = window.setTimeout(() => setOn(false), 480)
    return () => window.clearTimeout(t)
  }, [value])

  return on
}

export function Readout({
  label,
  value,
  hint,
  tone = 'none',
  small = false,
  mono = false,
  title
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'none' | 'ok' | 'warn' | 'error'
  small?: boolean
  /** 值为纯标识符（版本号 / 端口 / PID / 提交号）时用等宽体 */
  mono?: boolean
  title?: string
}): React.JSX.Element {
  const text = typeof value === 'string' ? value : String(value ?? '')
  const flash = useFlash(text)

  return (
    <div
      className={[
        'readout',
        tone === 'none' ? '' : `readout--${tone}`,
        flash ? 'readout--flash' : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="readout__label">{label}</div>
      <div
        className={[
          'readout__value',
          small ? 'readout__value--sm' : '',
          mono ? 'readout__value--mono' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        title={title ?? text}
      >
        {value}
      </div>
      {hint && <div className="readout__hint">{hint}</div>}
    </div>
  )
}

/* ── 标签 ── */
export function Tag({
  tone = 'none',
  children,
  title
}: {
  tone?: 'none' | 'ok' | 'warn' | 'error' | 'accent'
  children: ReactNode
  title?: string
}): React.JSX.Element {
  return (
    <span className={`tag${tone === 'none' ? '' : ` tag--${tone}`}`} title={title}>
      {children}
    </span>
  )
}

/* ── 提示条 ── */
export function Notice({
  tone = 'info',
  title,
  children,
  actions
}: {
  tone?: 'info' | 'ok' | 'warn' | 'error'
  title?: ReactNode
  children?: ReactNode
  actions?: ReactNode
}): React.JSX.Element {
  const glyph =
    tone === 'error' || tone === 'warn' ? CircleAlert : tone === 'ok' ? CircleCheck : Info

  return (
    <div className={`notice notice--${tone}`}>
      <span className="notice__icon">
        <Icon icon={glyph} size={15} />
      </span>
      <div className="notice__body">
        {title && <div className="notice__title">{title}</div>}
        {children && <div className="notice__text">{children}</div>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  )
}

/* ── 开关 ── */
export function Switch({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label className="switch" style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch__track" />
      {label}
    </label>
  )
}

/* ── 分段控件（页签条） ── */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="segmented" style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          className={`segmented__item${o.value === value ? ' segmented__item--active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ── 加载指示 ── */
export function Spinner({ label }: { label?: ReactNode }): React.JSX.Element {
  return (
    <span className="row muted" style={{ gap: 6 }}>
      <Icon icon={LoaderCircle} size={14} className="spin" />
      {label}
    </span>
  )
}

/* ── 空状态 ── */
export function Empty({
  icon,
  title,
  hint,
  actions
}: {
  icon?: Parameters<typeof Icon>[0]['icon']
  title: string
  hint?: ReactNode
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <div className="empty">
      {icon && (
        <span className="empty__icon">
          <Icon icon={icon} size={22} />
        </span>
      )}
      <div className="empty__title">{title}</div>
      {hint && <div className="empty__hint">{hint}</div>}
      {actions && <div className="empty__actions">{actions}</div>}
    </div>
  )
}

/* ── 进度条 ── */
export function Progress({ percent }: { percent: number | null }): React.JSX.Element {
  if (percent === null) {
    return (
      <div className="progress progress--indeterminate">
        <div className="progress__bar" />
      </div>
    )
  }
  return (
    <div className="progress">
      <div className="progress__bar" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  )
}

/* ── 日志终端 ── */
function timeOf(ts: number): string {
  const d = new Date(ts)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function Terminal({
  lines,
  height,
  autoScroll = true,
  emptyText = '暂无输出'
}: {
  lines: LogLine[]
  height?: number | string
  autoScroll?: boolean
  emptyText?: string
}): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  // 用户手动上滚时不强行拉回底部
  const onScroll = (): void => {
    const el = boxRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el || !autoScroll || !stickRef.current) return
    el.scrollTop = el.scrollHeight
  }, [lines, autoScroll])

  useEffect(() => {
    stickRef.current = true
  }, [])

  return (
    <div
      className="terminal"
      ref={boxRef}
      onScroll={onScroll}
      style={{ height: height ?? '100%', minHeight: 120 }}
    >
      {lines.length === 0 ? (
        <div className="terminal__empty">{emptyText}</div>
      ) : (
        lines.map((l, i) => (
          <div key={`${l.seq}-${i}`} className={`terminal__line terminal__line--${l.stream}`}>
            <span className="terminal__ts">{timeOf(l.ts)}</span>
            <span className="terminal__text">{l.text}</span>
          </div>
        ))
      )}
    </div>
  )
}

/* ── 模态框 ── */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 680,
  flush = false
}: {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  /** 表体留白归零：内部自带滚动区与吸顶表头时必须这样，否则滚动时内容会钻到内边距里 */
  flush?: boolean
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" style={{ width }} role="dialog" aria-modal="true">
        <header className="modal__head">
          <div className="modal__heading">
            <div className="modal__title">{title}</div>
            {subtitle && <div className="modal__subtitle">{subtitle}</div>}
          </div>
          <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="关闭">
            <Icon icon={X} size={15} />
          </button>
        </header>
        <div className={flush ? 'modal__body modal__body--flush' : 'modal__body'}>{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  )
}

