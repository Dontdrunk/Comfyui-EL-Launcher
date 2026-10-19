import { join } from 'node:path'

/**
 * 由 ComfyUI 便携版根目录推导出全部关键路径。
 * 只做字符串拼接，不做存在性检查（存在性判断属于 env 服务）。
 */
export interface ComfyPaths {
  root: string
  /** 内置解释器 */
  pythonExe: string
  pythonDir: string
  /** ComfyUI 代码目录（git 仓库所在处） */
  comfyDir: string
  mainPy: string
  customNodesDir: string
  modelsDir: string
  outputDir: string
  inputDir: string
  tempDir: string
  userDir: string
  /** 官方 updater 目录 */
  updateDir: string
  updateScript: string
  gitDir: string
  versionFile: string
  requirementsFile: string
  extraModelPaths: string
  extraModelPathsExample: string
  /** 启动器自身的数据目录（位于便携版根目录下，不侵入 git 仓库） */
  dataDir: string
  backupsDir: string
  /** pip freeze 清单，与版本备份目录分开 */
  envBackupsDir: string
  logsDir: string
}

export const DATA_DIR_NAME = '_explorer-launcher'

export function resolveComfyPaths(root: string): ComfyPaths {
  const comfyDir = join(root, 'ComfyUI')
  const dataDir = join(root, DATA_DIR_NAME)
  return {
    root,
    pythonDir: join(root, 'python_embeded'),
    pythonExe: join(root, 'python_embeded', 'python.exe'),
    comfyDir,
    mainPy: join(comfyDir, 'main.py'),
    customNodesDir: join(comfyDir, 'custom_nodes'),
    modelsDir: join(comfyDir, 'models'),
    outputDir: join(comfyDir, 'output'),
    inputDir: join(comfyDir, 'input'),
    tempDir: join(comfyDir, 'temp'),
    userDir: join(comfyDir, 'user'),
    updateDir: join(root, 'update'),
    updateScript: join(root, 'update', 'update.py'),
    gitDir: join(comfyDir, '.git'),
    versionFile: join(comfyDir, 'comfyui_version.py'),
    requirementsFile: join(comfyDir, 'requirements.txt'),
    extraModelPaths: join(comfyDir, 'extra_model_paths.yaml'),
    extraModelPathsExample: join(comfyDir, 'extra_model_paths.yaml.example'),
    dataDir,
    backupsDir: join(dataDir, 'backups'),
    envBackupsDir: join(dataDir, 'env-backups'),
    logsDir: join(dataDir, 'logs')
  }
}

/** 备份目录名：backups/20261013_153000 */
export function backupId(date = new Date()): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  )
}
