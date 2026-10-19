import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import LetterGlitch from './bg/LetterGlitch/LetterGlitch.jsx'
import { BannerTuner } from './BannerTuner'
import {
  DEFAULTS,
  adaptForTheme,
  loadParams,
  saveParams,
  wordFontFamily,
  type GlitchParams
} from './bannerParams'

/* ══════════════════════════════════════════════════════════
 * 首页横幅
 *
 * 双击横幅 → 打开居中的参数面板。面板里改的是**草稿**：
 * 横幅上立刻能看到，但只有按「保存」才落盘，「取消」回到上次保存的样子。
 *
 * 颜色分两套：存下来的是"设计值"，真正喂给组件的是 adaptForTheme 按当前主题算过的值。
 * 亮色主题下会自动把颜色翻一遍亮度，否则暗底上那套配色挪到白底就全糊了。
 *
 * 字符雨来自 DavidHDev/react-bits 的 LetterGlitch，组件本身不改。
 * 大字是同一套小字再铺一层，用 SVG 字形裁切，所以字由流动的小字构成。
 * 它每次渲染都会把 props 收进 settingsRef，渲染循环每帧读 settingsRef.current，
 * 所以调参是热更新，不需要重挂载 —— 重挂载会重建 WebGL 上下文，
 * 拖滑块时几十次重挂载会把浏览器 16 个上下文的配额耗光。
 * ══════════════════════════════════════════════════════════ */

function isLightTheme(): boolean {
  return document.documentElement.dataset.theme === 'light'
}

/** 大字上下各留一截。字号拉过横幅高度时横幅跟着长，滑块拉到头仍然看得见变化 */
const WORD_PAD = 32

export function BannerBackdrop({ height = 200 }: { height?: number }): React.JSX.Element {
  /** 已保存的参数 */
  const [saved, setSaved] = useState<GlitchParams>(loadParams)
  /** 面板打开时的草稿；null 表示面板关着 */
  const [draft, setDraft] = useState<GlitchParams | null>(null)
  const [light, setLight] = useState(isLightTheme)

  /* 主题切换时重算颜色。主题挂在 documentElement 的 data-theme 与 class 上 */
  useEffect(() => {
    const mo = new MutationObserver(() => setLight(isLightTheme()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    setLight(isLightTheme())
    return () => mo.disconnect()
  }, [])

  /* Esc = 取消 */
  useEffect(() => {
    if (!draft) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDraft(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft])

  const view = useMemo(() => adaptForTheme(draft ?? saved, light), [draft, saved, light])
  const showWord = view.wordOn && view.word.trim().length > 0
  const bannerH = showWord ? Math.max(height, Math.ceil(view.wordSize + WORD_PAD)) : height
  const bannerRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  /* 遮罩要用横幅的真实像素，字才落在正中 */
  useLayoutEffect(() => {
    const el = bannerRef.current
    if (!el) return
    const apply = (): void => setBox({ w: el.clientWidth, h: el.clientHeight })
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [bannerH])

  const patch = useCallback((p: Partial<GlitchParams>): void => {
    setDraft((d) => (d ? { ...d, ...p } : d))
  }, [])

  const save = useCallback((): void => {
    setDraft((d) => {
      if (d) {
        saveParams(d)
        setSaved(d)
      }
      return null
    })
  }, [])

  const cancel = useCallback((): void => setDraft(null), [])
  const reset = useCallback((): void => setDraft({ ...DEFAULTS }), [])

  return (
    <>
      <div
        ref={bannerRef}
        className="banner"
        style={{ height: bannerH }}
        onDoubleClick={() => setDraft((d) => d ?? { ...saved })}
        title="双击打开参数面板"
        role="presentation"
      >
        <div className="banner__stage">
          <LetterGlitch
            glitchColors={[view.c1, view.c2, view.c3]}
            baseColor={view.baseColor}
            characters={view.characters}
            fontSize={view.fontSize}
            spacing={view.spacing}
            density={view.density}
            baseOpacity={view.baseOpacity}
            glitchAmount={view.glitchAmount}
            speed={view.speed}
            smooth={view.smooth}
            interactive={view.interactive}
            cursorRadius={view.cursorRadius}
            clickEffect={view.clickEffect}
            flow={view.flow}
            edgeFade={view.edgeFade}
            centerFade={view.centerFade}
            lightMode={light}
          />
        </div>
        {showWord && box.w > 0 && (
          <svg className="banner__svg" width={box.w} height={box.h} aria-hidden>
            <defs>
              <clipPath id="xl-banner-word" clipPathUnits="userSpaceOnUse">
                <text
                  /* 字距会在末字后再垫一截，text-anchor 把这截也算进宽度，字形就偏左半个字距 */
                  x={box.w / 2 + (view.wordTracking * view.wordSize) / 2}
                  /* 锚点是基线。大写字面约在基线上方 0.72em，下移半个字面才到横幅中线 */
                  y={box.h / 2 + view.wordSize * 0.36}
                  textAnchor="middle"
                  fontSize={view.wordSize}
                  fontWeight={view.wordWeight}
                  fontFamily={wordFontFamily(view.wordFont)}
                  letterSpacing={`${view.wordTracking}em`}
                >
                  {view.word}
                </text>
              </clipPath>
            </defs>
            <foreignObject width={box.w} height={box.h} clipPath="url(#xl-banner-word)">
              <div className="banner__word" style={{ width: box.w, height: box.h }}>
                <LetterGlitch
                  glitchColors={[view.c1, view.c2, view.c3]}
                  baseColor={view.wordColor}
                  characters={view.characters}
                  fontSize={view.fontSize}
                  spacing={view.spacing}
                density={1}
                baseOpacity={view.wordOpacity}
                glitchAmount={0}
                speed={view.speed}
                smooth={view.smooth}
                interactive={false}
                cursorRadius={0}
                clickEffect="none"
                flow={0}
                  edgeFade={0}
                  centerFade={0}
                  lightMode={light}
                  intro={false}
                />
              </div>
            </foreignObject>
          </svg>
        )}
      </div>
      {draft && (
        <BannerTuner
          params={draft}
          onChange={patch}
          onSave={save}
          onCancel={cancel}
          onReset={reset}
        />
      )}
    </>
  )
}
