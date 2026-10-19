import { MorphIcon } from 'morphicons/react'
import type { IconNode } from 'morphicons/react'

/* ══════════════════════════════════════════════════════════
 * 图标：Lucide 数据 + morphicons 形变
 *
 * 图标来自 `lucide`（数据包，可 tree-shake），由 MorphIcon 渲染。
 * 传静态图标时它就是普通图标；当 `icon` 换成另一个图标时，
 * 它以弹簧物理做形变——只用在真实状态对（播放↔停止、日月、箭头翻转）。
 *
 * spring="smooth" 是临界阻尼（无回弹），符合仪表面板的手感。
 * reducedMotion="user" 尊重系统「减少动效」：开启时形变退化为瞬时切换。
 * 方头直角由 global.css 的 .ic 规则统一覆盖。
 * ══════════════════════════════════════════════════════════ */

export type { IconNode }

export interface IconProps {
  icon: IconNode
  size?: number
  strokeWidth?: number
  className?: string
  /** 传了就变成 role="img" + <title>；不传则 aria-hidden（纯装饰） */
  label?: string
}

export function Icon({
  icon: node,
  size = 16,
  strokeWidth = 1.5,
  className,
  label
}: IconProps): React.JSX.Element {
  return (
    <MorphIcon
      icon={node}
      size={size}
      strokeWidth={strokeWidth}
      spring="smooth"
      reducedMotion="user"
      label={label}
      className={className ? `ic ${className}` : 'ic'}
    />
  )
}
