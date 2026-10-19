/* ══════════════════════════════════════════════════════════
 * 横幅（LetterGlitch）参数
 *
 * 参数的取值范围照抄组件内部的 clamp（见 bg/LetterGlitch/LetterGlitch.jsx
 * 的 settings 块），滑块拉到两端不会出现"拖到底但没变化"的假手感。
 * ══════════════════════════════════════════════════════════ */

export type ClickEffect = 'tear' | 'burst' | 'none'

/** 大字用的三套字体。展示体是标题字重，界面体跟侧栏同一套，等宽体跟字符雨同一套 */
export type WordFont = 'display' | 'ui' | 'mono'

export interface GlitchParams {
  /** 字符密度 0~1 */
  density: number
  /** 流逝速度 */
  speed: number
  /** 故障强度 0~1 */
  glitchAmount: number
  /** 底色亮度 0~1 */
  baseOpacity: number
  /** 字号 6~40 */
  fontSize: number
  /** 字距 0~2 */
  spacing: number
  /** 流动 0~1 */
  flow: number
  /** 边缘淡出 0~0.5 */
  edgeFade: number
  /** 中心淡出 0~1 */
  centerFade: number
  /** 鼠标影响半径 */
  cursorRadius: number
  /** 字符集 */
  characters: string
  /** 未点亮的字色 */
  baseColor: string
  /** 三档故障高亮色，从冷到亮 */
  c1: string
  c2: string
  c3: string
  clickEffect: ClickEffect
  interactive: boolean
  smooth: boolean
  /** 大字开关。关掉只是藏起来，文案和字号都还在 */
  wordOn: boolean
  /** 叠在字符雨上的大字，默认产品名 */
  word: string
  /** 大字字号，px。横幅会跟着长高，避免字被上下裁掉 */
  wordSize: number
  /** 大字字重 */
  wordWeight: number
  /** 大字字距，单位 em。负值把字收紧，像一块字标 */
  wordTracking: number
  /** 大字不透明度。略低于 1 时，字符雨还能从笔画里透出来 */
  wordOpacity: number
  /** 大字颜色。存的是暗色下的设计值，亮色主题会翻亮度 */
  wordColor: string
  wordFont: WordFont
}

export const DEFAULTS: GlitchParams = {
  density: 1,
  speed: 2,
  glitchAmount: 0.85,
  baseOpacity: 0.24,
  fontSize: 11,
  spacing: 0.35,
  flow: 0.85,
  edgeFade: 0,
  centerFade: 0,
  cursorRadius: 200,
  characters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$&*()-_+=/[]{};:<>.,0123456789',
  baseColor: '#2a2b2f',
  c1: '#3c3d42',
  c2: '#6a6b73',
  c3: '#f0ff41',
  clickEffect: 'tear',
  interactive: true,
  smooth: true,
  wordOn: true,
  word: 'COMFYUI',
  wordSize: 168,
  wordWeight: 800,
  wordTracking: 0.27,
  wordOpacity: 0.86,
  wordColor: '#f3f3f3',
  wordFont: 'ui'
}

export interface SliderSpec {
  key: NumericKey
  label: string
  min: number
  max: number
  step: number
  /** 显示时保留几位小数 */
  digits?: number
}

type NumericKey =
  | 'density'
  | 'speed'
  | 'glitchAmount'
  | 'baseOpacity'
  | 'fontSize'
  | 'spacing'
  | 'flow'
  | 'edgeFade'
  | 'centerFade'
  | 'cursorRadius'

export const WORD_FONTS: { value: WordFont; label: string; family: string }[] = [
  {
    value: 'display',
    label: '展示',
    family: "'Segoe UI Variable Display', 'Segoe UI', Arial, 'Microsoft YaHei UI', sans-serif"
  },
  {
    value: 'ui',
    label: '界面',
    family:
      "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif"
  },
  {
    value: 'mono',
    label: '等宽',
    family:
      "'Cascadia Mono', 'Cascadia Code', Consolas, 'Sarasa Mono SC', 'Microsoft YaHei UI', ui-monospace, monospace"
  }
]

export function wordFontFamily(font: WordFont): string {
  return WORD_FONTS.find((f) => f.value === font)?.family ?? WORD_FONTS[0].family
}

export interface WordSliderSpec {
  key: 'wordSize' | 'wordWeight' | 'wordTracking' | 'wordOpacity'
  label: string
  min: number
  max: number
  step: number
  digits?: number
}

export const WORD_SLIDERS: WordSliderSpec[] = [
  { key: 'wordSize', label: '字号', min: 36, max: 240, step: 1, digits: 0 },
  { key: 'wordWeight', label: '字重', min: 400, max: 900, step: 50, digits: 0 },
  { key: 'wordTracking', label: '字距', min: -0.12, max: 0.4, step: 0.01, digits: 2 },
  { key: 'wordOpacity', label: '透明度', min: 0, max: 1, step: 0.01, digits: 2 }
]

/** 大字不跟着风暴预设走，换「安静 / 终端」不该把标题清掉 */
export const WORDMARK_KEYS = [
  'wordOn',
  'word',
  'wordSize',
  'wordWeight',
  'wordTracking',
  'wordOpacity',
  'wordColor',
  'wordFont'
] as const satisfies readonly (keyof GlitchParams)[]

export function applyPreset(current: GlitchParams, presetParams: GlitchParams): GlitchParams {
  return {
    ...presetParams,
    wordOn: current.wordOn,
    word: current.word,
    wordSize: current.wordSize,
    wordWeight: current.wordWeight,
    wordTracking: current.wordTracking,
    wordOpacity: current.wordOpacity,
    wordColor: current.wordColor,
    wordFont: current.wordFont
  }
}

export const SLIDERS: SliderSpec[] = [
  { key: 'density', label: '密度', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'speed', label: '速度', min: 0, max: 3, step: 0.01, digits: 2 },
  { key: 'glitchAmount', label: '故障强度', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'baseOpacity', label: '底色亮度', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'flow', label: '流动', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'fontSize', label: '字号', min: 6, max: 40, step: 1, digits: 0 },
  { key: 'spacing', label: '字距', min: 0, max: 2, step: 0.01, digits: 2 },
  { key: 'cursorRadius', label: '鼠标半径', min: 0, max: 400, step: 5, digits: 0 },
  { key: 'edgeFade', label: '边缘淡出', min: 0, max: 0.5, step: 0.01, digits: 2 },
  { key: 'centerFade', label: '中心淡出', min: 0, max: 1, step: 0.01, digits: 2 }
]

/* ── 亮色适配 ──────────────────────────────────────────────
 *
 * 组件自带的 lightMode 只在"没传自定义色"时换一套默认色，我们一直传自定义色，
 * 所以它等于没作用，亮色下的适配得自己做。
 *
 * 做法是保持色相与饱和度不变、只把亮度翻过来：
 *   暗底上的"未点亮字"本来就该隐形（#2a2b2f 压在 #101011 上），
 *   换到白底就该同样隐形（翻成浅灰压在 #ececec 上）；
 *   电光黄 #f0ff41 在暗底是亮点，翻成暗橄榄后在白底才成其为亮点。
 * 直接反相 RGB 会把色相也翻掉（黄变蓝），所以必须走 HSL。
 * ───────────────────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.trim().replace('#', '')
  const h = s.length === 3 ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2] : s
  const n = Number.parseInt(h.slice(0, 6), 16)
  return Number.isNaN(n) ? [128, 128, 128] : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6
  else if (max === G) h = ((B - R) / d + 2) / 6
  else h = ((R - G) / d + 4) / 6
  return [h * 360, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number): string => {
    const k = (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, '0')
  }
  return '#' + f(0) + f(8) + f(4)
}

/** 保持色相与饱和度，只翻亮度 */
export function flipLightness(hex: string): string {
  const [r, g, b] = hexToRgb(hex)
  const [h, s, l] = rgbToHsl(r, g, b)
  return hslToHex(h, s, 1 - l)
}

/**
 * 亮色下底色亮度要额外抬高多少倍。
 *
 * 实测（面板关掉、只量横幅本身，阈值"与底色差 >18"）：
 *   滑杆 0.30 → 实际 0.48 → 可见 0.28%   太淡，整条几乎是空的
 *   滑杆 0.45 → 实际 0.72 → 可见 0.72%   ← 取这档
 *   滑杆 0.60 → 实际 0.96 → 可见 2.09%   偏重
 *   不开适配（原色硬上）  → 可见 7.03%   糊成一片灰，就是被吐槽的那个样子
 * 暗色主题的基准是 1.32%。
 *
 * 原因是浅灰压浅灰比深灰压深灰更难看出来 —— 同样的 alpha，
 * 亮底上的图底差会被背景"吃"掉更多，所以这里补一个系数。
 */
export const LIGHT_OPACITY_GAIN = 2.4

/** 按当前主题给出实际喂给组件的参数。亮色主题下恒定生效，没有开关 */
export function adaptForTheme(p: GlitchParams, light: boolean): GlitchParams {
  if (!light) return p
  return {
    ...p,
    baseColor: flipLightness(p.baseColor),
    c1: flipLightness(p.c1),
    c2: flipLightness(p.c2),
    c3: flipLightness(p.c3),
    wordColor: flipLightness(p.wordColor),
    baseOpacity: Math.min(1, p.baseOpacity * LIGHT_OPACITY_GAIN)
  }
}

/* ── 预设 ────────────────────────────────────────────────
 *
 * 五套现成的调法。每套都是完整参数（在 DEFAULTS 上覆写），
 * 不存"预设 id"——面板靠逐字段比对来判断当前是哪一套，
 * 这样你手改两个滑块之后高亮会自然消失，不会骗你说还在某个预设上。
 * ───────────────────────────────────────────────────── */

export interface Preset {
  id: string
  label: string
  hint: string
  params: GlitchParams
}

const preset = (id: string, label: string, hint: string, over: Partial<GlitchParams>): Preset => ({
  id,
  label,
  hint,
  params: { ...DEFAULTS, ...over }
})

export const PRESETS: Preset[] = [
  preset('default', '默认', '出厂节奏：字密、滚得快，故障偏高', {}),
  preset('quiet', '安静', '几乎不存在，只想让顶部有点呼吸', {
    density: 0.55,
    speed: 0.25,
    glitchAmount: 0.22,
    baseOpacity: 0.16,
    fontSize: 12,
    spacing: 0.8,
    flow: 0.3,
    cursorRadius: 100,
    c1: '#34353a',
    c2: '#4a4b52'
  }),
  preset('terminal', '终端', '字密、字距紧、滚得快，像在刷日志', {
    density: 1,
    speed: 1.2,
    glitchAmount: 0.45,
    baseOpacity: 0.3,
    fontSize: 12,
    spacing: 0.4,
    flow: 0.65,
    cursorRadius: 120,
    c2: '#55565e'
  }),
  preset('stream', '数据流', '更快更密，故障拉高，像在灌数据', {
    density: 1,
    speed: 2,
    glitchAmount: 0.85,
    baseOpacity: 0.24,
    fontSize: 11,
    spacing: 0.35,
    flow: 0.85,
    cursorRadius: 200,
    c2: '#6a6b73'
  }),
  preset('snow', '雪花', '故障拉满，像一台坏掉的显示器', {
    density: 1,
    speed: 2.6,
    glitchAmount: 1,
    baseOpacity: 0.5,
    fontSize: 14,
    spacing: 0.2,
    flow: 1,
    cursorRadius: 300,
    clickEffect: 'burst',
    c2: '#55565e'
  })
]

const WORDMARK = new Set<keyof GlitchParams>(WORDMARK_KEYS)

/** 只比字符雨。大字不参与，出厂值和「数据流」现在是同一套雨 */
export function sameStorm(a: GlitchParams, b: GlitchParams): boolean {
  for (const k of Object.keys(DEFAULTS) as (keyof GlitchParams)[]) {
    if (WORDMARK.has(k)) continue
    if (a[k] !== b[k]) return false
  }
  return true
}

/** 当前参数是否正好等于某套预设（逐字段比）。多套相同时取列表里靠前的 */
export function matchPreset(p: GlitchParams): string | null {
  return PRESETS.find((pre) => sameStorm(p, pre.params))?.id ?? null
}

const KEY = 'xl.banner.glitch'

export function loadParams(): GlitchParams {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const saved = JSON.parse(raw) as Partial<GlitchParams>
    /* 逐字段合并：旧版本存过的键可能缺，缺的用默认值补上，
       以后加字段也不会让老存档把界面读崩 */
    const out = { ...DEFAULTS }
    for (const k of Object.keys(DEFAULTS) as (keyof GlitchParams)[]) {
      const v = saved[k]
      if (v === undefined || typeof v !== typeof DEFAULTS[k]) continue
      if (k === 'wordFont' && v !== 'display' && v !== 'ui' && v !== 'mono') continue
      ;(out as Record<string, unknown>)[k] = v
    }
    return out
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveParams(p: GlitchParams): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* 存不了只是记不住，不影响这一轮调参 */
  }
}
