import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { get as httpGet } from 'node:http'
import { launchArgs } from '@shared/launchCommand'
import type { LaunchDefaults, LogLine, LogStream, ServiceStatus, Unsubscribe } from '@shared/types'
import { buildChildEnv } from '../lib/childEnv'
import { killTree, stripAnsi } from '../lib/exec'
import { resolveComfyPaths } from '../lib/paths'
import { settingsStore } from './settings'

/* ══════════════════════════════════════════════════════════
 * ComfyUI 服务进程管理
 *
 * 对齐官方便携版的启动方式：
 *   .\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build
 * 额外补充 --port，并支持 GPU/CPU 模式与自定义参数。
 * ══════════════════════════════════════════════════════════ */

const MAX_SERVICE_LINES = 3000
const READY_TIMEOUT_MS = 300_000
const READY_POLL_MS = 700

export class ServiceManager {
  private child: ChildProcess | null = null
  private state: ServiceStatus['state'] = 'stopped'
  private pid: number | null = null
  private ready = false
  private startedAt: number | null = null
  private exitedAt: number | null = null
  private exitCode: number | null = null
  private commandLine: string | null = null
  private lastError: string | null = null
  private bootMs: number | null = null
  private port = 8188
  /** 就绪探测与访问地址用的主机；开远程时可能是具体网卡 IP */
  private host = '127.0.0.1'

  private lines: LogLine[] = []
  private seq = 0
  private logListeners = new Set<(l: LogLine) => void>()
  private statusListeners = new Set<(s: ServiceStatus) => void>()
  private readyTimer: NodeJS.Timeout | null = null
  private readyDeadline = 0

  /* ── 订阅 ── */

  onLog(cb: (l: LogLine) => void): Unsubscribe {
    this.logListeners.add(cb)
    return () => this.logListeners.delete(cb)
  }

  onStatus(cb: (s: ServiceStatus) => void): Unsubscribe {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  getLogs(): LogLine[] {
    return this.lines.slice()
  }

  clearLogs(): void {
    this.lines = []
    this.seq = 0
  }

  status(): ServiceStatus {
    return {
      state: this.state,
      pid: this.pid,
      port: this.port,
      url: this.ready ? `http://${this.host}:${this.port}` : null,
      ready: this.ready,
      startedAt: this.startedAt,
      exitedAt: this.exitedAt,
      exitCode: this.exitCode,
      commandLine: this.commandLine,
      lastError: this.lastError,
      bootMs: this.bootMs
    }
  }

  private log(text: string, stream: LogStream = 'system'): void {
    const line: LogLine = { seq: ++this.seq, ts: Date.now(), stream, text: stripAnsi(text) }
    this.lines.push(line)
    if (this.lines.length > MAX_SERVICE_LINES) {
      this.lines.splice(0, this.lines.length - MAX_SERVICE_LINES)
    }
    for (const cb of this.logListeners) cb(line)
  }

  /**
   * 把非 ComfyUI 进程的输出也写进同一条日志流。
   * 任务系统（git clone / pip install / 版本切换）用它，控制台页才能看到完整记录。
   */
  logExternal(text: string, stream: LogStream = 'system'): void {
    this.log(text, stream)
  }

  private pushStatus(): void {
    const s = this.status()
    for (const cb of this.statusListeners) cb(s)
  }

  private setState(state: ServiceStatus['state']): void {
    this.state = state
    this.pushStatus()
  }

  /* ── 启动 ── */

  async start(override?: Partial<LaunchDefaults>): Promise<ServiceStatus> {
    if (this.child || this.state === 'launching' || this.state === 'running') {
      return this.status()
    }

    const settings = settingsStore.get()
    const cfg: LaunchDefaults = { ...settings.launch, ...(override ?? {}) }
    const paths = resolveComfyPaths(settings.comfyRoot)

    this.port = cfg.port
    /* 探测与「打开界面」都打这个地址：绑定到具体网卡时 127.0.0.1 是不通的 */
    this.host = accessHost(cfg)
    this.lastError = null
    this.exitCode = null
    this.exitedAt = null
    this.bootMs = null
    this.ready = false

    /* 端口占用预检：避免起来之后才发现被别人占了 */
    const free = await isPortFree(cfg.port)
    if (!free) {
      this.state = 'error'
      this.lastError = `端口 ${cfg.port} 已被占用，无法启动。请在设置中改用其他端口。`
      this.log(`[启动器] ${this.lastError}`, 'stderr')
      this.pushStatus()
      return this.status()
    }

    // 浏览器由 ComfyUI 自己开（--windows-standalone-build 在服务开始监听后调 call_on_start），
    // 只有设置里关掉「自动打开」时才传 --disable-auto-launch
    const args = launchArgs(cfg)
    this.commandLine = `${paths.pythonExe} ${args.join(' ')}`

    this.log(`[启动器] 工作目录：${paths.root}`)
    this.log(`[启动器] 命令：${this.commandLine}`)
    if (cfg.mode === 'cpu') this.log('[启动器] 模式：CPU（速度很慢，仅用于排障）')
    else this.log('[启动器] 模式：GPU')

    try {
      this.child = spawn(paths.pythonExe, args, {
        cwd: paths.root,
        env: buildChildEnv(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      this.state = 'error'
      this.lastError = `无法启动进程：${err instanceof Error ? err.message : String(err)}`
      this.log(`[启动器] ${this.lastError}`, 'stderr')
      this.pushStatus()
      return this.status()
    }

    this.pid = this.child.pid ?? null
    this.startedAt = Date.now()
    this.setState('launching')

    this.child.stdout?.setEncoding('utf-8')
    this.child.stderr?.setEncoding('utf-8')
    this.child.stdout?.on('data', (d: string) => this.ingest(d, 'stdout'))
    this.child.stderr?.on('data', (d: string) => this.ingest(d, 'stderr'))

    this.child.on('error', (err) => {
      this.lastError = `进程错误：${err.message}`
      this.log(`[启动器] ${this.lastError}`, 'stderr')
    })

    this.child.on('close', (code) => {
      this.child = null
      this.pid = null
      this.exitCode = code
      this.exitedAt = Date.now()
      this.ready = false
      this.stopReadyPoll()
      if (this.state === 'stopping') {
        this.log('[启动器] ComfyUI 已停止。')
        this.setState('stopped')
      } else if (code === 0) {
        this.log('[启动器] ComfyUI 进程已退出（退出码 0）。')
        this.setState('stopped')
      } else {
        this.lastError = `ComfyUI 异常退出，退出码 ${code}`
        this.log(`[启动器] ${this.lastError}`, 'stderr')
        this.setState('error')
      }
    })

    this.startReadyPoll()
    this.pushStatus()
    return this.status()
  }

  /* ── 停止 ── */

  async stop(): Promise<ServiceStatus> {
    if (!this.child) {
      this.ready = false
      if (this.state !== 'stopped') this.setState('stopped')
      return this.status()
    }
    this.setState('stopping')
    this.log('[启动器] 正在停止 ComfyUI…')
    const pid = this.child.pid
    killTree(pid)

    // 给进程树最多 8 秒优雅退出，超时则放弃等待（taskkill /F 已经是强杀）
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 8000)
      this.child?.once('close', () => {
        clearTimeout(t)
        resolve()
      })
    })

    if (this.child) {
      this.child = null
      this.pid = null
      this.ready = false
      this.exitedAt = Date.now()
      this.stopReadyPoll()
      this.setState('stopped')
    }
    return this.status()
  }

  /** 应用退出时调用，保证不留孤儿进程 */
  dispose(): void {
    this.stopReadyPoll()
    if (this.child?.pid) killTree(this.child.pid)
  }

  /* ── 输出解析 ── */

  private pending = ''

  private ingest(chunk: string, stream: LogStream): void {
    this.pending += chunk
    let idx: number
    while ((idx = this.pending.search(/\r\n|\n|\r/)) !== -1) {
      const line = this.pending.slice(0, idx)
      const sep = this.pending.slice(idx).match(/^\r\n|^\n|^\r/)?.[0] ?? ''
      this.pending = this.pending.slice(idx + sep.length)
      if (line.length > 0) this.handleLine(line, stream)
    }
    // 防止异常进程刷屏把内存吃光
    if (this.pending.length > 64 * 1024) this.pending = this.pending.slice(-8192)
  }

  private handleLine(line: string, stream: LogStream): void {
    this.log(line, stream)

    // 官方启动横幅会打印可直接访问的地址
    const m = line.match(/To see the GUI go to:\s*(https?:\/\/\S+)/i)
    if (m) {
      this.log(`[启动器] 检测到服务地址：${m[1]}`)
    }
  }

  /* ── 就绪探测 ── */

  private startReadyPoll(): void {
    this.stopReadyPoll()
    this.readyDeadline = Date.now() + READY_TIMEOUT_MS

    const tick = async (): Promise<void> => {
      if (!this.child || this.state === 'stopping') return

      if (await probeSystemStats(this.host, this.port)) {
        this.ready = true
        this.bootMs = this.startedAt ? Date.now() - this.startedAt : null
        this.log(
          `[启动器] ComfyUI 已就绪：http://${this.host}:${this.port}` +
            (this.bootMs ? `（启动耗时 ${(this.bootMs / 1000).toFixed(1)}s）` : '')
        )
        this.setState('running')
        return
      }

      if (Date.now() > this.readyDeadline) {
        this.lastError = `等待服务就绪超时（${READY_TIMEOUT_MS / 1000} 秒），请查看日志排查。`
        this.log(`[启动器] ${this.lastError}`, 'stderr')
        this.setState('error')
        return
      }

      this.readyTimer = setTimeout(() => void tick(), READY_POLL_MS)
    }

    void tick()
  }

  private stopReadyPoll(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
  }
}

/* ── 工具函数 ── */

/** 实际访问/探测用的主机：绑定 0.0.0.0 或没开远程时，回环地址才是通的 */
export function accessHost(launch: Pick<LaunchDefaults, 'remote' | 'listen'>): string {
  return launch.remote && launch.listen && launch.listen !== '0.0.0.0' ? launch.listen : '127.0.0.1'
}

/** 用 /system_stats 判断服务是否真的起来了 */
export function probeSystemStats(host: string, port: number, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpGet(
      { host, port, path: '/system_stats', timeout: timeoutMs },
      (res) => {
        res.resume()
        resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 500))
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

export const serviceManager = new ServiceManager()
