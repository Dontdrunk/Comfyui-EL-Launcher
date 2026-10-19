import { spawn } from 'node:child_process'
import type { LogStream } from '@shared/types'

/* ══════════════════════════════════════════════════════════
 * 子进程执行封装
 *
 * 设计要点：
 *  - 实时行流式回调（git pull / pip install 需要边跑边看）
 *  - UTF-8 解码 + 中文 Windows 控制台 GBK 兜底
 *  - 超时 / 主动取消 / Windows 进程树终止
 * ══════════════════════════════════════════════════════════ */

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  signal?: AbortSignal
  /** 每产出一行就回调（已按 \n / \r 切分，不含行尾符） */
  onLine?: (stream: LogStream, text: string) => void
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  /** 进程启动本身失败（如命令不存在） */
  spawnError: string | null
}

/* ── 行解码器：处理多字节字符跨 chunk 与 GBK 兜底 ── */
class LineDecoder {
  private utf8 = new TextDecoder('utf-8')
  private gbk: TextDecoder | null = null
  private buf = ''

  push(chunk: Buffer): string[] {
    let text = this.utf8.decode(chunk, { stream: true })

    // 不是合法 UTF-8 → 尝试按 GBK（Windows 中文控制台默认代码页）重解
    if (text.includes('\uFFFD')) {
      try {
        this.gbk ??= new TextDecoder('gbk')
        const alt = this.gbk.decode(chunk)
        if (!alt.includes('\uFFFD')) {
          text = alt
          // 解码器状态可能已错位，重置以免污染后续输出
          this.utf8 = new TextDecoder('utf-8')
        }
      } catch {
        /* 保留 UTF-8 结果 */
      }
    }

    this.buf += text
    return this.take()
  }

  flush(): string[] {
    this.buf += this.utf8.decode()
    const out = this.take()
    if (this.buf.length > 0) {
      out.push(this.buf)
      this.buf = ''
    }
    return out
  }

  /** 按 \r\n / \n / \r 切分，保留最后一段不完整行 */
  private take(): string[] {
    const out: string[] = []
    let idx: number
    while ((idx = this.buf.search(/\r\n|\n|\r/)) !== -1) {
      const line = this.buf.slice(0, idx)
      const sep = this.buf.slice(idx).match(/^\r\n|^\n|^\r/)?.[0] ?? ''
      this.buf = this.buf.slice(idx + sep.length)
      out.push(stripAnsi(line))
    }
    return out
  }
}

/** 去掉终端颜色/光标控制序列，避免日志面板出现乱码 */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001B\][^\u0007]*\u0007/g, '')
}

/* ── 执行一个命令并等待结束 ── */
export function run(cmd: string, args: string[] = [], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      resolve({
        code: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
        spawnError: err instanceof Error ? err.message : String(err)
      })
      return
    }

    const outDec = new LineDecoder()
    const errDec = new LineDecoder()
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let aborted = false
    let settled = false

    const emit = (stream: LogStream, lines: string[]): void => {
      if (!opts.onLine) return
      for (const l of lines) opts.onLine(stream, l)
    }

    const finish = (code: number | null, spawnError: string | null = null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      /*
       * 收尾：解码器里可能还压着最后一行（命令输出往往没有结尾换行，
       * 例如 git log --pretty=format:）。它既要进日志回调，也要并回 stdout，
       * 否则调用方会安静地少一行。
       */
      const restOut = outDec.flush()
      const restErr = errDec.flush()
      for (const l of restOut) stdout += l + '\n'
      for (const l of restErr) stderr += l + '\n'
      emit('stdout', restOut)
      emit('stderr', restErr)
      resolve({ code, stdout, stderr, timedOut, aborted, spawnError })
    }

    child.stdout?.on('data', (b: Buffer) => {
      const lines = outDec.push(b)
      for (const l of lines) stdout += l + '\n'
      emit('stdout', lines)
    })
    child.stderr?.on('data', (b: Buffer) => {
      const lines = errDec.push(b)
      for (const l of lines) stderr += l + '\n'
      emit('stderr', lines)
    })

    child.on('error', (err) => finish(null, err.message))
    child.on('close', (code) => finish(code))
    /*
     * Windows 上 git 退出后，凭据助手或 ssh 有时还占着 stdout/stderr。
     * Node 的 close 要等这些管道都关掉才触发，进程列表里已经没有 git 了，
     * 任务却一直停在 running，底部进度条就停不下来。
     * exit 之后留一小段时间把剩余输出刷完；再不来 close 就主动收尾。
     */
    child.on('exit', (code) => {
      const grace = setTimeout(() => {
        child.stdout?.destroy()
        child.stderr?.destroy()
        finish(code)
      }, 400)
      child.once('close', () => clearTimeout(grace))
    })

    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            killTree(child.pid)
          }, opts.timeoutMs)
        : (undefined as unknown as NodeJS.Timeout)

    const onAbort = (): void => {
      aborted = true
      killTree(child.pid)
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/* ── Windows 下终止整棵进程树 ── */
export function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        detached: false
      })
    } catch {
      /* 尽力而为 */
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* 进程可能已退出 */
      }
    }
  }
}
