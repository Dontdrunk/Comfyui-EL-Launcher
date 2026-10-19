import { Database, Home, Package, Plug, Settings, Tag, Terminal } from 'lucide'
import type { PageId } from '../store'
import { useApp } from '../store'
import { Icon, type IconNode } from './Icon'

/* ══════════════════════════════════════════════════════════
 * 侧边栏 —— 对应原版 pages/index.html 的 el-aside(width=85px)
 *
 * 上组：业务页面（首页 / 版本 / 插件 / 模型 / 环境管理）
 * 下组 ul.szqu：控制台 / 设置，绝对定位吸底
 * 每项 65×65、圆角 12px、图标 22px 在上、13px 文案在下。
 *
 * 一个功能只有一个家：曾经收在「更多」页里的四个入口直接平铺到这里，
 * 不再套一层中转页。
 * ══════════════════════════════════════════════════════════ */

interface NavEntry {
  id: PageId
  label: string
  icon: IconNode
}

const TOP: NavEntry[] = [
  { id: 'dashboard', label: '首页', icon: Home },
  { id: 'versions', label: '版本管理', icon: Tag },
  { id: 'nodes', label: '插件管理', icon: Plug },
  { id: 'models', label: '模型管理', icon: Database },
  { id: 'packages', label: '环境管理', icon: Package }
]

const BOTTOM: NavEntry[] = [
  { id: 'logs', label: '控制台', icon: Terminal },
  { id: 'settings', label: '设置', icon: Settings }
]

function Item({ entry, active, onClick }: { entry: NavEntry; active: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className={'navitem' + (active ? ' navitem--active' : '')}
      data-href={entry.id}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      <Icon icon={entry.icon} size={22} />
      <span>{entry.label}</span>
    </button>
  )
}

export function Sidebar(): React.JSX.Element {
  const page = useApp((s) => s.page)
  const setPage = useApp((s) => s.setPage)

  return (
    <aside className="sidebar">
      <nav className="sidebar__nav">
        <ul className="sidebar__group">
          {TOP.map((e) => (
            <li key={e.id} style={{ display: 'contents' }}>
              <Item entry={e} active={page === e.id} onClick={() => setPage(e.id)} />
            </li>
          ))}
        </ul>

        <ul className="sidebar__group sidebar__group--bottom">
          {BOTTOM.map((e) => (
            <li key={e.id} style={{ display: 'contents' }}>
              <Item entry={e} active={page === e.id} onClick={() => setPage(e.id)} />
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
