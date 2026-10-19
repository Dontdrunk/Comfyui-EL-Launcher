/* ══════════════════════════════════════════════════════════
 * 品牌标识：16×16 像素网格上的北极星（指南针玫瑰）
 *
 * 像素图形必须落在整数格上，所以 viewBox 用 0 0 16 16 而不是 24×24 的
 * 任意小数坐标，再配 shape-rendering="crispEdges"，缩放时才不会糊边。
 * 填充色走 currentColor，跟随调用方的 --brand（暗色 #F0FF41 / 亮色 #B8C400）。
 *
 * 这份网格与 scripts/make-icon.py 的 STAR_RUNS 是同一份数据（76 个实心像素，
 * 中心留 2×2 针孔）。改一处必须同步另一处，否则标题栏图标和任务栏图标会对不上。
 * ══════════════════════════════════════════════════════════ */

/** 每行一条水平色带：M x y h 宽 v1 h-宽 z */
const STAR_PATH =
  'M7 1h2v1h-2zM7 2h2v1h-2zM6 3h4v1h-4zM6 4h4v1h-4zM5 5h6v1h-6zM4 6h8v1h-8z' +
  'M1 7h6v1h-6zM9 7h6v1h-6zM1 8h6v1h-6zM9 8h6v1h-6z' +
  'M4 9h8v1h-8zM5 10h6v1h-6zM6 11h4v1h-4zM6 12h4v1h-4zM7 13h2v1h-2zM7 14h2v1h-2z'

export function Logo({
  size = 22,
  className
}: {
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      shapeRendering="crispEdges"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={STAR_PATH} />
    </svg>
  )
}
