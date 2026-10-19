import { useRef, useState } from 'react'
import {
  PRESETS,
  SLIDERS,
  WORD_FONTS,
  WORD_SLIDERS,
  applyPreset,
  matchPreset,
  sameStorm,
  type ClickEffect,
  type GlitchParams,
  type SliderSpec,
  type WordFont,
  type WordSliderSpec
} from './bannerParams'

/* ══════════════════════════════════════════════════════════
 * 横幅参数面板 —— 双击横幅打开
 *
 * 默认落在窗口正中，拖标题栏可以挪开。改任何一项都是**草稿**：
 * 横幅上立刻能看到效果，但要按「保存」才写进存储，「取消」就回到上次保存的样子。
 *
 * 面板是横幅的兄弟节点而不是子节点：横幅本身 overflow:hidden，塞进去会被裁掉。
 * ══════════════════════════════════════════════════════════ */

interface Props {
  params: GlitchParams
  onChange: (patch: Partial<GlitchParams>) => void
  onSave: () => void
  onCancel: () => void
  onReset: () => void
}

const CLICK_EFFECTS: { value: ClickEffect; label: string }[] = [
  { value: 'tear', label: '撕裂' },
  { value: 'burst', label: '爆裂' },
  { value: 'none', label: '关闭' }
]

const COLOR_ROWS: { key: 'baseColor' | 'c1' | 'c2' | 'c3'; label: string }[] = [
  { key: 'baseColor', label: '基础字色' },
  { key: 'c1', label: '暗档' },
  { key: 'c2', label: '中档' },
  { key: 'c3', label: '亮档' }
]

function SliderRow({
  spec,
  value,
  onChange
}: {
  spec: SliderSpec | WordSliderSpec
  value: number
  onChange: (v: number) => void
}): React.JSX.Element {
  const pct = ((value - spec.min) / (spec.max - spec.min)) * 100
  return (
    <label className="tuner__row">
      <span className="tuner__name">{spec.label}</span>
      <input
        className="slider"
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--v': pct + '%' } as React.CSSProperties}
      />
      <span className="tuner__val">{value.toFixed(spec.digits ?? 2)}</span>
    </label>
  )
}

export function BannerTuner({ params, onChange, onSave, onCancel, onReset }: Props): React.JSX.Element {
  /* 位置是相对窗口中心的偏移：默认 {0,0} 就是正中，拖了才有值 */
  const [off, setOff] = useState({ dx: 0, dy: 0 })
  const grab = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null)

  const down = (e: React.PointerEvent<HTMLDivElement>): void => {
    grab.current = { x: e.clientX, y: e.clientY, dx: off.dx, dy: off.dy }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent<HTMLDivElement>): void => {
    const g = grab.current
    if (!g) return
    const maxX = window.innerWidth / 2 - 70
    const maxY = window.innerHeight / 2 - 40
    setOff({
      dx: Math.min(Math.max(-maxX, g.dx + (e.clientX - g.x)), maxX),
      dy: Math.min(Math.max(-maxY, g.dy + (e.clientY - g.y)), maxY)
    })
  }
  const up = (e: React.PointerEvent<HTMLDivElement>): void => {
    grab.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* 指针已经松开 */
    }
  }

  /* 默认和数据流的雨相同，只靠数值分不出点的是哪一个 */
  const [picked, setPicked] = useState<string | null>(null)
  const hits = PRESETS.filter((pre) => sameStorm(params, pre.params)).map((pre) => pre.id)
  const activePreset = picked && hits.includes(picked) ? picked : (hits[0] ?? matchPreset(params))
  const anim = SLIDERS.slice(0, 4)
  const type = SLIDERS.slice(4, 7)
  const inter = [SLIDERS[7], SLIDERS[8], SLIDERS[9]]
  const num = (k: (typeof SLIDERS)[number]['key']) => (v: number) => onChange({ [k]: v } as Partial<GlitchParams>)

  return (
    <div
      className="tuner"
      style={{ transform: `translate(calc(-50% + ${off.dx}px), calc(-50% + ${off.dy}px))` }}
    >
      <div className="tuner__head" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <span className="tuner__title">横幅参数</span>
      </div>

      <div className="tuner__body">
        <div className="tuner__sec">预设</div>
        <div className="tuner__presets">
          {PRESETS.map((pre) => (
            <button
              key={pre.id}
              type="button"
              className={'tuner__preset' + (activePreset === pre.id ? ' tuner__preset--on' : '')}
              title={pre.hint}
              onClick={() => {
                setPicked(pre.id)
                onChange(applyPreset(params, pre.params))
              }}
            >
              {pre.label}
            </button>
          ))}
        </div>

        <div className="tuner__sec">动效</div>
        {anim.map((s) => (
          <SliderRow key={s.key} spec={s} value={params[s.key]} onChange={num(s.key)} />
        ))}

        <div className="tuner__sec">排版</div>
        {type.map((s) => (
          <SliderRow key={s.key} spec={s} value={params[s.key]} onChange={num(s.key)} />
        ))}
        <label className="tuner__row">
          <span className="tuner__name">字符集</span>
          <input
            className="tuner__text"
            type="text"
            spellCheck={false}
            value={params.characters}
            onChange={(e) => onChange({ characters: e.target.value })}
          />
        </label>

        <div className="tuner__sec">大字</div>
        <div className="tuner__row">
          <span className="tuner__name">显示</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={params.wordOn}
              onChange={(e) => onChange({ wordOn: e.target.checked })}
            />
            <span className="switch__track" />
          </label>
        </div>
        <label className="tuner__row">
          <span className="tuner__name">文字</span>
          <input
            className="tuner__text"
            type="text"
            spellCheck={false}
            value={params.word}
            placeholder="COMFYUI"
            onChange={(e) => onChange({ word: e.target.value })}
          />
        </label>
        <label className="tuner__row">
          <span className="tuner__name">字体</span>
          <select
            className="select tuner__select"
            value={params.wordFont}
            onChange={(e) => onChange({ wordFont: e.target.value as WordFont })}
          >
            {WORD_FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {WORD_SLIDERS.map((s) => (
          <SliderRow
            key={s.key}
            spec={s}
            value={params[s.key]}
            onChange={(v) => onChange({ [s.key]: v })}
          />
        ))}
        <label className="tuner__row">
          <span className="tuner__name">字色</span>
          <input
            className="tuner__color"
            type="color"
            value={params.wordColor}
            onChange={(e) => onChange({ wordColor: e.target.value })}
          />
          <span className="tuner__val tuner__val--hex">{params.wordColor}</span>
        </label>

        <div className="tuner__sec">颜色</div>
        {COLOR_ROWS.map((c) => (
          <label key={c.key} className="tuner__row">
            <span className="tuner__name">{c.label}</span>
            <input
              className="tuner__color"
              type="color"
              value={params[c.key]}
              onChange={(e) => onChange({ [c.key]: e.target.value } as Partial<GlitchParams>)}
            />
            <span className="tuner__val tuner__val--hex">{params[c.key]}</span>
          </label>
        ))}
        <div className="tuner__sec">交互</div>
        <div className="tuner__row">
          <span className="tuner__name">鼠标跟随</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={params.interactive}
              onChange={(e) => onChange({ interactive: e.target.checked })}
            />
            <span className="switch__track" />
          </label>
        </div>
        <div className="tuner__row">
          <span className="tuner__name">平滑</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={params.smooth}
              onChange={(e) => onChange({ smooth: e.target.checked })}
            />
            <span className="switch__track" />
          </label>
        </div>
        <label className="tuner__row">
          <span className="tuner__name">点击效果</span>
          <select
            className="select tuner__select"
            value={params.clickEffect}
            onChange={(e) => onChange({ clickEffect: e.target.value as ClickEffect })}
          >
            {CLICK_EFFECTS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {inter.map((s) => (
          <SliderRow key={s.key} spec={s} value={params[s.key]} onChange={num(s.key)} />
        ))}
      </div>

      <div className="tuner__foot">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setPicked(null)
            onReset()
          }}
        >
          恢复默认
        </button>
        <span className="tuner__spacer" />
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="btn btn--primary" onClick={onSave}>
          保存
        </button>
      </div>
    </div>
  )
}
