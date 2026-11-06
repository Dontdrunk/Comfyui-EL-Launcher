/**
 * 端口占用的纯逻辑：解析监听者、判断是不是「我们自己这套 ComfyUI」。
 * 不碰进程、不发请求，方便单测。
 */

/** 统一成小写反斜杠路径，方便跨来源比较（命令行里可能是 / 也可能是 \\） */
export function normalizePath(value) {
  return String(value ?? '')
    .replace(/\//g, '\\')
    .toLowerCase()
}

/**
 * 从 netstat -ano 的输出里取出「正在监听该端口」的 PID。
 *
 * 注意：本机（Windows 11 26300）的 netstat 会把部分 LISTENING 行的 PID 打成 0，
 * 甚至整行不输出，所以它只作为 PowerShell 不可用时的兜底；
 * 主路径走 Get-NetTCPConnection（见 pickOwner）。
 */
export function listenersOf(netstatText, port) {
  const want = Number(port)
  if (!Number.isInteger(want) || want <= 0) return []
  const pids = []
  for (const line of String(netstatText ?? '').split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 5) continue
    if (cols[0].toUpperCase() !== 'TCP') continue
    if (cols[3].toUpperCase() !== 'LISTENING') continue
    const local = cols[1]
    const localPort = Number(local.slice(local.lastIndexOf(':') + 1))
    const pid = Number(cols[4])
    if (localPort === want && Number.isInteger(pid) && pid > 0) pids.push(pid)
  }
  return [...new Set(pids)]
}

/** 进程名看着像 Python（python.exe / python3.13.exe） */
export function looksLikePython(owner) {
  return /^python[\d.]*\.exe$/i.test(String(owner?.name ?? '').trim())
}

/** 命令行里跑的是 ComfyUI 的入口脚本 */
export function looksLikeComfy(owner) {
  const cmd = normalizePath(owner?.commandLine)
  if (!looksLikePython(owner)) return false
  return cmd.includes('comfyui') && cmd.includes('main.py')
}

/**
 * 占用者是不是「当前 comfyRoot 这一套 ComfyUI」。
 * 判据：进程是 python，命令行跑 ComfyUI\\main.py，且主脚本就在 comfyRoot 下。
 * 拿不到命令行时一律不认——宁可让用户确认，也不要自动接管别人的进程。
 */
export function isOurComfy(owner, comfyRoot) {
  if (!looksLikeComfy(owner)) return false
  const root = normalizePath(comfyRoot).replace(/\\+$/, '')
  if (!root) return true
  // 带上路径分隔符，避免 ComfyUI-X 误吞 ComfyUI-X2
  return normalizePath(owner.commandLine).includes(root + '\\')
}

/** 是不是回环地址的监听（探测与访问都打 127.0.0.1，优先选它） */
export function isLoopback(address) {
  const a = String(address ?? '').trim().toLowerCase()
  return a === '127.0.0.1' || a === '::1' || a === 'localhost'
}

/**
 * 同一端口可能有多个监听者（本机实测：127.0.0.1 上是 ComfyUI，0.0.0.0 上可能是别的程序）。
 * 选一个最有代表性的交给 UI：优先本机这套 ComfyUI，其次回环监听，最后随便一个。
 */
export function pickOwner(candidates, comfyRoot) {
  const list = Array.isArray(candidates) ? candidates : []
  const usable = list.filter((c) => c && Number.isInteger(Number(c.pid)) && Number(c.pid) > 0)
  if (usable.length === 0) return null

  const ours = usable.find((c) => isOurComfy(c, comfyRoot))
  const chosen = ours ?? usable.find((c) => isLoopback(c.localAddress)) ?? usable[0]
  return {
    pid: Number(chosen.pid),
    name: chosen.name || 'unknown',
    commandLine: chosen.commandLine ?? null,
    isOurComfy: isOurComfy(chosen, comfyRoot)
  }
}
