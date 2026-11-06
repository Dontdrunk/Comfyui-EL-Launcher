import test from 'node:test'
import assert from 'node:assert/strict'
import { filterByName, hitsName, paginate } from './registryPlan.mjs'

/* 下面这组样本直接取自 api.comfy.org 搜索 "MD" 的真实返回：
   服务端 54 条，名称真正带 md 的 22 条，其余是描述里的 md。 */
const SAMPLE = [
  { id: 'comfyui-amd-qwen-image', name: 'ComfyUI-AMD-Qwen-Image-2.1', description: 'amd gpu' },
  { id: 'comfyui-mdsnodes', name: 'ComfyUI-MDSNodes', description: null },
  { id: 'maskgct-comfyui', name: 'MaskGCT-ComfyUI', description: 'multimodal mask generation' },
  { id: 'xb_toolbox', name: 'XB_ToolBox', description: 'a toolbox with md5 helper' },
  { id: 'dots-tts', name: 'Dots TTS', description: 'tts by md' },
  { id: 'comfyui-md5', name: 'ComfyUI_md5', description: null },
  { id: 'comfyui-streamdiffusion', name: 'ComfyUI-StreamDiffusion', description: 'real-time' },
  { id: 'feixue-monitor', name: '飞雪监测器 - Feixue Universal Monitor', description: 'monitor with md output' }
]

test('hitsName: 名称包含关键字（不区分大小写）', () => {
  assert.equal(hitsName(SAMPLE[1], 'MD'), true)
  assert.equal(hitsName(SAMPLE[1], 'md'), true)
  assert.equal(hitsName(SAMPLE[5], 'md5'), true)
})

test('hitsName: 只有描述命中不算，这是本次要修的核心行为', () => {
  for (const node of [SAMPLE[2], SAMPLE[3], SAMPLE[4], SAMPLE[7]]) {
    assert.equal(hitsName(node, 'MD'), false, node.name + ' 不该被名称搜索命中')
  }
})

test('hitsName: id 也参与匹配（registry 的 id 就是仓库名）', () => {
  assert.equal(hitsName({ id: 'comfyui-mdnotes', name: '笔记' }, 'mdnotes'), true)
})

test('hitsName: 空关键字视为全部命中', () => {
  assert.equal(hitsName(SAMPLE[0], ''), true)
  assert.equal(hitsName(SAMPLE[0], '   '), true)
})

test('filterByName: 保持原顺序并剔除描述命中的结果', () => {
  // 注意 ComfyUI-StreamDiffusion：stre"amD"iffusion 里确实含 md，属于名称命中，保留
  const got = filterByName(SAMPLE, 'MD').map((n) => n.name)
  assert.deepEqual(got, [
    'ComfyUI-AMD-Qwen-Image-2.1',
    'ComfyUI-MDSNodes',
    'ComfyUI_md5',
    'ComfyUI-StreamDiffusion'
  ])
})

test('filterByName: 空关键字原样返回（热门列表不筛）', () => {
  assert.deepEqual(filterByName(SAMPLE, ''), SAMPLE)
})

test('filterByName: 非法输入不炸', () => {
  assert.deepEqual(filterByName(null, 'md'), [])
  assert.deepEqual(filterByName(undefined, ''), [])
})

test('paginate: 按页切片并给出过滤后的总数', () => {
  const list = Array.from({ length: 13 }, (_, i) => ({ id: 'n' + i, name: 'n' + i }))
  const p1 = paginate(list, 1, 6)
  assert.equal(p1.total, 13)
  assert.equal(p1.totalPages, 3)
  assert.equal(p1.pageSize, 6)
  assert.equal(p1.nodes.length, 6)
  assert.equal(p1.nodes[0].id, 'n0')

  const p3 = paginate(list, 3, 6)
  assert.equal(p3.nodes.length, 1)
  assert.equal(p3.nodes[0].id, 'n12')
})

test('paginate: 页码越界夹回范围内，不返回空页', () => {
  const list = Array.from({ length: 7 }, (_, i) => ({ id: 'n' + i }))
  assert.equal(paginate(list, 99, 3).page, 3)
  assert.equal(paginate(list, 99, 3).nodes.length, 1)
  assert.equal(paginate(list, 0, 3).page, 1)
  assert.equal(paginate(list, -5, 3).page, 1)
})

test('paginate: 空结果也返回合法的第 1 页', () => {
  const p = paginate([], 1, 6)
  assert.deepEqual([p.total, p.page, p.totalPages, p.nodes.length], [0, 1, 1, 0])
})

test('paginate: 每页条数非法时兜底为 1', () => {
  const p = paginate([{ id: 'a' }, { id: 'b' }], 1, 0)
  assert.equal(p.pageSize, 1)
  assert.equal(p.totalPages, 2)
})