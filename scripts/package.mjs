/**
 * 打包脚本包装器。
 *
 * 做两件事：
 *  1. 剔除 ELECTRON_RUN_AS_NODE —— 宿主环境带了这个变量会让 electron.exe 退化成 Node
 *  2. 指定 electron-builder 二进制的国内镜像（NSIS / winCodeSign 等资源），
 *     否则从 GitHub 拉取会非常慢甚至失败
 *
 * 用法：node scripts/package.mjs [额外的 electron-builder 参数]
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE

// 允许用户覆盖；默认走 npmmirror
env.ELECTRON_BUILDER_BINARIES_MIRROR ??=
  'https://registry.npmmirror.com/-/binary/electron-builder-binaries/'

const cli = join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')

const child = spawn(
  process.execPath,
  [cli, '--win', '--x64', '--publish', 'never', ...process.argv.slice(2)],
  {
    cwd: root,
    env,
    stdio: 'inherit'
  }
)

/** electron-builder 的 latest.yml 只列安装包。便携版也要写进去，否则便携版点更新找不到文件。 */
function includePortable(dir) {
  const ymlPath = join(dir, 'latest.yml')
  const text = readFileSync(ymlPath, 'utf8')
  const version = text.match(/^version:\s*(\S+)/m)?.[1]
  if (!version) return
  const portable = `ExplorerLauncher-${version}-portable.exe`
  if (text.includes(portable)) return
  const file = join(dir, portable)
  const sha512 = createHash('sha512').update(readFileSync(file)).digest('base64')
  const size = statSync(file).size
  const entry = `  - url: ${portable}\n    sha512: ${sha512}\n    size: ${size}\n`
  writeFileSync(ymlPath, text.replace(/^path:/m, `${entry}path:`))
}

child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else {
    if (code === 0) includePortable(join(root, 'release'))
    process.exit(code ?? 0)
  }
})
