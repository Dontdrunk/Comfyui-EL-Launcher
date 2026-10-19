import { Trash2 } from 'lucide'
import { Icon } from '../components/Icon'
import { Empty, Panel, Tag, Terminal } from '../components/ui'
import { formatServiceState } from '../lib/format'
import { useApp } from '../store'

/* ══════════════════════════════════════════════════════════
 * 日志中心
 *
 * 数据源与「总览与启动」共用同一个环形缓冲（主进程 3000 行）。
 * 刻意不做过滤/检索那一排控件：控制台就该是一块终端 + 一个清空，
 * 想找回上下文就往上翻（日志本来就是按时间读的）。
 * ══════════════════════════════════════════════════════════ */

export default function Logs(): React.JSX.Element {
  const logs = useApp((s) => s.logs)
  const clearLogs = useApp((s) => s.clearLogs)
  const service = useApp((s) => s.service)

  return (
    <Panel
      fill
      flush
      actions={
        <>
          <Tag tone={service?.state === 'running' ? 'ok' : 'none'}>
            {formatServiceState(service?.state)}
          </Tag>
          <button type="button" className="btn btn--sm" onClick={() => void clearLogs()}>
            <Icon icon={Trash2} size={13} />
            清空
          </button>
        </>
      }
    >
      <div style={{ padding: 'var(--sp-2)' }}>
        {logs.length === 0 ? (
          <Empty
            title="暂无日志"
            hint="启动 ComfyUI 的进程输出，以及插件更新、安装、版本切换的过程，都记在这里。"
          />
        ) : (
          <Terminal lines={logs} />
        )}
      </div>
    </Panel>
  )
}
