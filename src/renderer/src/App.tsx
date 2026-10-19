import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { StatusRail } from './components/StatusRail'
import { Toasts } from './components/Toasts'
import { TitleBar } from './components/TitleBar'
import { Logo } from './components/Brand'
import { Notice } from './components/ui'
import Dashboard from './pages/Dashboard'
import Logs from './pages/Logs'
import Models from './pages/Models'
import Nodes from './pages/Nodes'
import Packages from './pages/Packages'
import Settings from './pages/Settings'
import Versions from './pages/Versions'
import { useApp, type PageId } from './store'

function renderPage(page: PageId): React.JSX.Element {
  switch (page) {
    case 'dashboard':
      return <Dashboard />
    case 'versions':
      return <Versions />
    case 'nodes':
      return <Nodes />
    case 'models':
      return <Models />
    case 'packages':
      return <Packages />
    case 'logs':
      return <Logs />
    case 'settings':
      return <Settings />
    default:
      return <Dashboard />
  }
}

/** 引导中：一行状态 + 发丝进度线，不做开机动画 */
function Splash(): React.JSX.Element {
  return (
    <div
      style={{
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg-canvas)',
        color: 'var(--fg-muted)'
      }}
    >
      <div style={{ width: 220, textAlign: 'center' }}>
        <div style={{ color: 'var(--brand)', display: 'flex', justifyContent: 'center' }}>
          <Logo size={32} />
        </div>
        <div style={{ marginTop: 12, fontSize: 'var(--fs-sm)' }}>正在读取配置…</div>
        <div className="progress progress--indeterminate" style={{ marginTop: 10 }}>
          <div className="progress__bar" />
        </div>
      </div>
    </div>
  )
}

export default function App(): React.JSX.Element {
  const booted = useApp((s) => s.booted)
  const bootError = useApp((s) => s.bootError)
  const page = useApp((s) => s.page)
  const setPage = useApp((s) => s.setPage)

  useEffect(() => {
    void useApp.getState().boot()
  }, [])

  // 供无人值守截图脚本切换路由
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent).detail
      if (typeof detail === 'string') setPage(detail as PageId)
    }
    window.addEventListener('xl:navigate', handler)
    return () => window.removeEventListener('xl:navigate', handler)
  }, [setPage])

  if (!booted) return <Splash />

  return (
    <div className="app">
      <TitleBar />
      <div className="app__body">
        <Sidebar />
        <main className="app__main">
          <div className="app__page">
            {bootError && (
              <div style={{ marginBottom: 'var(--sp-4)' }}>
                <Notice tone="error" title="启动异常">
                  {bootError}
                </Notice>
              </div>
            )}
            {renderPage(page)}
          </div>
        </main>
      </div>
      <StatusRail />
      <Toasts />
    </div>
  )
}
