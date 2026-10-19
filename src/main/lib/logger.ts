import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
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

function resolveLogPath(): string {
  if (logPath) return logPath
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    logPath = join(dir, 'launcher.log')
  } catch {
    // userData 尚不可用时退回临时目录，保证任何阶段都能落盘
    logPath = join(tmpdir(), 'explorer-launcher.log')
  }
  return logPath
}

export function logToFile(label: string, detail?: unknown): void {
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
  // dev 模式下同时输出到终端
  process.stderr.write(line)
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
