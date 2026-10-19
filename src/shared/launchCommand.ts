import type { LaunchDefaults } from './types'

/** 解析自定义参数，支持带引号的片段 */
export function tokenizeArgs(input: string): string[] {
  if (!input.trim()) return []
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return out.filter((s) => s.length > 0)
}

/** 与 ServiceManager.start 使用同一套参数，首页可在启动前预览 */
export function launchArgs(cfg: LaunchDefaults): string[] {
  const args = ['-s', 'ComfyUI\\main.py', '--windows-standalone-build', '--port', String(cfg.port)]
  if (cfg.mode === 'cpu') args.push('--cpu')
  // 不开远程就不传 --listen：ComfyUI 默认只监听 127.0.0.1
  if (cfg.remote) args.push('--listen', cfg.listen || '0.0.0.0')
  if (!cfg.autoOpenBrowser) args.push('--disable-auto-launch')
  if (cfg.fastFp16) args.push('--fast', 'fp16_accumulation')
  if (cfg.disableApiNodes) args.push('--disable-api-nodes')
  args.push(...tokenizeArgs(cfg.extraArgs))
  return args
}

export function launchCommand(pythonExe: string, cfg: LaunchDefaults): string {
  const args = launchArgs(cfg).join(' ')
  return pythonExe ? `${pythonExe} ${args}` : args
}
