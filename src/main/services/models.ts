import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { shell } from 'electron'
import type { ModelNode, ModelScanReport } from '@shared/types'
import { resolveComfyPaths } from '../lib/paths'

/* ══════════════════════════════════════════════════════════
 * 模型管理
 *
 * 扫出一棵文件夹树：每一层是子文件夹 + 模型文件。
 * yaml / json / 预览图这类旁路文件不进树，也不计入体积。
 * 删除一律走系统回收站，且做路径越界防护。
 * ══════════════════════════════════════════════════════════ */

/** 真正的权重文件。配置和预览（yaml、json、png、txt）不是模型。 */
const MODEL_EXTS = new Set([
  '.safetensors',
  '.ckpt',
  '.pt',
  '.pth',
  '.pt2',
  '.bin',
  '.gguf',
  '.sft',
  '.onnx',
  '.pkl',
  '.npz'
])

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function byExplorerName(a: ModelNode, b: ModelNode): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

async function scanDir(dir: string, modelsDir: string): Promise<ModelNode> {
  const rel = relative(modelsDir, dir).split(sep).join('/')
  const slash = rel.lastIndexOf('/')
  const name = slash === -1 ? rel : rel.slice(slash + 1)

  let mtime = 0
  try {
    mtime = (await stat(dir)).mtimeMs
  } catch {
    /* 目录中途被删掉时，这一层按空目录返回 */
  }

  let listed: { name: string; isDirectory: () => boolean; isFile: () => boolean }[] = []
  try {
    listed = await readdir(dir, { withFileTypes: true })
  } catch {
    listed = []
  }

  const children: ModelNode[] = []
  let size = 0
  let fileCount = 0

  for (const entry of listed) {
    const full = join(dir, entry.name)

    if (entry.isDirectory()) {
      const child = await scanDir(full, modelsDir)
      children.push(child)
      size += child.size
      fileCount += child.fileCount
      continue
    }
    if (!entry.isFile()) continue

    const ext = extOf(entry.name)
    if (!MODEL_EXTS.has(ext)) continue

    let st: Awaited<ReturnType<typeof stat>>
    try {
      st = await stat(full)
    } catch {
      continue
    }

    const fileRel = relative(modelsDir, full).split(sep).join('/')
    children.push({
      name: entry.name,
      relative: fileRel,
      kind: 'file',
      size: st.size,
      mtime: st.mtimeMs,
      ext,
      fileCount: 1,
      children: []
    })
    size += st.size
    fileCount += 1
  }

  children.sort(byExplorerName)

  return {
    name,
    relative: rel,
    kind: 'dir',
    size,
    mtime,
    ext: '',
    fileCount,
    children
  }
}

export async function scanModels(root: string): Promise<ModelScanReport> {
  const paths = resolveComfyPaths(root)

  const report: ModelScanReport = {
    modelsDir: paths.modelsDir,
    totalSize: 0,
    totalFiles: 0,
    entries: [],
    error: null
  }

  try {
    await stat(paths.modelsDir)
  } catch {
    report.error = `模型目录不存在：${paths.modelsDir}`
    return report
  }

  try {
    const tree = await scanDir(paths.modelsDir, paths.modelsDir)
    report.totalSize = tree.size
    report.totalFiles = tree.fileCount
    report.entries = tree.children
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err)
  }

  return report
}

/* ── 安全删除 ── */

/**
 * 把相对路径解析为 models 目录内的绝对路径。
 * 任何越界（..、绝对路径、盘符）都会抛错，杜绝路径穿越。
 */
export function resolveModelPath(modelsDir: string, rel: string): string {
  if (!rel || rel.includes('\0')) throw new Error('非法路径')

  const normalized = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (/^[a-zA-Z]:/.test(normalized)) {
    throw new Error('拒绝处理绝对路径')
  }
  const segments = normalized.split('/').filter((s) => s.length > 0)
  if (segments.some((s) => s === '..' || s === '.')) {
    throw new Error('拒绝处理包含上级引用的路径')
  }

  const full = join(modelsDir, ...segments)
  const rootWithSep = modelsDir.endsWith(sep) ? modelsDir : modelsDir + sep
  if (!full.startsWith(rootWithSep)) {
    throw new Error('目标不在 models 目录内')
  }
  return full
}

export async function deleteModelFile(root: string, rel: string): Promise<void> {
  const paths = resolveComfyPaths(root)
  const full = resolveModelPath(paths.modelsDir, rel)

  try {
    await stat(full)
  } catch {
    throw new Error(`文件不存在：${rel}`)
  }

  await shell.trashItem(full)
}

export async function revealModelFile(root: string, rel: string): Promise<void> {
  const paths = resolveComfyPaths(root)
  const full = resolveModelPath(paths.modelsDir, rel)
  shell.showItemInFolder(full)
}
