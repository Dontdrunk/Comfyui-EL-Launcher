/**
 * 端到端 UI 驱动脚本（零依赖）
 *
 * 原理：以 --remote-debugging-port 启动 Electron，用 Node 内置 WebSocket
 * 直连 DevTools Protocol，在真实渲染进程里执行 JS 并截图。
 * 不向产品代码注入任何测试开关。
 *
 * 用法：
 *   node scripts/e2e.mjs nav            # 逐页截图
 *   node scripts/e2e.mjs launch         # 真实启动 ComfyUI 并等待就绪
 *   node scripts/e2e.mjs theme          # 暗/亮主题截图
 *   node scripts/e2e.mjs narrow         # 最小窗口 1000×660 截图 + 溢出度量
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const shots = join(root, '.shots')

const PORT = 9222

/* ── CDP 客户端 ── */
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    })
  }

  send(method, params = {}, timeoutMs = 30_000) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 超时: ${method}`))
        }
      }, timeoutMs)
    })
  }

  /** 在页面里求值，返回 JS 值（偶发超时自动重试一次） */
  async eval(expression, retries = 1) {
    let lastErr = null
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await this.send('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true
        })
        if (r.exceptionDetails) {
          throw new Error(`页面求值异常: ${r.exceptionDetails.text} ${r.result?.description ?? ''}`)
        }
        return r.result?.value
      } catch (err) {
        lastErr = err
        // 页面自身抛出的异常不重试，只有传输层超时才重试
        if (!String(err.message).includes('CDP 超时')) throw err
        await new Promise((r) => setTimeout(r, 1200))
      }
    }
    throw lastErr
  }

  async shot(name) {
    await mkdir(shots, { recursive: true })
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const file = join(shots, `${name}.png`)
    await writeFile(file, Buffer.from(r.data, 'base64'))
    console.log(`[shot] ${file}`)
    return file
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForPageTarget(timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* 还没起来 */
    }
    await sleep(300)
  }
  throw new Error('等待渲染进程调试端点超时')
}

/* ── 启动器内的操作助手（注入到页面上下文） ── */
const HELPERS = `
window.__xl = {
  byText(sel, text) {
    return [...document.querySelectorAll(sel)].find(e => (e.textContent || '').includes(text)) || null
  },
  clickText(sel, text) {
    const el = window.__xl.byText(sel, text)
    if (!el) throw new Error('找不到元素: ' + sel + ' / ' + text)
    el.click()
    return true
  },
  nav(page) {
    window.dispatchEvent(new CustomEvent('xl:navigate', { detail: page }))
    return true
  },
  text(sel) {
    const el = document.querySelector(sel)
    return el ? el.textContent.trim() : null
  },
  dump() {
    return {
      title: document.title,
      page: (document.querySelector('.page-head__title') || {}).textContent || null,
      theme: document.documentElement.dataset.theme,
      bodyLen: document.body.innerText.length
    }
  }
}
`

async function main() {
  const scenario = process.argv[2] ?? 'nav'

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  delete env.XL_CAPTURE

  const electron = require('electron')
  const app = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const appLog = []
  app.stdout.on('data', (d) => appLog.push(String(d)))
  app.stderr.on('data', (d) => appLog.push(String(d)))

  let cdp = null
  try {
    const target = await waitForPageTarget()
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    cdp = new Cdp(ws)
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')

    // 等 React 引导完成（设置 + 环境检测）
    for (let i = 0; i < 60; i++) {
      const ready = await cdp.eval(`!!document.querySelector('.sidebar')`)
      if (ready) break
      await sleep(300)
    }
    await sleep(1200)
    await cdp.eval(HELPERS)

    console.log('[e2e] 页面已就绪:', JSON.stringify(await cdp.eval(`window.__xl.dump()`)))

    if (scenario === 'nav') {
      const pages = ['dashboard', 'versions', 'nodes', 'models', 'logs', 'settings']
      for (const p of pages) {
        await cdp.eval(`window.__xl.nav(${JSON.stringify(p)})`)
        await sleep(700)
        await cdp.shot(`page-${p}`)
      }
    } else if (scenario === 'narrow') {
      // 最小窗口（window.ts 的 minWidth/minHeight）：验证窄屏下不溢出、读数条不塌
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1000,
        height: 660,
        deviceScaleFactor: 1,
        mobile: false
      })
      for (const p of ['dashboard', 'versions', 'nodes', 'models']) {
        await cdp.eval(`window.__xl.nav(${JSON.stringify(p)})`)
        await sleep(900)
        await cdp.shot(`narrow-${p}`)
      }
      const overflow = await cdp.eval(`
        (() => {
          const main = document.querySelector('.app__main')
          return {
            mainScrollW: main ? main.scrollWidth : null,
            mainClientW: main ? main.clientWidth : null,
            readouts: [...document.querySelectorAll('.readouts')].map(r => r.clientWidth),
            railH: (document.querySelector('.statusrail') || {}).clientHeight ?? null
          }
        })()
      `)
      console.log('[e2e] 窄屏度量:', JSON.stringify(overflow))
      await cdp.send('Emulation.clearDeviceMetricsOverride')
    } else if (scenario === 'theme') {
      await cdp.shot('theme-current')
      // 标题栏最右侧按钮即主题切换
      await cdp.eval(`
        (() => {
          const btn = [...document.querySelectorAll('.titlebar__actions button')].pop()
          if (!btn) throw new Error('未找到主题切换按钮')
          btn.click()
          return true
        })()
      `)
      await sleep(900)
      const theme = await cdp.eval(`document.documentElement.dataset.theme`)
      console.log('[e2e] 切换后主题:', theme)
      await cdp.shot(`theme-${theme}`)
      await cdp.eval(`window.__xl.nav('settings')`)
      await sleep(700)
      await cdp.shot(`theme-${theme}-settings`)
    } else if (scenario === 'sidebar') {
      await cdp.eval(`window.__xl.nav('nodes')`)
      await sleep(600)
      await cdp.shot('sidebar-expanded')
      await cdp.eval(`
        (() => {
          const btn = document.querySelector('.sidebar__head button')
          if (btn) btn.click()
          return true
        })()
      `)
      await sleep(700)
      await cdp.shot('sidebar-collapsed')
    } else if (scenario === 'launch') {
      await cdp.eval(`window.__xl.nav('dashboard')`)
      await sleep(600)

      // 先关掉「自动打开浏览器」，避免测试时弹出用户浏览器（同时验证开关可用）
      const autoOpenOff = await cdp.eval(`
        (() => {
          const label = window.__xl.byText('.switch', '就绪后自动打开浏览器')
          if (!label) return 'switch-not-found'
          const input = label.querySelector('input')
          if (input && input.checked) label.click()
          return input && input.checked ? 'still-on' : 'off'
        })()
      `)
      console.log('[e2e] 自动开浏览器:', autoOpenOff)
      await sleep(400)

      console.log('[e2e] 点击「启动 ComfyUI」')
      await cdp.eval(`window.__xl.clickText('button', '启动 ComfyUI')`)

      // 最多等 4 分钟就绪
      const deadline = Date.now() + 240_000
      let status = null
      while (Date.now() < deadline) {
        status = await cdp.eval(`
          (() => {
            const led = document.querySelector('.statusrail .led')
            const err = [...document.querySelectorAll('.notice--error .notice__title')].map(e => e.textContent)
            return { led: led ? led.textContent.trim() : null, errors: err }
          })()
        `)
        if (status?.led?.includes('运行中') || status?.led?.includes('异常')) break
        await sleep(2000)
      }
      console.log('[e2e] 启动结果:', JSON.stringify(status))
      await sleep(1500)
      await cdp.shot('launch-running')

      // 用主进程之外的方式独立验证：直接 HTTP 探测
      try {
        const r = await fetch('http://127.0.0.1:8188/system_stats')
        const j = await r.json()
        console.log(
          '[e2e] 独立 HTTP 验证 /system_stats =>',
          JSON.stringify({
            status: r.status,
            comfyui: j.system?.comfyui_version,
            python: j.system?.python_version?.split(' ')[0],
            torch: j.system?.pytorch_version,
            device: j.devices?.[0]?.name
          })
        )
      } catch (e) {
        console.log('[e2e] 独立 HTTP 验证失败:', e.message)
      }

      // 抓一段真实日志尾部
      const tail = await cdp.eval(`
        [...document.querySelectorAll('.terminal__line')].slice(-14).map(l => l.innerText)
      `)
      console.log('[e2e] 日志尾部:')
      for (const line of tail ?? []) console.log('   ', line)

      console.log('[e2e] 点击「停止 ComfyUI」')
      await cdp.eval(`window.__xl.clickText('button', '停止 ComfyUI')`)
      await sleep(7000)
      const after = await cdp.eval(`
        (() => {
          const led = document.querySelector('.statusrail .led')
          return led ? led.textContent.trim() : null
        })()
      `)
      console.log('[e2e] 停止后状态:', after)
      await cdp.shot('launch-stopped')
    } else if (scenario === 'models') {
      await cdp.eval(`window.__xl.nav('models')`)
      await sleep(2500)
      await cdp.shot('models-before')

      await cdp.eval(`window.__xl.clickText('button', '开始扫描')`)
      console.log('[e2e] 已触发扫描，等待完成…')

      const deadline = Date.now() + 180_000
      let done = false
      while (Date.now() < deadline) {
        done = await cdp.eval(`document.body.innerText.includes('体积分布') && document.querySelectorAll('.cat-row').length > 0`)
        if (done) break
        await sleep(1500)
      }
      console.log('[e2e] 扫描完成:', done)
      await sleep(1200)
      await cdp.shot('models-scanned')

      const summary = await cdp.eval(`
        (() => {
          const rows = [...document.querySelectorAll('.cat-row__head')].map(r => r.innerText.replace(/\\s+/g,' ').trim())
          const readouts = [...document.querySelectorAll('.readout')].map(r => r.innerText.replace(/\\s+/g,' ').trim())
          return { readouts, rows: rows.slice(0, 12) }
        })()
      `)
      console.log('[e2e] 读数:', JSON.stringify(summary.readouts))
      console.log('[e2e] 分类:')
      for (const r of summary.rows) console.log('   ', r)

      // 展开第一个分类
      if (summary.rows.length > 0) {
        await cdp.eval(`document.querySelector('.cat-row__head').click()`)
        await sleep(900)
        await cdp.shot('models-category-expanded')
      }
    } else if (scenario === 'presets') {
      await cdp.eval(`window.__xl.nav('dashboard')`)
      await sleep(2000)
      await cdp.shot('presets-default')

      const before = await cdp.eval(`
        (() => {
          const input = [...document.querySelectorAll('input')].find(i => (i.placeholder||'').includes('lowvram'))
          return input ? input.value : null
        })()
      `)
      console.log('[e2e] 应用预设前 附加参数:', JSON.stringify(before))

      // 点「低显存模式」
      const applied = await cdp.eval(`
        (() => {
          const chip = [...document.querySelectorAll('.preset-chip')].find(c => c.textContent.includes('低显存'))
          if (!chip) return 'chip-not-found'
          chip.click()
          return 'clicked'
        })()
      `)
      console.log('[e2e] 点击低显存预设:', applied)
      await sleep(1500)

      const after = await cdp.eval(`
        (() => {
          const input = [...document.querySelectorAll('input')].find(i => (i.placeholder||'').includes('lowvram'))
          const active = document.querySelector('.preset-chip--active')
          return { extraArgs: input ? input.value : null, active: active ? active.textContent.trim() : null }
        })()
      `)
      console.log('[e2e] 应用预设后:', JSON.stringify(after))
      await cdp.shot('presets-applied')

      // 另存为预设
      await cdp.eval(`window.__xl.clickText('button', '另存为预设')`)
      await sleep(900)
      await cdp.shot('presets-save-dialog')
      await cdp.eval(`
        (() => {
          const input = [...document.querySelectorAll('.modal input')][0]
          if (!input) throw new Error('找不到名称输入框')
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
          setter.call(input, 'e2e 测试预设')
          input.dispatchEvent(new Event('input', { bubbles: true }))
          return true
        })()
      `)
      await sleep(500)
      await cdp.eval(`
        (() => {
          const btn = [...document.querySelectorAll('.modal__foot button')].find(b => b.textContent.includes('保存预设'))
          if (!btn) throw new Error('找不到保存按钮')
          btn.click()
          return true
        })()
      `)
      await sleep(1800)
      const chips = await cdp.eval(`[...document.querySelectorAll('.preset-chip')].map(c => c.textContent.trim())`)
      console.log('[e2e] 预设列表:', JSON.stringify(chips))
      await cdp.shot('presets-saved')
    } else if (scenario === 'nodes') {
      const { existsSync, readdirSync } = await import('node:fs')
      const nodesDir = 'D:\\Projects\\Procedure\\ComfyUI-X\\ComfyUI\\custom_nodes'
      const target = 'ComfyUI-string-util'

      await cdp.eval(`window.__xl.nav('nodes')`)
      await sleep(2500)
      await cdp.shot('nodes-empty')
      console.log('[e2e] 安装前 custom_nodes:', JSON.stringify(readdirSync(nodesDir)))

      // 切到插件安装
      await cdp.eval(`window.__xl.clickText('.segmented__item', '插件安装')`)
      await sleep(3500)
      await cdp.shot('nodes-search-default')

      // 搜索目标插件
      await cdp.eval(`
        (() => {
          const input = [...document.querySelectorAll('input')].find(i => (i.placeholder||'').includes('Registry'))
          if (!input) throw new Error('找不到搜索框')
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
          setter.call(input, 'string util')
          input.dispatchEvent(new Event('input', { bubbles: true }))
          return true
        })()
      `)
      await sleep(4000)
      await cdp.shot('nodes-search-result')

      const found = await cdp.eval(`
        (() => {
          const cards = [...document.querySelectorAll('.plugin-card')]
          const card = cards.find(c => c.textContent.includes('string-util') || c.textContent.includes('String'))
          return cards.length === 0 ? 'no-cards' : (card ? card.querySelector('.plugin-card__name').textContent : 'target-not-found')
        })()
      `)
      console.log('[e2e] 搜索结果首卡:', found)

      // 安装
      const clicked = await cdp.eval(`
        (() => {
          const cards = [...document.querySelectorAll('.plugin-card')]
          const card = cards.find(c => c.textContent.includes('string-util'))
          if (!card) return 'card-not-found'
          const btn = [...card.querySelectorAll('button')].find(b => b.textContent.includes('安装'))
          if (!btn) return 'install-button-not-found'
          if (btn.disabled) return 'install-button-disabled'
          btn.click()
          return 'clicked'
        })()
      `)
      console.log('[e2e] 点击安装:', clicked)

      // 等任务结束
      const deadline = Date.now() + 240_000
      let state = null
      while (Date.now() < deadline) {
        state = await cdp.eval(`
          (() => {
            const tag = document.querySelector('.stack .tag')
            const txt = document.body.innerText
            return { jobTag: tag ? tag.textContent.trim() : null, hasTask: txt.includes('任务输出') }
          })()
        `)
        if (state?.jobTag && state.jobTag !== '进行中') break
        await sleep(2000)
      }
      console.log('[e2e] 安装任务状态:', JSON.stringify(state))
      await sleep(1500)
      await cdp.shot('nodes-installed')

      const jobTail = await cdp.eval(`
        [...document.querySelectorAll('.terminal__line')].slice(-30).map(l => l.innerText)
      `)
      console.log('[e2e] 任务日志尾部:')
      for (const line of jobTail ?? []) console.log('   ', String(line).replace(/\s+/g, ' '))

      // 独立用文件系统复核
      console.log('[e2e] 安装后目录存在:', existsSync(`${nodesDir}\\${target}`))
      console.log('[e2e] 安装后 custom_nodes:', JSON.stringify(readdirSync(nodesDir)))

      // 依赖体检
      await cdp.eval(`window.__xl.clickText('button', '依赖体检')`)
      await sleep(12000)
      await cdp.shot('nodes-deps')

      // 回已安装页
      await cdp.eval(`window.__xl.clickText('.segmented__item', '已安装')`)
      await sleep(1000)
      await cdp.shot('nodes-installed-list')

      // 卸载
      const uninstall = await cdp.eval(`
        (() => {
          const rows = [...document.querySelectorAll('.table tbody tr')]
          const row = rows.find(r => r.textContent.includes('string-util'))
          if (!row) return 'row-not-found'
          const btn = row.querySelector('button.btn--danger')
          if (!btn) return 'uninstall-button-not-found'
          btn.click()
          return 'clicked'
        })()
      `)
      console.log('[e2e] 点击卸载:', uninstall)
      if (uninstall === 'clicked') {
        await sleep(1200)
        await cdp.shot('nodes-uninstall-confirm')

        await cdp.eval(`
          (() => {
            const btns = [...document.querySelectorAll('.modal__foot button')]
            const ok = btns.find(b => b.textContent.includes('移入回收站'))
            if (!ok) throw new Error('找不到确认卸载按钮')
            ok.click()
            return true
          })()
        `)
      }

      const deadline2 = Date.now() + 120_000
      while (Date.now() < deadline2) {
        if (!existsSync(`${nodesDir}\\${target}`)) break
        await sleep(1500)
      }
      await sleep(2000)
      console.log('[e2e] 卸载后目录存在:', existsSync(`${nodesDir}\\${target}`))
      console.log('[e2e] 卸载后 custom_nodes:', JSON.stringify(readdirSync(nodesDir)))
      await cdp.shot('nodes-after-uninstall')
    } else if (scenario === 'restore') {
      await cdp.eval(`window.__xl.nav('versions')`)
      await sleep(3000)

      // 打开第一个备份的详情
      const detail = await cdp.eval(`
        (() => {
          const btns = [...document.querySelectorAll('.table button')].filter(b => b.textContent.trim() === '详情')
          if (btns.length === 0) return 'no-backup'
          btns[0].click()
          return 'opened'
        })()
      `)
      console.log('[e2e] 打开备份详情:', detail)
      await sleep(1500)
      await cdp.shot('restore-detail')

      const detailText = await cdp.eval(`
        (() => { const m = document.querySelector('.modal'); return m ? m.innerText.slice(0,1200) : null })()
      `)
      console.log('[e2e] 备份详情:\n' + detailText)

      // 关闭详情
      await cdp.eval(`
        (() => {
          const m = document.querySelector('.modal__head button')
          if (m) m.click()
          return true
        })()
      `)
      await sleep(700)

      // 点还原
      const restored = await cdp.eval(`
        (() => {
          const btns = [...document.querySelectorAll('.table button')].filter(b => b.textContent.trim() === '还原')
          if (btns.length === 0) return 'no-restore-button'
          btns[0].click()
          return 'clicked'
        })()
      `)
      console.log('[e2e] 点击还原:', restored)
      await sleep(1200)
      await cdp.shot('restore-confirm')

      await cdp.eval(`
        (() => {
          const btns = [...document.querySelectorAll('.modal__foot button')]
          const ok = btns.find(b => b.textContent.includes('确认还原'))
          if (!ok) throw new Error('找不到确认还原按钮')
          ok.click()
          return true
        })()
      `)
      console.log('[e2e] 已确认还原，等待完成…')

      const deadline = Date.now() + 180_000
      let done = false
      while (Date.now() < deadline) {
        done = await cdp.eval(`document.body.innerText.includes('已还原')`)
        if (done) break
        await sleep(2000)
      }
      console.log('[e2e] 还原完成:', done)
      await sleep(1200)
      await cdp.shot('restore-done')

      const { execFileSync } = await import('node:child_process')
      console.log(
        '[e2e] git 独立复核 HEAD =>',
        execFileSync('git', ['-C', 'D:\\Projects\\Procedure\\ComfyUI-X\\ComfyUI', 'log', '-1', '--format=%h %s'], {
          encoding: 'utf-8'
        }).trim()
      )
    } else if (scenario === 'versions') {
      await cdp.eval(`window.__xl.nav('versions')`)
      // 等远端 tag 列表 + GitHub 更新检查回来
      await sleep(6000)
      await cdp.shot('versions-overview')

      await cdp.eval(`window.__xl.clickText('.segmented__item', '全部远端')`)
      await sleep(1500)
      await cdp.shot('versions-remote')

      // 打开 v0.39.2 的切换确认弹窗
      const opened = await cdp.eval(`
        (() => {
          const rows = [...document.querySelectorAll('.table tbody tr')]
          const row = rows.find(r => r.textContent.includes('v0.39.2'))
          if (!row) return 'row-not-found'
          const btn = [...row.querySelectorAll('button')].find(b => b.textContent.includes('切换'))
          if (!btn) return 'button-not-found'
          btn.click()
          return 'clicked'
        })()
      `)
      console.log('[e2e] 打开切换弹窗:', opened)
      await sleep(3000)
      await cdp.shot('versions-plan')

      const planText = await cdp.eval(`
        (() => {
          const m = document.querySelector('.modal')
          return m ? m.innerText.slice(0, 1800) : null
        })()
      `)
      console.log('[e2e] 切换确认弹窗内容:\n' + planText)

      // 关掉弹窗
      await cdp.eval(`
        (() => {
          const btns = [...document.querySelectorAll('.modal__foot button')]
          const cancel = btns.find(b => b.textContent.trim() === '取消')
          if (cancel) cancel.click()
          return true
        })()
      `)
      await sleep(600)
      await cdp.eval(`window.__xl.clickText('.segmented__item', '分支与回滚点')`)
      await sleep(1000)
      await cdp.shot('versions-rollback')
    } else if (scenario === 'switch') {
      const target = process.argv[3] ?? 'v0.39.2'
      await cdp.eval(`window.__xl.nav('versions')`)
      await sleep(3000)
      await cdp.eval(`window.__xl.clickText('.segmented__item', '全部远端')`)
      await sleep(1200)

      const opened = await cdp.eval(`
        (() => {
          const rows = [...document.querySelectorAll('.table tbody tr')]
          const row = rows.find(r => r.textContent.includes(${JSON.stringify(target)}))
          if (!row) return 'row-not-found'
          const btn = [...row.querySelectorAll('button')].find(b => b.textContent.includes('切换'))
          if (!btn) return 'button-not-found'
          btn.click()
          return 'clicked'
        })()
      `)
      console.log('[e2e] 打开切换弹窗:', opened)
      await sleep(2500)
      await cdp.shot(`switch-plan-${target}`)

      // 确认切换
      await cdp.eval(`
        (() => {
          const btns = [...document.querySelectorAll('.modal__foot button')]
          const ok = btns.find(b => b.textContent.includes('确认切换'))
          if (!ok) throw new Error('找不到确认按钮')
          ok.click()
          return true
        })()
      `)
      console.log('[e2e] 已点击确认切换，等待任务完成…')

      // 轮询任务状态
      const deadline = Date.now() + 300_000
      let done = null
      while (Date.now() < deadline) {
        done = await cdp.eval(`
          (() => {
            const tag = document.querySelector('.stack .tag')
            const txt = document.body.innerText
            const cur = (document.querySelector('.readout') || {}).textContent || ''
            return { body: txt.includes('切换结果'), jobTag: tag ? tag.textContent.trim() : null, cur }
          })()
        `)
        if (done?.body) break
        await sleep(2000)
      }
      console.log('[e2e] 切换结束:', JSON.stringify(done))
      await sleep(1000)
      await cdp.shot(`switch-done-${target}`)

      // 独立用 git 复核真实 HEAD
      const { execFileSync } = await import('node:child_process')
      const head = execFileSync('git', ['-C', 'D:\\Projects\\Procedure\\ComfyUI-X\\ComfyUI', 'log', '-1', '--format=%h %s'], { encoding: 'utf-8' }).trim()
      console.log('[e2e] git 独立复核 HEAD =>', head)
    } else {
      throw new Error(`未知场景: ${scenario}`)
    }

    console.log('[e2e] 完成')
  } catch (err) {
    console.error('[e2e] 失败:', err.message)
    console.error('--- 应用输出 ---')
    console.error(appLog.join('').slice(-4000))
    process.exitCode = 1
  } finally {
    try {
      cdp?.ws.close()
    } catch {
      /* ignore */
    }
    app.kill()
    setTimeout(() => {
      try {
        spawn('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
      } catch {
        /* ignore */
      }
    }, 300)
    await sleep(800)
  }
}

main()
