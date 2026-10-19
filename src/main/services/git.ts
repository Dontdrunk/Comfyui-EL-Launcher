import type { LogStream } from '@shared/types'
import { buildChildEnv } from '../lib/childEnv'
import { run, type RunOptions, type RunResult } from '../lib/exec'

/* ══════════════════════════════════════════════════════════
 * git 底层封装
 *
 * 全部命令都在 ComfyUI 目录内执行（该目录本身就是仓库根），
 * 保证 git 绝不交互式等待输入。
 * ══════════════════════════════════════════════════════════ */

export interface GitOptions {
  onLine?: (stream: LogStream, text: string) => void
  timeoutMs?: number
  signal?: AbortSignal
}

/** 执行 git 命令，返回原始结果 */
export async function gitRaw(
  comfyDir: string,
  args: string[],
  opts: GitOptions = {}
): Promise<RunResult> {
  const runOpts: RunOptions = {
    cwd: comfyDir,
    env: buildChildEnv(),
    timeoutMs: opts.timeoutMs ?? 300_000,
    signal: opts.signal,
    onLine: opts.onLine
  }
  return run('git', args, runOpts)
}

export class GitError extends Error {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  constructor(message: string, r: RunResult) {
    super(message)
    this.name = 'GitError'
    this.code = r.code
    this.stdout = r.stdout
    this.stderr = r.stderr
  }
}

/** 执行 git 命令并要求成功，返回 stdout（已 trim） */
export async function git(
  comfyDir: string,
  args: string[],
  opts: GitOptions = {}
): Promise<string> {
  const r = await gitRaw(comfyDir, args, opts)
  if (r.spawnError) {
    throw new GitError(`无法执行 git：${r.spawnError}。请确认已安装 Git 并加入 PATH。`, r)
  }
  if (r.timedOut) throw new GitError(`git ${args[0]} 执行超时`, r)
  if (r.aborted) throw new GitError('git 操作已取消', r)
  if (r.code !== 0) {
    const detail = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-6).join('\n')
    throw new GitError(`git ${args.join(' ')} 失败（退出码 ${r.code}）${detail ? `\n${detail}` : ''}`, r)
  }
  return r.stdout.trim()
}

/** 执行 git 命令，失败时返回 null 而不是抛错 */
export async function gitSoft(
  comfyDir: string,
  args: string[],
  opts: GitOptions = {}
): Promise<string | null> {
  const r = await gitRaw(comfyDir, args, opts)
  if (r.code !== 0 || r.spawnError) return null
  return r.stdout.trim()
}

/** 探测 git 是否可用 */
export async function gitAvailable(): Promise<{ ok: boolean; version: string | null; error: string | null }> {
  const r = await run('git', ['--version'], { env: buildChildEnv(), timeoutMs: 15_000 })
  if (r.spawnError) {
    return { ok: false, version: null, error: `找不到 git 可执行文件：${r.spawnError}` }
  }
  if (r.code !== 0) return { ok: false, version: null, error: `git --version 退出码 ${r.code}` }
  return { ok: true, version: r.stdout.trim(), error: null }
}
