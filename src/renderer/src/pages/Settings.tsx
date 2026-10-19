import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { Folder, RefreshCw } from 'lucide'
import { Icon } from '../components/Icon'
import { Notice, Panel, Readout, Readouts, Spinner, Switch } from '../components/ui'
import { useApp } from '../store'

/* ══════════════════════════════════════════════════════════
 * 设置
 *
 * 文本类字段使用「本地草稿 + 失焦落盘」，开关与下拉即时落盘。
 * 这样既不会每敲一个字符写一次配置文件，也不会出现「改了没生效」。
 * ══════════════════════════════════════════════════════════ */

export default function Settings(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const env = useApp((s) => s.env)
  const envLoading = useApp((s) => s.envLoading)
  const patchSettings = useApp((s) => s.patchSettings)
  const refreshEnv = useApp((s) => s.refreshEnv)
  const probeRuntime = useApp((s) => s.probeRuntime)
  const runtime = useApp((s) => s.runtime)
  const runtimeLoading = useApp((s) => s.runtimeLoading)

  const [root, setRoot] = useState('')
  const [listen, setListen] = useState('')
  const [port, setPort] = useState('')
  const [extraArgs, setExtraArgs] = useState('')

  useEffect(() => {
    if (!settings) return
    setRoot(settings.comfyRoot)
    setListen(settings.launch.listen)
    setPort(String(settings.launch.port))
    setExtraArgs(settings.launch.extraArgs)
  }, [settings])

  if (!settings) return <Spinner label="读取配置…" />

  const patch = (p: Partial<AppSettings>): void => void patchSettings(p)
  const patchLaunch = (p: Partial<AppSettings['launch']>): void =>
    patch({ launch: { ...settings.launch, ...p } })
  /** 合法端口才落盘，避免输入过程中的半截数字（如 "81"）写进配置 */
  const commitPort = (): void => {
    const n = Number(port.trim())
    if (Number.isInteger(n) && n > 0 && n < 65536) patchLaunch({ port: n })
    else setPort(String(settings.launch.port))
  }

  const pickRoot = async (): Promise<void> => {
    const picked = await window.launcher.pickDirectory(root)
    if (!picked) return
    setRoot(picked)
    await patchSettings({ comfyRoot: picked })
    await refreshEnv(picked)
  }

  const commitRoot = async (): Promise<void> => {
    const next = root.trim()
    if (!next || next === settings.comfyRoot) return
    await patchSettings({ comfyRoot: next })
    await refreshEnv(next)
  }

  return (
    <>
      <Panel
        title="ComfyUI 目录"
        actions={
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              void refreshEnv()
              void probeRuntime()
            }}
            disabled={envLoading || runtimeLoading}
          >
            {envLoading || runtimeLoading ? <Spinner /> : <Icon icon={RefreshCw} size={14} />}
            全部重新检测
          </button>
        }
      >
        <div className="grid-2">
          <div className="field">
            <span className="field__label">便携版根目录</span>
            <div className="row">
              <input
                className="input"
                value={root}
                spellCheck={false}
                onChange={(e) => setRoot(e.target.value)}
                onBlur={() => void commitRoot()}
                placeholder="D:\Projects\Procedure\ComfyUI-X"
              />
              <button type="button" className="btn" onClick={() => void pickRoot()}>
                <Icon icon={Folder} size={14} />
                浏览
              </button>
            </div>
          </div>

          {/* 启动模式跟着环境走：有没有显卡、要不要退到 CPU，就是这个目录决定的事 */}
          <div className="field">
            <span className="field__label">启动模式</span>
            <select
              className="select"
              value={settings.launch.mode}
              onChange={(e) => patchLaunch({ mode: e.target.value === 'cpu' ? 'cpu' : 'gpu' })}
            >
              <option value="gpu">GPU 启动模式</option>
              <option value="cpu">CPU 启动模式</option>
            </select>
          </div>
        </div>

        <Readouts cols={4}>
          <Readout
            label="目录状态"
            value={env?.valid ? '有效' : '无效'}
            tone={env?.valid ? 'ok' : 'error'}
            hint={env?.portable ? '识别为便携版' : '未识别为便携版'}
          />
          <Readout
            label="ComfyUI 版本"
            value={env?.appVersion ?? '—'}
            hint={env?.isGitRepo ? 'git 仓库可用' : '缺少 .git'}
            tone={env?.isGitRepo ? 'ok' : 'warn'}
          />
          <Readout
            label="Python"
            value={runtimeLoading ? '…' : (runtime?.pythonVersion ?? '—')}
            tone={runtime?.probed ? (runtime.ok ? 'ok' : 'error') : 'none'}
          />
          <Readout
            label="GPU"
            value={runtimeLoading ? '…' : (runtime?.gpuName ?? '—')}
            small
            tone={runtime?.probed ? (runtime.cudaAvailable ? 'ok' : 'error') : 'none'}
            hint={runtime?.torchVersion ? `torch ${runtime.torchVersion}` : undefined}
          />
        </Readouts>

        {env && env.issues.length > 0 && (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            {env.issues.map((issue, i) => (
              <Notice
                key={i}
                tone={issue.level === 'error' ? 'error' : issue.level === 'warn' ? 'warn' : 'info'}
                title={issue.message}
              >
                {issue.hint}
              </Notice>
            ))}
          </div>
        )}
      </Panel>

      {/* ── 启动 ── */}
      <div className="section-title">启动设置</div>

      <Panel title="访问地址">
        <div className="grid-2">
          <div className="field">
            <span className="field__label">监听 IP</span>
            <input
              className="input"
              value={listen}
              disabled={!settings.launch.remote}
              spellCheck={false}
              placeholder="0.0.0.0"
              onChange={(e) => setListen(e.target.value)}
              onBlur={() => patchLaunch({ listen: listen.trim() })}
            />
          </div>

          <div className="field">
            <span className="field__label">监听端口</span>
            <input
              className="input"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onBlur={() => commitPort()}
            />
          </div>
        </div>

        <Switch
          checked={settings.launch.remote}
          onChange={(remote) => patchLaunch({ remote })}
          label="允许其它设备访问（--listen，会暴露到局域网）"
        />
      </Panel>

      <Panel title="启动行为">
        <Switch
          checked={settings.launch.autoOpenBrowser}
          onChange={(autoOpenBrowser) => patchLaunch({ autoOpenBrowser })}
          label="就绪后自动打开 Web 界面"
        />

        <div className="field" style={{ marginTop: 'var(--sp-3)' }}>
          <span className="field__label">附加启动参数</span>
          <input
            className="input"
            value={extraArgs}
            spellCheck={false}
            placeholder="--lowvram --preview-method auto"
            onChange={(e) => setExtraArgs(e.target.value)}
            onBlur={() => patchLaunch({ extraArgs })}
          />
        </div>
      </Panel>
    </>
  )
}
