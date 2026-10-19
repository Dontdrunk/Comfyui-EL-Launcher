import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 应用图标路径。
 * 开发时读仓库 build/icon.ico；打包后读 extraResources 放到 resources 根目录的那份。
 * 托盘和窗口共用这一份，避免任务栏和右下角各长一张脸。
 */
export function resolveAppIcon(): string | null {
  const candidates = [
    join(process.resourcesPath, 'icon.ico'),
    join(app.getAppPath(), 'build', 'icon.ico'),
    // 主进程打成单文件后 __dirname 是 out/main
    join(__dirname, '../build/icon.ico')
  ]
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  return null
}
