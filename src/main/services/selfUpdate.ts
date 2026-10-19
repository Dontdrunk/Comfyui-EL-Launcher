import { app, ipcMain, net, session, type BrowserWindow } from 'electron'
import { spawn, type SpawnOptions } from 'node:child_process'
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { IPC } from '@shared/ipc'
import type { SelfUpdateProgress, SelfUpdateStatus } from '@shared/types'
import { logToFile } from '../lib/logger'
import { parseSemver } from './semver.mjs'
import {
  fileNameOf,
  isLauncherAsset,
  isNewer,
  parseLatestYml,
  pickFile,
  sha512Base64,
  type UpdateFile
} from './selfUpdatePlan.mjs'

/** 与 electron-builder.yml 的 publish.owner / publish.repo 必须相同 */
const UPDATE_OWNER = 'Dontdrunk'
const UPDATE_REPO = 'Comfyui-EL-Launcher'

interface GhAsset {
  name: string
  browser_download_url: string
}

interface GhRelease {
  assets?: GhAsset[]
}

interface ReadyUpdate {
  version: string
  files: UpdateFile[]
  assets: Map<string, string>
}

let ready: ReadyUpdate | null = null
let busy = false

function currentVersion(): string {
  const v = app.getVersion()
  if (v && v !== process.versions.electron) return v
  const raw = readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')
  return (JSON.parse(raw) as { version: string }).version
}

function userAgent(): string {
  return `ExplorerLauncher/${currentVersion()}`
}

function readable(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/net::ERR_/.test(raw)) return `连不上 GitHub（${raw}）。稍后重试即可。`
  return raw
}

function assertHttps(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('更新包地址无效')
  }
  if (parsed.protocol !== 'https:') throw new Error('更新包地址不是 https')
}

function ghHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': userAgent(),
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

async function fetchLatest(): Promise<GhAsset[]> {
  const res = await session.defaultSession.fetch(
    `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`,
    { headers: ghHeaders() }
  )
  if (!res.ok) throw new Error(`GitHub API 返回 ${res.status}`)
  const json = (await res.json()) as GhRelease
  return Array.isArray(json.assets) ? json.assets : []
}

async function fetchText(url: string): Promise<string> {
  assertHttps(url)
  const res = await session.defaultSession.fetch(url, {
    headers: { 'User-Agent': userAgent(), Accept: 'application/octet-stream' }
  })
  if (!res.ok) throw new Error(`下载 latest.yml 失败（HTTP ${res.status}）`)
  return res.text()
}

function headerNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const n = Number(raw ?? 0)
  return Number.isFinite(n) ? n : 0
}

function downloadTo(url: string, dest: string, onProgress: (percent: number) => void): Promise<void> {
  assertHttps(url)
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow', session: session.defaultSession })
    req.setHeader('User-Agent', userAgent())
    req.setHeader('Accept', 'application/octet-stream')
    req.on('response', (res) => {
      // Electron 的 IncomingMessage 运行时是 Readable，类型定义没带上 pipe
      const body = res as unknown as Readable
      const code = res.statusCode ?? 0
      if (code !== 200) {
        body.resume()
        reject(new Error(`下载失败（HTTP ${code}）`))
        return
      }
      const total = headerNumber(res.headers['content-length'])
      let got = 0
      let settled = false
      const file = createWriteStream(dest)
      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        body.unpipe(file)
        file.destroy()
        reject(err)
      }
      body.on('data', (chunk: Buffer) => {
        got += chunk.length
        if (total > 0) onProgress(Math.min(99, Math.round((got / total) * 100)))
      })
      body.on('error', fail)
      file.on('error', fail)
      file.on('finish', () => {
        if (settled) return
        settled = true
        resolve()
      })
      body.pipe(file)
    })
    req.on('error', reject)
    req.end()
  })
}

export async function checkSelfUpdate(): Promise<SelfUpdateStatus> {
  const packaged = app.isPackaged
  try {
    const assets = await fetchLatest()
    const ymlAsset = assets.find((a) => a.name === 'latest.yml')
    if (!ymlAsset?.browser_download_url) {
      ready = null
      return { state: 'error', version: null, message: '发布里没有 latest.yml', packaged }
    }
    const parsed = parseLatestYml(await fetchText(ymlAsset.browser_download_url))
    if (!parsed || !parseSemver(parsed.version)) {
      ready = null
      return { state: 'error', version: null, message: 'latest.yml 无法解析', packaged }
    }
    const current = currentVersion()
    if (!isNewer(current, parsed.version)) {
      ready = null
      return { state: 'latest', version: parsed.version, message: null, packaged }
    }
    const map = new Map<string, string>()
    for (const asset of assets) {
      if (asset.name && asset.browser_download_url) map.set(asset.name, asset.browser_download_url)
    }
    ready = { version: parsed.version, files: parsed.files, assets: map }
    return { state: 'available', version: parsed.version, message: null, packaged }
  } catch (err) {
    ready = null
    return { state: 'error', version: null, message: readable(err), packaged }
  }
}

function detach(cmd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  const options: SpawnOptions = {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: env ?? process.env
  }
  const child = spawn(cmd, args, options)
  child.unref()
  if (child.pid == null) throw new Error(`无法启动 ${cmd}`)
}

function launchSetup(exe: string): void {
  detach(exe, ['/S', '--updated', '--force-run'])
}

function swapPortable(next: string, current: string): void {
  const script = join(tmpdir(), `explorer-update-${process.pid}.ps1`)
  // shortcut: 固定等 2 秒，不等进程句柄；便携版替换失败时再改成等 pid 退出
  const body = [
    "$ErrorActionPreference = 'Stop'",
    'Start-Sleep -Seconds 2',
    'Move-Item -LiteralPath $env:EXPLORER_UPDATE_NEW -Destination $env:EXPLORER_UPDATE_OLD -Force',
    'Start-Process -FilePath $env:EXPLORER_UPDATE_OLD'
  ].join('\r\n')
  writeFileSync(script, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body, 'utf8')]))
  detach('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
    ...process.env,
    EXPLORER_UPDATE_NEW: next,
    EXPLORER_UPDATE_OLD: current
  })
}

export async function installSelfUpdate(onProgress: (percent: number) => void): Promise<void> {
  if (!app.isPackaged) throw new Error('开发模式不会替换当前进程')
  const portablePath = process.env.PORTABLE_EXECUTABLE_FILE ?? ''
  const portable = portablePath.length > 0
  if (!portable && process.execPath.toLowerCase().includes('win-unpacked')) {
    throw new Error('解包目录不能原地更新，请用安装版或便携版。')
  }
  if (busy) throw new Error('正在更新')
  busy = true
  try {
    if (!ready) {
      const status = await checkSelfUpdate()
      if (status.state !== 'available' || !ready) {
        throw new Error(status.message || '没有可安装的更新')
      }
    }
    const file = pickFile(ready.files, portable)
    if (!file) throw new Error(portable ? '发布里没有便携版' : '发布里没有安装包')
    const name = fileNameOf(file.url)
    if (!isLauncherAsset(name)) throw new Error(`更新包文件名不符合预期：${name}`)
    const url = ready.assets.get(name)
    if (!url) throw new Error(`发布里没有 ${name}`)
    const dest = join(tmpdir(), name)
    try {
      await downloadTo(url, dest, onProgress)
      const info = await stat(dest)
      const digest = sha512Base64(await readFile(dest))
      if (info.size !== file.size || digest !== file.sha512) {
        throw new Error('更新包校验失败，已删除下载文件。')
      }
    } catch (err) {
      await rm(dest, { force: true }).catch(() => undefined)
      throw err
    }
    onProgress(100)
    logToFile('自更新：校验通过，准备退出', { version: ready.version, name })
    if (portable) swapPortable(dest, portablePath)
    else launchSetup(dest)
    app.quit()
  } finally {
    busy = false
  }
}

export function registerSelfUpdateIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.selfUpdateStatus, () => checkSelfUpdate())
  ipcMain.handle(IPC.selfUpdateInstall, async () => {
    await installSelfUpdate((percent) => {
      const win = getWindow()
      if (!win || win.isDestroyed()) return
      const payload: SelfUpdateProgress = { percent }
      win.webContents.send(IPC.evtSelfUpdate, payload)
    })
  })
}
