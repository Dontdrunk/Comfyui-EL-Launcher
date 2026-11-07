import test from 'node:test'
import assert from 'node:assert/strict'
import { depDot, depVisualTone } from './depStatus.mjs'

test('没有 requirements.txt 的插件也算就绪：绿灯 + 可运行提示', () => {
  const dot = depDot(false, null)
  assert.equal(dot.tone, 'ok')
  assert.match(dot.hint, /可直接运行/)
  assert.equal(depDot(false, { total: 0, missing: 0 }).tone, 'ok')
})

test('还没拿到检查结果时是灰色（检查中）', () => {
  assert.equal(depDot(true, null).tone, 'idle')
  assert.match(depDot(true, null).hint, /正在检查/)
})

test('检查失败是灰色，并把错误带进提示', () => {
  const dot = depDot(true, { total: 3, missing: 3, error: 'python 起不来' })
  assert.equal(dot.tone, 'idle')
  assert.match(dot.hint, /python 起不来/)
})

test('全部装好 = 绿', () => {
  const dot = depDot(true, { total: 3, missing: 0 })
  assert.equal(dot.tone, 'ok')
  assert.match(dot.hint, /3\/3/)
})

test('部分缺失 = 黄', () => {
  const dot = depDot(true, { total: 5, missing: 2 })
  assert.equal(dot.tone, 'warn')
  assert.match(dot.hint, /缺少 2/)
})

test('一个都没装上 = 红', () => {
  const dot = depDot(true, { total: 3, missing: 3 })
  assert.equal(dot.tone, 'error')
  assert.match(dot.hint, /全部缺失/)
})

test('声明了依赖但 requirements 为空时也算就绪', () => {
  assert.equal(depDot(true, { total: 0, missing: 0 }).tone, 'ok')
})

test('边界：缺 1 个也算黄，不是红', () => {
  assert.equal(depDot(true, { total: 1, missing: 1 }).tone, 'error')
  assert.equal(depDot(true, { total: 2, missing: 1 }).tone, 'warn')
})
/* ── 指示器视觉状态 ── */

test('视觉状态：没声明依赖是 ok，未检查是 busy', () => {
  assert.equal(depVisualTone(false, null), 'ok')
  assert.equal(depVisualTone(true, null), 'busy')
})

test('视觉状态：检查失败退回 none（不再转圈）', () => {
  assert.equal(depVisualTone(true, { total: 3, missing: 3, error: 'boom' }), 'none')
})

test('视觉状态：绿黄红三档', () => {
  assert.equal(depVisualTone(true, { total: 3, missing: 0 }), 'ok')
  assert.equal(depVisualTone(true, { total: 5, missing: 2 }), 'warn')
  assert.equal(depVisualTone(true, { total: 3, missing: 3 }), 'error')
  assert.equal(depVisualTone(true, { total: 2, missing: 1 }), 'warn')
})

test('视觉状态：声明了但 requirements 为空 → ok', () => {
  assert.equal(depVisualTone(true, { total: 0, missing: 0 }), 'ok')
})