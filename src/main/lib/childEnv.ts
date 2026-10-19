/**
 * 构造子进程环境变量。
 *
 * 便携版 ComfyUI 由 .bat 拉起，.bat 本身不做任何环境设置，
 * 因此这里统一注入，保证：
 *  - Python 输出为 UTF-8 且不缓冲（否则日志面板要等进程结束才出内容）
 *  - git 不因等待凭据输入而永久挂起
 *  - pip 不因交互确认而挂起
 */
export function buildChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  /* ---- Python：强制 UTF-8 + 关闭缓冲 ---- */
  env.PYTHONUTF8 = '1'
  env.PYTHONIOENCODING = 'utf-8'
  env.PYTHONUNBUFFERED = '1'
  env.PYTHONNOUSERSITE = '1'
  env.PYTHONDONTWRITEBYTECODE = '1'

  /* ---- git：绝不交互等待输入 ---- */
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_PAGER = 'cat'
  /* 凭据管理器自己还有一套弹窗。不关掉的话，拉取已经结束它还停在那里等输入，任务就一直停在 running */
  env.GCM_INTERACTIVE = 'Never'
  env.GIT_CONFIG_NOSYSTEM = '0'
  // 让 git 输出不因中文路径被转义为八进制
  env.LC_ALL = 'C.UTF-8'
  env.LANG = 'C.UTF-8'

  /* ---- pip：非交互、不检查版本、不缓存轮询 ---- */
  env.PIP_DISABLE_PIP_VERSION_CHECK = '1'
  env.PIP_NO_INPUT = '1'
  env.PIP_PROGRESS_BAR = 'off'

  // 宿主环境可能带有 ELECTRON_RUN_AS_NODE，绝不能泄漏给下游子进程
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE

  return env
}
