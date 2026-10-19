/**
 * 对比度守卫（零依赖）
 *
 * 读 tokens.css，解析两套主题的语义令牌，按 WCAG 计算关键配对的对比度。
 * 用法：node scripts/check-contrast.mjs
 *
 * 阈值：正文/小字 4.5:1；非文字（焦点环、状态灯）3:1。
 * 只用实色令牌配对——color-mix 结果无法静态解析，相关配对不在检查范围。
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const tokensPath = join(here, '..', 'src', 'renderer', 'src', 'styles', 'tokens.css')

/* ── 解析 CSS 变量 ── */
function parseBlocks(css) {
  const base = {}
  const dark = {}
  const light = {}
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const sel = m[1].trim()
    const body = m[2]
    const target = sel.includes("data-theme='dark'")
      ? dark
      : sel.includes("data-theme='light'")
        ? light
        : sel.includes(':root')
          ? base
          : null
    if (!target) continue
    const reVar = /(--[\w-]+)\s*:\s*([^;]+);/g
    let v
    while ((v = reVar.exec(body))) target[v[1]] = v[2].trim()
  }
  return { base, dark, light }
}

function resolve(name, scope, base, depth = 0) {
  const raw = scope[name] ?? base[name]
  if (raw === undefined) return null
  if (depth > 8) return null
  const ref = raw.match(/^var\((--[\w-]+)\)$/)
  if (ref) return resolve(ref[1], scope, base, depth + 1)
  return raw
}

/* ── WCAG ── */
function toRgb(value) {
  const hex = value.trim().replace(/^#/, '')
  // #fff / #ffff / #ffffff / #ffffffff 都接受（后两种只在有不透明通道时可静态计算）
  const expanded =
    hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split('')
          .map((c) => c + c)
          .join('')
      : hex.slice(0, 6)
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null
  const n = parseInt(expanded, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

/* ── 检查清单 ── */
const CHECKS = [
  ['主按钮文字 / 填充', 'button label', '--accent-fg', '--accent-strong', 4.5],
  ['主按钮文字 / 填充 hover', 'button label hover', '--accent-fg', '--accent-strong-hover', 4.5],
  ['停止按钮文字 / 填充', 'stop button label', '--accent-fg', '--danger-solid', 4.5],
  ['品牌标识文字', 'brand text', '--accent-line', '--bg-app', 4.5],
  ['页标题', 'page title', '--fg', '--bg-canvas', 4.5],
  ['正文', 'body text', '--fg', '--bg-surface', 4.5],
  ['微波标签', 'micro label', '--fg-muted', '--bg-surface', 4.5],
  ['次要文字 / 应用底', 'muted on app bg', '--fg-muted', '--bg-app', 4.5],
  ['读数提示', 'readout hint', '--fg-muted', '--bg-surface', 4.5],
  ['表格正文', 'table body', '--fg', '--bg-surface', 4.5],
  ['表头 / 行悬浮底', 'table head on hover', '--fg-muted', '--bg-hover', 4.5],
  ['标签-正常', 'tag ok', '--ok-text', '--bg-surface', 4.5],
  ['标签-警告', 'tag warn', '--warn-text', '--bg-surface', 4.5],
  ['标签-错误', 'tag error', '--danger-text', '--bg-surface', 4.5],
  ['标签-强调', 'tag accent', '--accent-line', '--bg-surface', 4.5],
  ['行内错误文字', 'terminal stderr', '--danger-text', '--bg-terminal', 4.5],
  ['日志时间戳', 'terminal timestamp', '--fg-muted', '--bg-terminal', 4.5],
  ['输入占位符', 'placeholder', '--fg-muted', '--bg-input', 4.5],
  ['焦点环（非文字）', 'focus ring', '--accent-line', '--bg-canvas', 3],
  /* 滑块落在表体/卡片底上。曾经是 #3c3d42（1.35:1），肉眼找不到滚动条 */
  ['滚动条滑块（非文字）', 'scrollbar thumb', '--scrollbar-thumb', '--bg-surface', 3]
]

const css = await readFile(tokensPath, 'utf8')
const { base, dark, light } = parseBlocks(css)

let failures = 0
for (const [theme, scope] of [['暗色', dark], ['亮色', light]]) {
  console.log(`\n── ${theme}主题 ──`)
  for (const [label, note, fgVar, bgVar, threshold] of CHECKS) {
    const fgRaw = resolve(fgVar, scope, base)
    const bgRaw = resolve(bgVar, scope, base)
    const fg = fgRaw && toRgb(fgRaw)
    const bg = bgRaw && toRgb(bgRaw)
    if (!fg || !bg) {
      console.log(`  ?  ${label.padEnd(20)} 无法静态解析 (${fgVar}=${fgRaw}, ${bgVar}=${bgRaw})`)
      continue
    }
    const ratio = contrast(fg, bg)
    const ok = ratio >= threshold
    if (!ok) failures++
    console.log(
      `  ${ok ? '✓' : '✗'}  ${label.padEnd(20)} ${ratio.toFixed(2)}:1  (需 ${threshold}:1)  ${note}`
    )
  }
}

console.log(
  failures === 0
    ? '\n[check-contrast] 全部通过\n'
    : `\n[check-contrast] ${failures} 项不达标\n`
)
process.exit(failures === 0 ? 0 : 1)
