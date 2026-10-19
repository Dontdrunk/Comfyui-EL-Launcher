import { CircleAlert, CircleCheck, Info, X } from 'lucide'
import { useApp } from '../store'
import { Icon } from './Icon'

/* ══════════════════════════════════════════════════════════
 * 全局轻提示
 *
 * 装插件、装依赖、卸载、批量更新这类操作是「后台跑完才有结果」的，
 * 用户不一定还停在那一页，所以结果统一在窗口顶部冒一条，几秒后自己消失。
 * 这里只说结论。过程与报错原文在控制台。
 * ══════════════════════════════════════════════════════════ */

const GLYPH = { ok: CircleCheck, warn: CircleAlert, error: CircleAlert, info: Info } as const

export function Toasts(): React.JSX.Element | null {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`}>
          <span className="toast__icon">
            <Icon icon={GLYPH[t.tone]} size={15} />
          </span>
          <span className="toast__text">{t.text}</span>
          <button type="button" className="toast__close" aria-label="关闭" onClick={() => dismiss(t.id)}>
            <Icon icon={X} size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
