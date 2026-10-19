import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { shell } from 'electron'
import type { EnvBackupFile, LogStream, PipPackage } from '@shared/types'
import { buildChildEnv } from '../lib/childEnv'
import { run } from '../lib/exec'
import { backupId, resolveComfyPaths, type ComfyPaths } from '../lib/paths'
import {
  assertPipOk,
  isPackageName,
  pipInstall,
  pipInstallSpec,
  pipList,
  pipReinstall,
  pipUninstall
} from '../lib/pip'
import { pathExists } from './nodeScan'

/* ══════════════════════════════════════════════════════════
 * 环境管理
 *
 * 管的是便携版 python_embeded 里的 site-packages，
 * 不是 ComfyUI 自己的 requirements.txt，也不是单个插件的依赖。
 * ══════════════════════════════════════════════════════════ */

const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+!*~=-]{0,80}$/
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * 用发行元数据定位包目录。名字从 argv 传入，不拼进代码字符串。
 * 优先打开含文件的那一层；没有文件列表时退回发行所在目录。
 */
const LOCATE_PY = [
  'import importlib.metadata as m, sys',
  'name = sys.argv[1]',
  'try:',
  '    dist = m.distribution(name)',
  'except m.PackageNotFoundError:',
  '    raise SystemExit(2)',
  'root = dist.locate_file("")',
  'best = None',
  'best_depth = 99',
  'for f in list(dist.files or []):',
  '    parts = getattr(f, "parts", None) or str(f).replace("\\\\", "/").split("/")',
  '    if not parts or parts[0].endswith(".dist-info") or parts[0].endswith(".data"):',
  '        continue',
  '    p = dist.locate_file(f)',
  '    if not p.is_file():',
  '        continue',
  '    parent = p.parent',
  '    try:',
  '        depth = len(parent.relative_to(root).parts)',
  '    except Exception:',
  '        depth = 99',
  '    if depth < best_depth:',
  '        best = parent',
  '        best_depth = depth',
  'print(best if best is not None else root)'
].join('\n')

async function requirePython(root: string): Promise<ComfyPaths> {
  const trimmed = root.trim()
  if (!trimmed) throw new Error('请先在设置中指定便携版根目录。')
  const paths = resolveComfyPaths(trimmed)
  if (!(await pathExists(paths.pythonExe))) {
    throw new Error(`未找到内置解释器：${paths.pythonExe}`)
  }
  return paths
}

function assertVersion(version: string): void {
  if (!VERSION_RE.test(version)) throw new Error(`无法识别的版本号：${version}`)
}

/** 备份名允许中文。去掉 Windows 文件名里的非法字符，重名由调用方加时间后缀。 */
export function safeBackupName(raw: string): string {
  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80)
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error('请输入备份名称（支持中英文）')
  }
  if (RESERVED_NAME.test(cleaned)) return `${cleaned}_bak`
  return cleaned
}

function assertUserText(text: string, label: string): string {
  const value = text.trim()
  if (!value) throw new Error(`请填写${label}`)
  if (value.length > 500) throw new Error(`${label}过长`)
  if (/[\u0000\r\n]/.test(value)) throw new Error(`${label}含有非法字符`)
  if (value.startsWith('-')) throw new Error(`${label}不能以 - 开头`)
  return value
}

async function existingFile(filePath: string, ext: '.txt' | '.whl'): Promise<string> {
  const abs = resolve(filePath)
  if (extname(abs).toLowerCase() !== ext) {
    throw new Error(ext === '.txt' ? '只接受 .txt 依赖清单' : '只接受 .whl 文件')
  }
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) throw new Error(`找不到文件：${filePath}`)
  return abs
}

export async function listPackages(root: string): Promise<PipPackage[]> {
  const paths = await requirePython(root)
  return pipList(paths.pythonExe, { cwd: paths.pythonDir })
}

export async function installTarget(
  root: string,
  spec: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const paths = await requirePython(root)
  const text = assertUserText(spec, '包名')
  const ext = extname(text).toLowerCase()
  const opts = {
    cwd: paths.pythonDir,
    onLine,
    signal
  }

  if (ext === '.txt') {
    const file = await existingFile(text, '.txt')
    onLine?.('system', `[环境] pip install -r ${file}`)
    const r = await pipInstall(paths.pythonExe, file, { ...opts, timeoutMs: 1_800_000 })
    assertPipOk(r, '安装依赖清单')
    return
  }

  if (ext === '.whl') {
    const file = await existingFile(text, '.whl')
    onLine?.('system', `[环境] pip install ${file}`)
    const r = await pipInstallSpec(paths.pythonExe, file, { ...opts, timeoutMs: 1_800_000 })
    assertPipOk(r, '安装 whl')
    return
  }

  onLine?.('system', `[环境] pip install ${text}`)
  const r = await pipInstallSpec(paths.pythonExe, text, { ...opts, timeoutMs: 600_000 })
  assertPipOk(r, '安装')
}

export async function uninstallPackage(
  root: string,
  name: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const paths = await requirePython(root)
  if (!isPackageName(name)) throw new Error(`无法识别的包名：${name}`)
  onLine?.('system', `[环境] pip uninstall ${name}`)
  const r = await pipUninstall(paths.pythonExe, name, {
    cwd: paths.pythonDir,
    onLine,
    signal,
    timeoutMs: 180_000
  })
  assertPipOk(r, `卸载 ${name}`)
}

export async function reinstallPackage(
  root: string,
  name: string,
  version: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const paths = await requirePython(root)
  if (!isPackageName(name)) throw new Error(`无法识别的包名：${name}`)
  assertVersion(version)
  onLine?.('system', `[环境] pip install --force-reinstall ${name}==${version}`)
  const r = await pipReinstall(paths.pythonExe, name, version, {
    cwd: paths.pythonDir,
    onLine,
    signal,
    timeoutMs: 600_000
  })
  assertPipOk(r, `重装 ${name}`)
}

/** 打开包目录。定位失败时退回 site-packages 根目录。 */
export async function locatePackage(root: string, name: string): Promise<string> {
  const paths = await requirePython(root)
  if (!isPackageName(name)) throw new Error(`无法识别的包名：${name}`)
  const fallback = join(paths.pythonDir, 'Lib', 'site-packages')

  const r = await run(paths.pythonExe, ['-s', '-c', LOCATE_PY, name], {
    cwd: paths.pythonDir,
    env: buildChildEnv(),
    timeoutMs: 30_000
  })

  let target = ''
  if (r.code === 0) {
    target = r.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? ''
  }
  if (!target || !(await pathExists(target))) target = fallback
  if (!(await pathExists(target))) throw new Error('找不到 site-packages 目录')

  const err = await shell.openPath(target)
  if (err) throw new Error(err)
  return target
}

function freezeBody(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('[') && !/^warning/i.test(line))
  return lines.join('\n')
}

export async function freezeEnv(
  root: string,
  label: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<EnvBackupFile> {
  const paths = await requirePython(root)
  const name = safeBackupName(label)
  await mkdir(paths.envBackupsDir, { recursive: true })

  let fileName = `${name}.txt`
  let dest = join(paths.envBackupsDir, fileName)
  if (await pathExists(dest)) {
    fileName = `${name}_${backupId()}.txt`
    dest = join(paths.envBackupsDir, fileName)
  }

  onLine?.('system', '[环境] 正在冻结当前已安装的包…')
  const r = await run(paths.pythonExe, ['-s', '-m', 'pip', 'freeze'], {
    cwd: paths.pythonDir,
    env: buildChildEnv(),
    onLine,
    signal,
    timeoutMs: 120_000
  })
  assertPipOk(r, '备份环境')

  const body = freezeBody(r.stdout)
  if (!body) throw new Error('pip freeze 没有产出任何包，已取消写入。')
  await writeFile(dest, `${body}\n`, 'utf8')
  const info = await stat(dest)
  onLine?.('system', `[环境] 已写入 ${dest}`)
  return {
    name: basename(fileName, '.txt'),
    path: dest,
    bytes: info.size,
    mtime: info.mtimeMs
  }
}

export async function listEnvBackups(root: string): Promise<EnvBackupFile[]> {
  const trimmed = root.trim()
  if (!trimmed) return []
  const dir = resolveComfyPaths(trimmed).envBackupsDir
  if (!(await pathExists(dir))) return []

  const names = await readdir(dir)
  const files: EnvBackupFile[] = []
  for (const fileName of names) {
    if (!fileName.toLowerCase().endsWith('.txt')) continue
    const full = join(dir, fileName)
    const info = await stat(full).catch(() => null)
    if (!info?.isFile()) continue
    files.push({
      name: basename(fileName, '.txt'),
      path: full,
      bytes: info.size,
      mtime: info.mtimeMs
    })
  }
  files.sort((a, b) => b.mtime - a.mtime)
  return files
}

export async function restoreEnv(
  root: string,
  filePath: string,
  onLine?: (s: LogStream, t: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const paths = await requirePython(root)
  const file = await existingFile(filePath, '.txt')
  const preview = await readFile(file, 'utf8')
  if (!preview.trim()) throw new Error('这份清单是空的，没有可恢复的包。')

  onLine?.('system', `[环境] pip install -r ${file}`)
  const r = await pipInstall(paths.pythonExe, file, {
    cwd: paths.pythonDir,
    onLine,
    signal,
    timeoutMs: 1_800_000
  })
  assertPipOk(r, '恢复环境')
}

/** 选文件对话框的默认目录：已有备份夹优先，否则解释器目录。 */
export function pipFileDialogDir(root: string): string {
  const trimmed = root.trim()
  if (!trimmed) return ''
  return resolveComfyPaths(trimmed).envBackupsDir
}
