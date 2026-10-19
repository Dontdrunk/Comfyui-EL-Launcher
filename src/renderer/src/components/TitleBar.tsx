import { useEffect, useState } from 'react'
import { FolderOpen, Link2, Minus, Moon, RotateCw, Sun, Square, X } from 'lucide'
import { APP_VERSION } from '../lib/appVersion'
import { useApp } from '../store'
import { Logo } from './Brand'
import { Icon } from './Icon'

/* ══════════════════════════════════════════════════════════
 * 标题栏 —— 对应原版 pages/index.html 的 .el-header
 *
 * 结构：.hd(标识) + .yidonqu(拖动区) + .caidan(右侧图标条)
 * 窗口为无边框(frame:false)，最小化/最大化/关闭由这里自绘，
 * 与原版 #zuixiaohua / #qquanpin / #closewin 三个按钮一致。
 * ══════════════════════════════════════════════════════════ */

export function TitleBar(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const service = useApp((s) => s.service)
  const toggleTheme = useApp((s) => s.toggleTheme)
  const [maximized, setMaximized] = useState(false)

  const isDark = settings?.theme !== 'light'

  useEffect(() => {
    void window.launcher.isWindowMaximized().then(setMaximized)
  }, [])

  const openComfy = (): void => {
    if (service?.url) void window.launcher.openExternal(service.url)
  }

  return (
    <header className="titlebar">
      <div className="titlebar__logo">
        <span style={{ color: 'var(--brand)', display: 'flex' }}>
          <Logo size={32} />
        </span>
        <span className="titlebar__name">探索者启动器</span>
        <span className="titlebar__ver">v{APP_VERSION}</span>
      </div>

      <div className="titlebar__drag" />

      <div className="titlebar__actions">
        <button
          type="button"
          id="toggle-dark-mode"
          onClick={() => void toggleTheme()}
          title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
          aria-label="切换主题"
        >
          <Icon icon={isDark ? Sun : Moon} size={15} />
        </button>

        <button
          type="button"
          id="webui"
          onClick={openComfy}
          disabled={!service?.url}
          title="用浏览器打开Comfyui"
          aria-label="用浏览器打开 ComfyUI"
          style={service?.url ? undefined : { opacity: 0.4, cursor: 'default' }}
        >
          <Icon icon={Link2} size={15} />
        </button>

        <button
          type="button"
          onClick={() => settings?.comfyRoot && void window.launcher.openPath(settings.comfyRoot)}
          title="打开根目录"
          aria-label="打开根目录"
        >
          <Icon icon={FolderOpen} size={15} />
        </button>

        <button type="button" id="chonqi" onClick={() => window.location.reload()} title="刷新" aria-label="刷新">
          <Icon icon={RotateCw} size={15} />
        </button>

        <button
          type="button"
          id="zuixiaohua"
          onClick={() => void window.launcher.windowMinimize()}
          title="最小化"
          aria-label="最小化"
        >
          <Icon icon={Minus} size={15} />
        </button>

        <button
          type="button"
          id="qquanpin"
          onClick={() => void window.launcher.windowMaximize().then(setMaximized)}
          title={maximized ? '向下还原' : '最大化'}
          aria-label={maximized ? '向下还原' : '最大化'}
        >
          <Icon icon={Square} size={13} />
        </button>

        <button
          type="button"
          id="closewin"
          className="is-danger"
          onClick={() => void window.launcher.windowClose()}
          title="关闭"
          aria-label="关闭"
        >
          <Icon icon={X} size={15} />
        </button>
      </div>
    </header>
  )
}
