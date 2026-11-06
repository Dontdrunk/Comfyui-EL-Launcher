/**
 * 「依赖」列状态圆点的判定（纯逻辑，方便单测）。
 *
 * 绿 = 声明的依赖全都装好了
 * 黄 = 部分缺失
 * 红 = 声明的依赖一个都没装上
 * 灰 = 未声明依赖 / 还没检查完 / 检查失败
 */

/**
 * @param {boolean} hasRequirements 插件是否声明了 requirements.txt
 * @param {{ total: number, missing: number, error?: string | null } | null | undefined} summary
 * @returns {{ tone: 'idle' | 'ok' | 'warn' | 'error', hint: string } | null} null = 不显示圆点
 */
export function depDot(hasRequirements, summary) {
  if (!hasRequirements) return null
  if (!summary) return { tone: 'idle', hint: '正在检查依赖…' }
  if (summary.error) return { tone: 'idle', hint: `依赖检查失败：${summary.error}` }

  const total = Number(summary.total) || 0
  const missing = Number(summary.missing) || 0

  if (total === 0) return { tone: 'idle', hint: '没有声明 Python 依赖' }
  if (missing === 0) return { tone: 'ok', hint: `依赖已全部安装（${total}/${total}）` }
  if (missing >= total) return { tone: 'error', hint: `依赖全部缺失（${missing}/${total}）` }
  return { tone: 'warn', hint: `缺少 ${missing} 个依赖（共 ${total}）` }
}
