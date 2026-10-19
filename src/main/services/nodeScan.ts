import { constants } from 'node:fs'
import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { gitSoft } from './git'

/* ══════════════════════════════════════════════════════════
 * custom_nodes 扫描底座
 *
 * M2（备份清单）与 M3（插件管理）共用。
 * 只做「读」操作，不修改任何文件。
 * ══════════════════════════════════════════════════════════ */

/** ComfyUI 原生禁用机制：目录名以 .disabled 结尾 */
export const DISABLED_SUFFIX = '.disabled'

export interface NodeDirEntry {
  /** 目录实际名（可能带 .disabled 后缀） */
  dirName: string
  /** 去掉 .disabled 后的逻辑名 */
  baseName: string
  path: string
  enabled: boolean
}

export interface NodeGitInfo {
  isGit: boolean
  remote: string | null
  commit: string | null
  shortCommit: string | null
  commitDate: string | null
  subject: string | null
  branch: string | null
  detached: boolean
  dirty: boolean
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** 列出 custom_nodes 下的插件目录（跳过隐藏文件与 pycache） */
export async function listNodeDirs(customNodesDir: string): Promise<NodeDirEntry[]> {
  let entries: { name: string; isDirectory: () => boolean }[]
  try {
    entries = await readdir(customNodesDir, { withFileTypes: true })
  } catch {
    return []
  }

  const out: NodeDirEntry[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (e.name.startsWith('.') || e.name === '__pycache__') continue

    const enabled = !e.name.endsWith(DISABLED_SUFFIX)
    out.push({
      dirName: e.name,
      baseName: enabled ? e.name : e.name.slice(0, -DISABLED_SUFFIX.length),
      path: join(customNodesDir, e.name),
      enabled
    })
  }
  return out.sort((a, b) => a.baseName.localeCompare(b.baseName))
}

/** 读取插件目录的 git 信息（非 git 目录返回 isGit:false） */
export async function readNodeGitInfo(dir: string): Promise<NodeGitInfo> {
  const blank: NodeGitInfo = {
    isGit: false,
    remote: null,
    commit: null,
    shortCommit: null,
    commitDate: null,
    subject: null,
    branch: null,
    detached: false,
    dirty: false
  }

  if (!(await pathExists(join(dir, '.git')))) return blank

  const [remote, commit, branch, logLine, porcelain] = await Promise.all([
    gitSoft(dir, ['remote', 'get-url', 'origin']),
    gitSoft(dir, ['rev-parse', 'HEAD']),
    gitSoft(dir, ['symbolic-ref', '--short', '-q', 'HEAD']),
    gitSoft(dir, ['log', '-1', '--format=%cI%n%s']),
    gitSoft(dir, ['status', '--porcelain'])
  ])

  const [date, subject] = (logLine ?? '').split('\n')

  return {
    isGit: true,
    remote,
    commit,
    shortCommit: commit ? commit.slice(0, 8) : null,
    commitDate: date ?? null,
    subject: subject ?? null,
    branch,
    detached: !branch,
    dirty: Boolean(porcelain)
  }
}

/** 读取插件声明的名称/版本（pyproject.toml → node_config？） */
export interface NodeManifest {
  displayName: string | null
  version: string | null
  description: string | null
  registryId: string | null
}

/**
 * 从插件目录推断元信息。
 * 优先 pyproject.toml（新版 ComfyUI Registry 规范），
 * 退化到 ComfyUI 节点里常见的 `NODE_CLASS_MAPPINGS` 之上的注释不可靠，故不做猜测。
 */
export async function readNodeManifest(dir: string): Promise<NodeManifest> {
  const blank: NodeManifest = {
    displayName: null,
    version: null,
    description: null,
    registryId: null
  }

  const pyproject = join(dir, 'pyproject.toml')
  if (await pathExists(pyproject)) {
    try {
      const text = await readFile(pyproject, 'utf-8')
      const section = text.match(/\[project\][\s\S]*?(?=\n\[|$)/)?.[0] ?? ''
      const pick = (key: string): string | null => {
        const m = section.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`, 'm'))
        return m ? m[1] : null
      }
      const projectName = pick('name')
      const displayName = projectName ?? null
      const version = pick('version')
      const description = pick('description')

      // [tool.comfy] 段里通常带 registry 元数据
      const toolComfy = text.match(/\[tool\.comfy\][\s\S]*?(?=\n\[|$)/)?.[0] ?? ''
      const comfyName = toolComfy.match(/^\s*DisplayName\s*=\s*["']([^"']*)["']/m)?.[1]
      const comfyId = toolComfy.match(/^\s*id\s*=\s*["']([^"']*)["']/m)?.[1]

      return {
        displayName: comfyName ?? displayName,
        version,
        description,
        registryId: comfyId ?? projectName
      }
    } catch {
      return blank
    }
  }

  return blank
}

/** 读取 requirements.txt 中的依赖包名 */
export async function readRequirements(dir: string): Promise<string[]> {
  const file = join(dir, 'requirements.txt')
  if (!(await pathExists(file))) return []
  try {
    return parseRequirements(await readFile(file, 'utf-8'))
  } catch {
    return []
  }
}

/** 解析 requirements 文本为「包名 + 原始行」列表 */
export interface RequirementEntry {
  /** 规范化后的包名（小写、去 extras） */
  name: string
  /** 原始声明行，用于展示与安装 */
  raw: string
}

export function parseRequirements(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('-'))
}

/** 从 "torch>=2.0 ; python_version>'3.8'" 这类声明里提取包名 */
export function requirementName(raw: string): string {
  const cleaned = raw.split(';')[0].trim()
  const m = cleaned.match(/^([A-Za-z0-9._-]+)/)
  return (m ? m[1] : cleaned).toLowerCase().replace(/_/g, '-')
}

export function toRequirementEntries(lines: string[]): RequirementEntry[] {
  return lines.map((raw) => ({ name: requirementName(raw), raw }))
}
