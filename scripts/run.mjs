/**
 * electron-vite CLI 包装器。
 *
 * 为什么需要它：本机环境（DSH 宿主）全局设置了 ELECTRON_RUN_AS_NODE=1，
 * 这会让 electron.exe 退化为纯 Node 进程，导致 dev 模式起不来窗口。
 * 此脚本在派生子进程前剔除该变量，保证在“宿主环境”和“用户普通终端”下行为一致。
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ensureElectron } from './ensure-electron.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE

const args = process.argv.slice(2)

// dev / preview 要拉起 electron.exe：二进制缺失时 electron-vite 只会抛
// “Error: Electron uninstall”，这里先补齐，让启动自带修复能力。
if (args[0] === 'dev' || args[0] === 'preview') {
  if (!ensureElectron()) process.exit(1)
}

const cli = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')

const child = spawn(process.execPath, [cli, ...args], {
  cwd: root,
  env,
  stdio: 'inherit'
})

child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
