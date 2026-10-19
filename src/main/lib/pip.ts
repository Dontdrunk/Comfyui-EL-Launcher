import type { LogStream, PipPackage } from '@shared/types'
import { buildChildEnv } from './childEnv'
import { run, type RunResult } from './exec'

/* ══════════════════════════════════════════════════════════
 * pip 安装
 *
 * 实测（同一台机器、同一时刻，拉 opencv 的 41.8MB 轮子）：
 *   直连 pypi.org → 0.16 MB/s；清华镜像 → 6.8 MB/s；阿里云 → 0.42 MB/s
 * 所以默认走清华，镜像失败（网络抖动 / 单个包 403 / 缺包）再退回官方源重试一次。
 * 要换源就改下面这个常量。
 * ══════════════════════════════════════════════════════════ */

const PIP_INDEX = 'https://pypi.tuna.tsinghua.edu.cn/simple'
const PIP_INDEX_OFFICIAL = 'https://pypi.org/simple'

export interface PipOptions {
  cwd?: string
  onLine?: (s: LogStream, t: string) => void
  timeoutMs?: number
  signal?: AbortSignal
}

/** 用 `-r 文件` 装依赖；返回最后一次尝试的结果（调用方照旧判断 code / timedOut） */
export async function pipInstall(
  pythonExe: string,
  requirementsFile: string,
  opts: PipOptions = {}
): Promise<RunResult> {
  const args = ['-s', '-m', 'pip', 'install', '-r', requirementsFile]
  const base: PipOptions = {
    cwd: opts.cwd,
    onLine: opts.onLine,
    timeoutMs: opts.timeoutMs ?? 1_800_000,
    signal: opts.signal
  }
  return pipRun(pythonExe, args, base)
}

/** 装单个包（依赖浮层里那一行的「安装 / 重装」）；specs 形如 ["pillow>=11.0.0"] */
export async function pipInstallPackages(
  pythonExe: string,
  specs: string[],
  opts: PipOptions = {}
): Promise<RunResult> {
  const args = ['-s', '-m', 'pip', 'install', '--upgrade', ...specs]
  return pipRun(pythonExe, args, {
    cwd: opts.cwd,
    onLine: opts.onLine,
    timeoutMs: opts.timeoutMs ?? 600_000,
    signal: opts.signal
  })
}

/** 镜像优先、失败退回官方源（超时/取消/启动失败不重试） */
async function pipRun(pythonExe: string, args: string[], base: PipOptions): Promise<RunResult> {
  // 把用的源写进任务日志：以后嫌慢/装不上，一眼能看出走的哪个源
  base.onLine?.('system', `[依赖] 索引源：${PIP_INDEX}`)

  const first = await run(pythonExe, args, {
    ...base,
    env: { ...buildChildEnv(), PIP_INDEX_URL: PIP_INDEX }
  })

  // 启动失败/超时/被取消都跟镜像无关，不值得再等一遍
  if (first.code === 0 || first.spawnError || first.timedOut || first.aborted) return first

  base.onLine?.('system', `[依赖] 镜像源失败（退出码 ${first.code}），改用官方 PyPI 重试…`)
  return run(pythonExe, args, {
    ...base,
    env: { ...buildChildEnv(), PIP_INDEX_URL: PIP_INDEX_OFFICIAL }
  })
}

/** 列出已安装的包。本地查询，不走镜像、不进安装重试。 */
export async function pipList(pythonExe: string, opts: PipOptions = {}): Promise<PipPackage[]> {
  const r = await run(pythonExe, ['-s', '-m', 'pip', 'list', '--format=json'], {
    cwd: opts.cwd,
    onLine: opts.onLine,
    timeoutMs: opts.timeoutMs ?? 90_000,
    signal: opts.signal,
    env: buildChildEnv()
  })
  assertPipOk(r, '读取已安装的包')
  return parsePipList(r.stdout)
}

/** 卸载一个包。`-y` 避免 pip 停下来等确认。 */
export async function pipUninstall(
  pythonExe: string,
  name: string,
  opts: PipOptions = {}
): Promise<RunResult> {
  return run(pythonExe, ['-s', '-m', 'pip', 'uninstall', '-y', name], {
    cwd: opts.cwd,
    onLine: opts.onLine,
    timeoutMs: opts.timeoutMs ?? 180_000,
    signal: opts.signal,
    env: buildChildEnv()
  })
}

/**
 * 按当前版本强制重装。
 * 只写 `name==version` 时，包已在环境里 pip 会回 already satisfied，按钮等于没按。
 */
export async function pipReinstall(
  pythonExe: string,
  name: string,
  version: string,
  opts: PipOptions = {}
): Promise<RunResult> {
  return pipRun(pythonExe, ['-s', '-m', 'pip', 'install', '--force-reinstall', `${name}==${version}`], {
    cwd: opts.cwd,
    onLine: opts.onLine,
    timeoutMs: opts.timeoutMs ?? 600_000,
    signal: opts.signal
  })
}

/**
 * 安装一条规格（`onnxruntime`、`onnxruntime>=1.17`）或一个本地 whl。
 * requirements.txt 走 `pipInstall`。
 */
export async function pipInstallSpec(
  pythonExe: string,
  target: string,
  opts: PipOptions = {}
): Promise<RunResult> {
  return pipRun(pythonExe, ['-s', '-m', 'pip', 'install', target], {
    cwd: opts.cwd,
    onLine: opts.onLine,
    timeoutMs: opts.timeoutMs ?? 600_000,
    signal: opts.signal
  })
}

export function assertPipOk(result: RunResult, action: string): void {
  if (result.spawnError) throw new Error(`无法启动 pip：${result.spawnError}`)
  if (result.timedOut) throw new Error(`${action}超时`)
  if (result.aborted) throw new Error(`${action}已取消`)
  if (result.code !== 0) {
    const tail = (result.stderr || result.stdout).trim().split(/\r?\n/).slice(-8).join('\n')
    throw new Error(`${action}失败（退出码 ${result.code}）${tail ? `\n${tail}` : ''}`)
  }
}

/** pip 发行名：字母数字开头，其余只允许 `.` `_` `-` */
export function isPackageName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,213}$/.test(name)
}

/** 从 `pip list --format=json` 的 stdout 里抠出数组。stderr 上的警告不进这份输出。 */
function parsePipList(stdout: string): PipPackage[] {
  const start = stdout.indexOf('[')
  const end = stdout.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('pip list 没有返回包列表')

  let raw: unknown
  try {
    raw = JSON.parse(stdout.slice(start, end + 1))
  } catch {
    throw new Error('无法解析 pip list 的输出')
  }
  if (!Array.isArray(raw)) throw new Error('pip list 的输出不是列表')

  const out: PipPackage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as { name?: unknown; version?: unknown }
    if (typeof rec.name !== 'string' || typeof rec.version !== 'string') continue
    if (!isPackageName(rec.name)) continue
    out.push({ name: rec.name, version: rec.version })
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  return out
}
