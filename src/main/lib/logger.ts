import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/* ══════════════════════════════════════════════════════════
 * 启动期日志与崩溃捕获
 *
 * 打包后的 Electron 是 GUI 子系统程序，没有控制台，
 * 一旦主进程早期抛错就是「双击没反应」。因此这里把启动里程碑
 * 与未捕获异常/未处理拒绝统一落盘，用户可以直接把日志发出来。
 * ══════════════════════════════════════════════════════════ */

let logPath: string | null = null
/** 日志自身的重入保护：写日志失败时绝不能再写日志 */
let logging = false

/** 单个日志文件上限，超过就在启动时滚到 .1（长期使用不至于写出几十 MB） */
const MAX_LOG_BYTES = 8 * 1024 * 1024

/*
 * 打包后没有控制台，stdout/stderr 往往是断掉或无效的管道。
 * 往这种管道写会异步抛出 EPIPE，而 EPIPE 是流上的 error 事件 →
 * 不接住就变成 uncaughtException → 崩溃处理里再写日志 → 又一个 EPIPE，
 * 退出时进程就卡在这个死循环里：窗口和托盘都没了，单实例锁却一直不放，
 * 用户再双击图标只会撞上锁，看起来就是「整个应用再也打不开了」。
 * 这里先给两个流挂上空错误处理，管道断了就安静丢弃。
 */
for (const stream of [process.stdout, process.stderr]) {
  try {
    stream.on('error', () => {
      /* 管道断了就断了，日志不能反过来把进程拖死 */
    })
  } catch {
    /* 某些宿主下流不存在，忽略 */
  }
}

/** 日志文件过大就先滚一份，失败也不影响启动 */
function rotate(target: string): void {
  try {
    if (statSync(target).size < MAX_LOG_BYTES) return
    const prev = `${target}.1`
    rmSync(prev, { force: true })
    renameSync(target, prev)
  } catch {
    /* 文件还不存在或无法滚动，交给 appendFileSync 处理 */
  }
}

function resolveLogPath(): string {
  if (logPath) return logPath
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    logPath = join(dir, 'launcher.log')
    rotate(logPath)
  } catch {
    // userData 尚不可用时退回临时目录，保证任何阶段都能落盘
    logPath = join(tmpdir(), 'explorer-launcher.log')
  }
  return logPath
}

export function logToFile(label: string, detail?: unknown): void {
  if (logging) return
  logging = true
  try {
    const time = new Date().toISOString()
    let line = `[${time}] ${label}`
    if (detail !== undefined) {
      if (detail instanceof Error) {
        line += `\n  ${detail.name}: ${detail.message}\n  ${detail.stack ?? ''}`
      } else {
        try {
          line += ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
        } catch {
          line += ` ${String(detail)}`
        }
      }
    }
    line += '\n'

    try {
      appendFileSync(resolveLogPath(), line, 'utf-8')
    } catch {
      /* 落盘失败也不能影响启动 */
    }
    // dev 模式下同时输出到终端；管道已断开时静默丢弃
    try {
      process.stderr.write(line)
    } catch {
      /* 同上 */
    }
  } catch {
    /* 日志永远不能成为新的异常源 */
  } finally {
    logging = false
  }
}

export function installCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    logToFile('uncaughtException', err)
  })
  process.on('unhandledRejection', (reason) => {
    logToFile('unhandledRejection', reason)
  })
  app.on('render-process-gone', (_e, _wc, details) => {
    logToFile('render-process-gone', details)
  })
  app.on('child-process-gone', (_e, details) => {
    logToFile('child-process-gone', details)
  })
}
