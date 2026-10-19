/**
 * 补齐 Electron 运行时二进制（安装后与启动前都可调用）。
 *
 * 为什么需要它：electron 44 删掉了 postinstall，二进制改成「首次 require('electron') 时惰性下载」。
 * 但 electron-vite 不走 require，它直接读 electron/path.txt，读不到就抛
 *   Error: Electron uninstall
 * 于是全新（或残缺）的 node_modules 会让 dev / preview 在一秒内直接失败。
 *
 * install.js 自带 isInstalled() 检查，已装好时会立即 exit 0，所以重复调用是安全的。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

/** 确保运行时二进制就绪，返回是否成功。 */
export function ensureElectron() {
  let dir
  try {
    dir = dirname(require.resolve('electron'))
  } catch {
    return true // 没装 electron（例如 pnpm install --prod）不是错误
  }

  if (!existsSync(join(dir, 'path.txt'))) {
    console.log('[electron] 缺少运行时二进制，开始下载（镜像见 .npmrc 的 electron_mirror）…')
  }

  const res = spawnSync(process.execPath, [join(dir, 'install.js')], {
    cwd: dir,
    stdio: 'inherit'
  })

  if (res.error) {
    console.error(`[electron] 无法执行 install.js：${res.error.message}`)
    return false
  }
  if (res.status !== 0) {
    console.error(
      '[electron] 二进制下载失败：检查网络后重跑 pnpm install，' +
        '或手动执行 node node_modules/electron/install.js'
    )
    return false
  }
  return true
}

// 作为脚本直接执行时（package.json 的 postinstall）
const self = fileURLToPath(import.meta.url)
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(self).href) {
  process.exit(ensureElectron() ? 0 : 1)
}
