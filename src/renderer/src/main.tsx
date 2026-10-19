import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/global.css'
/* 外壳复刻层必须最后引入，用同名类覆盖 global.css 的外壳规则 */
import './styles/crazy.css'

// EP 的暗色变量挂在 html.dark 上；本项目主题用 data-theme，两个都挂上
document.documentElement.classList.add('dark')

const host = document.getElementById('root')
if (!host) throw new Error('缺少 #root 挂载点')

// 注意：刻意不使用 StrictMode —— 严格模式会重复执行副作用，
// 导致 IPC 订阅与运行时探测被执行两次，干扰日志与探测耗时。
createRoot(host).render(<App />)
