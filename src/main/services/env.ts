import { constants } from 'node:fs'
import { access, readFile, statfs } from 'node:fs/promises'
import { parse } from 'node:path'
import type { DiskProbe, EnvIssue, EnvLayout, RuntimeInfo } from '@shared/types'
import { buildChildEnv } from '../lib/childEnv'
import { run } from '../lib/exec'
import { resolveComfyPaths } from '../lib/paths'

/* ══════════════════════════════════════════════════════════
 * 环境探测
 *
 * 分两级：
 *  - checkLayout：纯文件系统检查，毫秒级，用于判断目录是否为合法便携版
 *  - probeRuntime：拉起 python 读 torch / CUDA，秒级，按需触发
 * ══════════════════════════════════════════════════════════ */

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** 从 comfyui_version.py 解析 __version__ */
export function parseVersionFile(content: string): string | null {
  const m = content.match(/__version__\s*=\s*["']([^"']+)["']/)
  return m ? m[1] : null
}

export async function readAppVersion(versionFile: string): Promise<string | null> {
  try {
    return parseVersionFile(await readFile(versionFile, 'utf-8'))
  } catch {
    return null
  }
}

export async function checkLayout(root: string): Promise<EnvLayout> {
  const paths = resolveComfyPaths(root)
  const issues: EnvIssue[] = []

  const rootOk = await exists(root)

  if (!rootOk) {
    issues.push({
      level: 'error',
      message: `目录不存在：${root}`,
      hint: '请在「设置」中填写 ComfyUI 便携版的根目录（含 python_embeded 与 ComfyUI 两层）。'
    })
    return emptyLayout(root, issues)
  }

  const [pythonOk, mainOk, updateOk, customNodesOk, modelsOk, gitOk, reqOk] = await Promise.all([
    exists(paths.pythonExe),
    exists(paths.mainPy),
    exists(paths.updateScript),
    exists(paths.customNodesDir),
    exists(paths.modelsDir),
    exists(paths.gitDir),
    exists(paths.requirementsFile)
  ])

  if (!pythonOk) {
    issues.push({
      level: 'error',
      message: `缺少内置解释器：${paths.pythonExe}`,
      hint: '本启动器面向 ComfyUI 官方便携版（portable），需要 python_embeded 目录。'
    })
  }
  if (!mainOk) {
    issues.push({
      level: 'error',
      message: `缺少 ComfyUI 入口：${paths.mainPy}`,
      hint: '确认根目录下存在 ComfyUI\\main.py。'
    })
  }
  if (!customNodesOk) issues.push({ level: 'warn', message: 'custom_nodes 目录不存在，插件管理将不可用' })
  if (!modelsOk) issues.push({ level: 'warn', message: 'models 目录不存在' })
  if (!updateOk) {
    issues.push({
      level: 'warn',
      message: '未找到 update\\update.py（官方更新脚本）',
      hint: '不影响基于 git 的版本管理，但「官方更新流程」将不可用。'
    })
  }
  if (!gitOk) {
    issues.push({
      level: 'warn',
      message: 'ComfyUI 目录不是 git 仓库（缺少 .git）',
      hint: '版本更新与回滚功能需要 git 仓库，请改用 git 方式安装或重新 clone。'
    })
  }
  if (!reqOk) issues.push({ level: 'warn', message: '缺少 ComfyUI\\requirements.txt' })

  const appVersion = await readAppVersion(paths.versionFile)

  const portable = pythonOk && mainOk
  const valid = !issues.some((i) => i.level === 'error')

  return {
    root,
    valid,
    portable,
    issues,
    pythonExe: pythonOk ? paths.pythonExe : null,
    comfyDir: mainOk ? paths.comfyDir : null,
    mainPy: mainOk ? paths.mainPy : null,
    customNodesDir: customNodesOk ? paths.customNodesDir : null,
    modelsDir: modelsOk ? paths.modelsDir : null,
    outputDir: (await exists(paths.outputDir)) ? paths.outputDir : null,
    updateDir: updateOk ? paths.updateDir : null,
    updateScript: updateOk ? paths.updateScript : null,
    isGitRepo: gitOk,
    appVersion,
    diskUsage: null
  }
}

function emptyLayout(root: string, issues: EnvIssue[]): EnvLayout {
  return {
    root,
    valid: false,
    portable: false,
    issues,
    pythonExe: null,
    comfyDir: null,
    mainPy: null,
    customNodesDir: null,
    modelsDir: null,
    outputDir: null,
    updateDir: null,
    updateScript: null,
    isGitRepo: false,
    appVersion: null,
    diskUsage: null
  }
}

/* ── 运行时探测 ── */

const PROBE_MARKER = '__XL_JSON__'

const PROBE_SCRIPT = `
import json, sys
out = {"pythonVersion": sys.version.split()[0], "executable": sys.executable}
try:
    import torch
    out["torchVersion"] = torch.__version__
    out["cudaVersion"] = torch.version.cuda
    out["cudaAvailable"] = bool(torch.cuda.is_available())
    out["deviceCount"] = int(torch.cuda.device_count())
    if out["cudaAvailable"]:
        out["gpuName"] = torch.cuda.get_device_name(0)
except Exception as e:
    out["error"] = "torch 导入失败: %s" % (e,)
try:
    import pip
    out["pipVersion"] = getattr(pip, "__version__", None)
except Exception:
    pass
print("${PROBE_MARKER}" + json.dumps(out))
`

export async function probeRuntime(root: string): Promise<RuntimeInfo> {
  const paths = resolveComfyPaths(root)

  const blank: RuntimeInfo = {
    probed: true,
    ok: false,
    pythonVersion: null,
    torchVersion: null,
    cudaVersion: null,
    cudaAvailable: false,
    gpuName: null,
    deviceCount: 0,
    pipVersion: null,
    error: null,
    probedAt: Date.now()
  }

  if (!(await exists(paths.pythonExe))) {
    return { ...blank, error: `未找到内置解释器：${paths.pythonExe}` }
  }

  const r = await run(paths.pythonExe, ['-s', '-c', PROBE_SCRIPT], {
    cwd: paths.root,
    env: buildChildEnv(),
    timeoutMs: 180_000
  })

  if (r.spawnError) return { ...blank, error: `无法启动解释器：${r.spawnError}` }
  if (r.timedOut) return { ...blank, error: '运行时探测超时（180 秒）' }

  const line = r.stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith(PROBE_MARKER))

  if (!line) {
    const tail = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-5).join('\n')
    return { ...blank, error: `探测脚本未返回结果${tail ? `：\n${tail}` : ''}` }
  }

  try {
    const data = JSON.parse(line.slice(PROBE_MARKER.length)) as {
      pythonVersion?: string
      executable?: string
      torchVersion?: string
      cudaVersion?: string | null
      cudaAvailable?: boolean
      deviceCount?: number
      gpuName?: string
      pipVersion?: string | null
      error?: string
    }
    return {
      probed: true,
      ok: !data.error,
      pythonVersion: data.pythonVersion ?? null,
      torchVersion: data.torchVersion ?? null,
      cudaVersion: data.cudaVersion ?? null,
      cudaAvailable: Boolean(data.cudaAvailable),
      gpuName: data.gpuName ?? null,
      deviceCount: data.deviceCount ?? 0,
      pipVersion: data.pipVersion ?? null,
      error: data.error ?? null,
      probedAt: Date.now()
    }
  } catch (err) {
    return { ...blank, error: `探测结果解析失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

/* ── 磁盘容量：模型页展示根目录所在卷的剩余空间 ── */

export async function probeDisk(root: string): Promise<DiskProbe> {
  const paths = resolveComfyPaths(root)
  const drive = parse(paths.root).root || null
  const result: DiskProbe = { diskFreeBytes: null, diskTotalBytes: null, drive }

  const statTarget = (await exists(paths.root)) ? paths.root : drive
  if (statTarget) {
    try {
      const st = await statfs(statTarget)
      result.diskFreeBytes = Number(st.bavail) * Number(st.bsize)
      result.diskTotalBytes = Number(st.blocks) * Number(st.bsize)
    } catch {
      /* 某些卷不支持 statfs */
    }
  }

  return result
}
