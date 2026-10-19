import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AppSettings, LaunchDefaults, LaunchPreset } from '@shared/types'

/**
 * 设置持久化：<userData>/config.json
 *
 * 写入采用「临时文件 + 原子重命名」，避免断电/崩溃时留下半截 JSON 把配置写坏。
 */

/** 首次启动的默认 ComfyUI 目录（用户已在需求中指明的固定路径） */
export const DEFAULT_COMFY_ROOT = 'D:\\Projects\\Procedure\\ComfyUI-X'

/** 监听地址：空值回落 127.0.0.1，顺手限长（只做形状校验，能不能绑上交给 ComfyUI 报错） */
function normalizeListen(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : '127.0.0.1'
}

/* ── 内置启动预设 ── */

/** 所有预设共用的启动默认值；预设只写自己不同的那一两项 */
const BASE_LAUNCH: LaunchDefaults = {
  mode: 'gpu',
  listen: '127.0.0.1',
  port: 8188,
  remote: false,
  autoOpenBrowser: true,
  extraArgs: '',
  fastFp16: false,
  disableApiNodes: false
}

export const BUILTIN_PRESETS: LaunchPreset[] = [
  {
    id: 'standard',
    name: '标准模式',
    description: '与官方 run_nvidia_gpu.bat 一致',
    builtin: true,
    launch: { ...BASE_LAUNCH }
  },
  {
    id: 'lowvram',
    name: '低显存模式',
    description: '显存吃紧或同时跑其他 GPU 程序时使用（--lowvram）',
    builtin: true,
    launch: { ...BASE_LAUNCH, extraArgs: '--lowvram' }
  },
  {
    id: 'highvram',
    name: '全显存模式',
    description: '模型常驻显存，切换工作流更快（--highvram）',
    builtin: true,
    launch: { ...BASE_LAUNCH, extraArgs: '--highvram' }
  },
  {
    id: 'preview',
    name: '预览增强',
    description: '采样过程中显示中间结果（--preview-method auto --preview-size 512）',
    builtin: true,
    launch: { ...BASE_LAUNCH, extraArgs: '--preview-method auto --preview-size 512' }
  },
  {
    id: 'offline',
    name: '离线模式',
    description: '禁用 API 节点，纯本地运行（--disable-api-nodes）',
    builtin: true,
    launch: { ...BASE_LAUNCH, disableApiNodes: true }
  }
]

function defaultLaunch(): LaunchDefaults {
  return { ...BASE_LAUNCH }
}

export function defaultSettings(): AppSettings {
  return {
    comfyRoot: DEFAULT_COMFY_ROOT,
    theme: 'dark',
    launch: defaultLaunch(),
    // 深拷贝内置预设，避免运行期修改污染模块常量
    presets: BUILTIN_PRESETS.map((p) => ({ ...p, launch: { ...p.launch } })),
    activePresetId: 'standard'
  }
}

/** 校验并规范化预设数组：内置预设始终存在，字段全部过一遍类型检查 */
function normalizePresets(input: unknown, base: LaunchPreset[]): LaunchPreset[] {
  if (!Array.isArray(input)) return base

  const out: LaunchPreset[] = []
  const seen = new Set<string>()

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as Partial<LaunchPreset>
    if (typeof p.id !== 'string' || p.id.length === 0 || seen.has(p.id)) continue
    if (typeof p.name !== 'string' || p.name.trim().length === 0) continue
    seen.add(p.id)

    const l = (p.launch ?? {}) as Partial<LaunchDefaults>
    out.push({
      id: p.id,
      name: p.name.trim().slice(0, 40),
      description: typeof p.description === 'string' ? p.description.slice(0, 200) : '',
      builtin: Boolean(p.builtin),
      launch: {
        mode: l.mode === 'cpu' ? 'cpu' : 'gpu',
        listen: normalizeListen(l.listen),
        port: typeof l.port === 'number' && l.port > 0 && l.port < 65536 ? Math.floor(l.port) : 8188,
        remote: Boolean(l.remote),
        // 老配置没有这一项：默认仍是自动开浏览器
        autoOpenBrowser: l.autoOpenBrowser !== false,
        extraArgs: typeof l.extraArgs === 'string' ? l.extraArgs : '',
        fastFp16: Boolean(l.fastFp16),
        disableApiNodes: Boolean(l.disableApiNodes)
      }
    })
  }

  // 内置预设被删除时补回来
  for (const b of BUILTIN_PRESETS) {
    if (!seen.has(b.id)) out.unshift({ ...b, launch: { ...b.launch } })
  }

  return out.length > 0 ? out : base
}

/** 只做「已知字段」的合并，避免配置文件里的脏字段污染运行期对象 */
function merge(base: AppSettings, patch: Partial<AppSettings>): AppSettings {
  const out: AppSettings = { ...base }
  if (typeof patch.comfyRoot === 'string') out.comfyRoot = patch.comfyRoot.trim()
  if (patch.theme === 'dark' || patch.theme === 'light') out.theme = patch.theme

  if (patch.presets !== undefined) {
    out.presets = normalizePresets(patch.presets, base.presets)
  }
  if (patch.activePresetId === null) {
    out.activePresetId = null
  } else if (typeof patch.activePresetId === 'string') {
    const exists = out.presets.some((p) => p.id === patch.activePresetId)
    out.activePresetId = exists ? patch.activePresetId : null
  }

  if (patch.launch) {
    const l = patch.launch
    out.launch = {
      mode: l.mode === 'cpu' ? 'cpu' : l.mode === 'gpu' ? 'gpu' : base.launch.mode,
      listen: l.listen === undefined ? base.launch.listen : normalizeListen(l.listen),
      port:
        typeof l.port === 'number' && l.port > 0 && l.port < 65536
          ? Math.floor(l.port)
          : base.launch.port,
      remote: typeof l.remote === 'boolean' ? l.remote : base.launch.remote,
      autoOpenBrowser:
        typeof l.autoOpenBrowser === 'boolean' ? l.autoOpenBrowser : base.launch.autoOpenBrowser,
      extraArgs: typeof l.extraArgs === 'string' ? l.extraArgs : base.launch.extraArgs,
      fastFp16: typeof l.fastFp16 === 'boolean' ? l.fastFp16 : base.launch.fastFp16,
      disableApiNodes:
        typeof l.disableApiNodes === 'boolean' ? l.disableApiNodes : base.launch.disableApiNodes
    }
  }

  return out
}

export class SettingsStore {
  private current: AppSettings = defaultSettings()
  private filePath: string | null = null
  private loaded = false
  private writeChain: Promise<void> = Promise.resolve()

  private get file(): string {
    if (!this.filePath) this.filePath = join(app.getPath('userData'), 'config.json')
    return this.filePath
  }

  get(): AppSettings {
    return this.current
  }

  get path(): string {
    return this.file
  }

  async load(): Promise<AppSettings> {
    if (this.loaded) return this.current
    this.loaded = true
    try {
      const raw = await readFile(this.file, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AppSettings>
      this.current = merge(defaultSettings(), parsed)
    } catch {
      // 文件不存在或损坏 → 落回默认值并立刻写出一份，方便用户直接编辑
      this.current = defaultSettings()
      await this.persist()
    }
    return this.current
  }

  async patch(patch: Partial<AppSettings>): Promise<AppSettings> {
    if (!this.loaded) await this.load()
    this.current = merge(this.current, patch)
    await this.persist()
    return this.current
  }

  private persist(): Promise<void> {
    // 串行化写入，避免并发 patch 互相覆盖
    this.writeChain = this.writeChain.then(async () => {
      const target = this.file
      await mkdir(dirname(target), { recursive: true })
      const tmp = `${target}.tmp`
      await writeFile(tmp, JSON.stringify(this.current, null, 2), 'utf-8')
      await rename(tmp, target)
    })
    return this.writeChain
  }
}

export const settingsStore = new SettingsStore()

/** IPC 入参里的 root 优先，缺省回落当前设置的 ComfyUI 根目录 */
export function pickRoot(root?: string): string {
  const trimmed = root?.trim()
  return trimmed ? trimmed : settingsStore.get().comfyRoot
}
