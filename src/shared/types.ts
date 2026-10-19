/**
 * 探索者启动器 —— 主进程 / 渲染进程共享领域模型
 *
 * 该文件是整个应用的类型契约：主进程实现、渲染进程消费，
 * 双方只通过这里声明的结构与 IPC 通道交互。
 */

/* ══════════════════════════════════════════════════════════
 * 设置
 * ══════════════════════════════════════════════════════════ */

export type ThemeMode = 'dark' | 'light'
export type LaunchMode = 'gpu' | 'cpu'

/** 启动默认值 */
export interface LaunchDefaults {
  mode: LaunchMode
  /** 监听地址（--listen），仅在开启远程访问时生效；留空按 0.0.0.0 */
  listen: string
  port: number
  /** 允许局域网/远程访问；关闭时只监听 127.0.0.1 */
  remote: boolean
  /** 启动就绪后自动打开浏览器（关掉会传 --disable-auto-launch） */
  autoOpenBrowser: boolean
  extraArgs: string
  /** --fast fp16_accumulation */
  fastFp16: boolean
  /** --disable-api-nodes */
  disableApiNodes: boolean
}

export interface AppSettings {
  /** ComfyUI 便携版根目录，例如 D:\Projects\Procedure\ComfyUI-X */
  comfyRoot: string
  theme: ThemeMode
  launch: LaunchDefaults
  /** 启动参数预设（含内置） */
  presets: LaunchPreset[]
  /** 当前选中的预设 id，null 表示自定义 */
  activePresetId: string | null
}

/* ══════════════════════════════════════════════════════════
 * 环境探测
 * ══════════════════════════════════════════════════════════ */

export type IssueLevel = 'error' | 'warn' | 'info'

export interface EnvIssue {
  level: IssueLevel
  message: string
  hint?: string
}

/** 目录结构探测结果（纯文件系统检查，快速） */
export interface EnvLayout {
  root: string
  /** 三件套齐全即视为可用便携版 */
  valid: boolean
  portable: boolean
  issues: EnvIssue[]
  pythonExe: string | null
  comfyDir: string | null
  mainPy: string | null
  customNodesDir: string | null
  modelsDir: string | null
  outputDir: string | null
  updateDir: string | null
  updateScript: string | null
  /** ComfyUI/.git 是否存在 */
  isGitRepo: boolean
  /** comfyui_version.py 中读到的版本号 */
  appVersion: string | null
  /** ComfyUI 根目录总占用（字节），懒计算 */
  diskUsage: number | null
}

/** 运行时探测结果（需要拉起 python，较慢） */
export interface RuntimeInfo {
  probed: boolean
  ok: boolean
  pythonVersion: string | null
  torchVersion: string | null
  cudaVersion: string | null
  cudaAvailable: boolean
  gpuName: string | null
  deviceCount: number
  pipVersion: string | null
  error: string | null
  probedAt: number | null
}

/* ══════════════════════════════════════════════════════════
 * 磁盘容量（模型页展示剩余空间）
 * ══════════════════════════════════════════════════════════ */

export interface DiskProbe {
  diskFreeBytes: number | null
  diskTotalBytes: number | null
  /** 根目录所在盘符，例如 D: */
  drive: string | null
}

/* ══════════════════════════════════════════════════════════
 * 日志 / 任务
 * ══════════════════════════════════════════════════════════ */

export type LogStream = 'stdout' | 'stderr' | 'system'

export interface LogLine {
  seq: number
  ts: number
  stream: LogStream
  text: string
}

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'canceled'

export interface JobSnapshot {
  id: string
  kind: string
  title: string
  status: JobStatus
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  error: string | null
  lines: LogLine[]
  /** 0-100，null 表示不确定进度 */
  percent: number | null
}

export type JobEventKind = 'created' | 'line' | 'progress' | 'finished'

export interface JobEvent {
  jobId: string
  kind: JobEventKind
  snapshot?: JobSnapshot
  line?: LogLine
  percent?: number | null
}

/* ══════════════════════════════════════════════════════════
 * ComfyUI 服务进程
 * ══════════════════════════════════════════════════════════ */

export type ServiceState = 'stopped' | 'launching' | 'running' | 'stopping' | 'error'

export interface ServiceStatus {
  state: ServiceState
  pid: number | null
  port: number
  /** http://127.0.0.1:<port> */
  url: string | null
  /** /system_stats 探测通过 */
  ready: boolean
  startedAt: number | null
  exitedAt: number | null
  exitCode: number | null
  /** 启动时使用的完整命令行，便于排障 */
  commandLine: string | null
  lastError: string | null
  /** 启动耗时（ms），就绪后填充 */
  bootMs: number | null
}

/* ══════════════════════════════════════════════════════════
 * 版本管理（M2）
 * ══════════════════════════════════════════════════════════ */

export type RefKind = 'tag' | 'branch' | 'backup-branch' | 'commit'

export interface VersionRef {
  name: string
  kind: RefKind
  commit: string
  shortCommit: string
  date: string | null
  subject: string | null
  isCurrent: boolean
  /** 本地是否已有该 ref 的对象（false 表示需要先 fetch） */
  fetched: boolean
}

export interface HeadInfo {
  commit: string
  shortCommit: string
  tag: string | null
  branch: string | null
  detached: boolean
  date: string | null
  subject: string | null
  /** comfyui_version.py 读到的版本号 */
  appVersion: string | null
}

/**
 * 本地提交历史的一行。
 * 版本列表直接用 git log，所以每行天然带说明与时间 —— 与疯狂启动器同一套逻辑。
 */
export interface CommitInfo {
  sha: string
  shortSha: string
  date: string | null
  subject: string
}

export interface VersionState {
  isRepo: boolean
  head: HeadInfo | null
  /** 工作区是否干净 */
  clean: boolean
  dirtyCount: number
  stashedCount: number
  remote: string | null
  refs: VersionRef[]
  /**
   * 与最新发版的谱系关系。判「是否最新」只看它，不看 comfyui_version.py ——
   * 发行线以外的提交（PR 分支、浅取碎片）里那个文件停在旧值。
   */
  release: {
    /** 本地语义版本最大的 tag；一个都没有时为 null */
    newestTag: string | null
    /** HEAD 独有 / 最新 tag 独有的提交数（浅克隆下会少算，但方向可靠） */
    ahead: number
    behind: number
    /** HEAD 属于哪个发版的历史（git describe --contains HEAD）；不在任何 tag 上时为 null */
    willShipIn: string | null
  } | null
  error: string | null
}

export interface ReleaseInfo {
  tag: string
  name: string
  publishedAt: string
  body: string
  url: string
  prerelease: boolean
}

export interface UpdateCheck {
  current: string | null
  latest: string | null
  hasUpdate: boolean
  release: ReleaseInfo | null
  /** 最近若干条 release，用于更新日志列表 */
  releases: ReleaseInfo[]
  checkedAt: number
  fromCache: boolean
  error: string | null
}

export interface BackupSnapshot {
  id: string
  dir: string
  createdAt: number
  tag: string | null
  commit: string
  branch: string | null
  appVersion: string | null
  nodeCount: number
  dirty: boolean
  /** 该备份是否已被还原过 */
  restoredAt: number | null
}

/** 备份里的单个插件条目（仅清单，不含插件文件内容） */
export interface BackupNodeEntry {
  dirName: string
  baseName: string
  enabled: boolean
  isGit: boolean
  remote: string | null
  commit: string | null
  dirty: boolean
}

export interface BackupDetail {
  snapshot: BackupSnapshot
  remote: string | null
  /** 备份时是否为脏工作区 */
  dirty: boolean
  hasUserConfig: boolean
  hasExtraModelPaths: boolean
  nodes: BackupNodeEntry[]
  /** 备份目录内的文件清单 */
  files: { relative: string; size: number }[]
  error: string | null
}

export interface RestoreResult {
  snapshotId: string
  fromCommit: string | null
  toCommit: string
  userConfigRestored: boolean
  /** 备份清单里有、但当前 custom_nodes 中已不存在（不会被自动补装） */
  missingNodes: string[]
  /** 当前存在、但备份清单里没有 */
  extraNodes: string[]
}

/** 版本切换后的依赖差异 */
export interface RequirementsDiff {
  from: string | null
  to: string | null
  added: string[]
  removed: string[]
  changed: string[]
  same: number
}

export interface SwitchPlan {
  target: string
  refKind: RefKind
  /** 当前所在的 tag / 短 commit */
  currentRef: string | null
  currentCommit: string | null
  /** 目标 commit；本地尚未取得该对象时为 null */
  targetCommit: string | null
  /** 目标是否已在本地（false 表示切换时需要先联网下载） */
  fetched: boolean
  willStash: boolean
  dirtyCount: number
  willBackup: boolean
  requirementsDiff: RequirementsDiff | null
  /** 两版本之间的提交数量 */
  commitCount: number | null
  /** 当前提交里不在目标中的提交数（分叉时 > 0：切过去这些改动不在此版本里） */
  aheadCount: number | null
  /** 阻止切换的硬性原因（例如 ComfyUI 正在运行） */
  blockers: string[]
  warnings: string[]
}

export interface SwitchResult {
  target: string
  refKind: RefKind
  fromRef: string | null
  fromCommit: string | null
  toCommit: string
  toTag: string | null
  backupId: string | null
  stashed: boolean
  fetched: boolean
  requirementsDiff: RequirementsDiff | null
  changeSummary: { filesChanged: number; insertions: number; deletions: number } | null
  /** 区间内的提交摘要（最多 200 条） */
  commits: string[]
}

/* ══════════════════════════════════════════════════════════
 * 插件管理（M3）
 * ══════════════════════════════════════════════════════════ */

export interface InstalledNode {
  dirName: string
  /** 去掉 .disabled 后缀后的逻辑名 */
  baseName: string
  path: string
  enabled: boolean
  isGit: boolean
  remote: string | null
  commit: string | null
  shortCommit: string | null
  commitDate: string | null
  subject: string | null
  branch: string | null
  detached: boolean
  dirty: boolean
  hasRequirements: boolean
  requirementsCount: number
  /** 从 pyproject.toml / registry id 推断 */
  displayName: string | null
  registryId: string | null
  version: string | null
  description: string | null
  /** 未满足的依赖包名 */
  missingDeps: string[]
  /** 有远端且落后于远端 */
  hasUpdate: boolean | null
  error: string | null
}

export interface RegistryNode {
  id: string
  name: string
  description: string | null
  author: string | null
  repository: string | null
  latestVersion: string | null
  downloads: number | null
  githubStars: number | null
  rating: number | null
  icon: string | null
  tags: string[]
  category: string | null
  publisher: string | null
  /** registry 声明的依赖（来自 latest_version.dependencies） */
  dependencies: string[]
  /** registry 声明的 ComfyUI 兼容版本范围 */
  supportedComfyuiVersion: string | null
  deprecated: boolean
}

export interface RegistrySearchResult {
  nodes: RegistryNode[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  error: string | null
}

export interface InstallResult {
  dirName: string
  path: string
  source: 'registry' | 'git'
  remote: string | null
  commit: string | null
  /** requirements.txt 是否存在且已尝试安装 */
  requirementsTried: boolean
  requirementsOk: boolean
  warnings: string[]
}

export interface NodeDepsEntry {
  dirName: string
  displayName: string | null
  enabled: boolean
  requirements: string[]
  missing: string[]
  satisfied: number
  error: string | null
}

/** 单个插件的依赖明细：requirements.txt 声明 vs 实际装到的版本 */
export interface NodeDepLine {
  name: string
  /** requirements.txt 里写的版本约束，没写就是空串 */
  spec: string
  /** 实际装到的版本；未安装为 null */
  installed: string | null
}

export interface NodeDepsDetail {
  dirName: string
  /** requirements.txt 是否存在（不存在时 entries 为空，不是错误） */
  hasRequirements: boolean
  entries: NodeDepLine[]
  error: string | null
}

/** 单个插件可切换的版本：本地分支/标签指向的提交，外加当前 HEAD */
export interface NodeReleaseEntry {
  sha: string
  short: string
  date: string | null
  subject: string
  current: boolean
}

export interface NodeReleases {
  dirName: string
  remote: string | null
  branch: string | null
  /** 本地分支（供「切换分支」下拉用） */
  branches: { name: string; current: boolean; isDefault: boolean }[]
  entries: NodeReleaseEntry[]
  error: string | null
}

export interface NodeDepsReport {
  checkedAt: number
  entries: NodeDepsEntry[]
  totalMissing: number
  pythonPackageCount: number
  error: string | null
}

/** 单个插件的远端更新检查结果（需要联网，按需触发） */
export interface NodeUpdateInfo {
  dirName: string
  hasUpdate: boolean
  localCommit: string | null
  remoteCommit: string | null
  error: string | null
}

/* ══════════════════════════════════════════════════════════
 * 模型管理（M4）
 * ══════════════════════════════════════════════════════════ */

/** 模型目录树的一个节点。目录的 children 里只有子文件夹和模型文件。 */
export interface ModelNode {
  name: string
  /** 相对 models 目录的路径，统一用 / 分隔。根的直接子项不会以 / 开头 */
  relative: string
  kind: 'dir' | 'file'
  /** 文件体积；目录则是其下全部模型文件的体积合计 */
  size: number
  mtime: number
  /** 目录为空字符串 */
  ext: string
  /** 目录：其下模型文件数；文件：1 */
  fileCount: number
  children: ModelNode[]
}

export interface ModelScanReport {
  modelsDir: string
  /** 只计模型文件，不含 yaml / json 等旁路文件 */
  totalSize: number
  totalFiles: number
  /** models 根目录的第一层，文件夹在前 */
  entries: ModelNode[]
  error: string | null
}

/* ══════════════════════════════════════════════════════════
 * 启动参数预设（M4）
 * ══════════════════════════════════════════════════════════ */

export interface LaunchPreset {
  id: string
  name: string
  description: string
  /** 内置预设不可删除 */
  builtin: boolean
  launch: LaunchDefaults
}

/* ══════════════════════════════════════════════════════════
 * 环境管理（嵌入式 Python 的 site-packages）
 * ══════════════════════════════════════════════════════════ */

/** `pip list --format=json` 的一行 */
export interface PipPackage {
  name: string
  version: string
}

/** `pip freeze` 写成的一份环境清单 */
export interface EnvBackupFile {
  /** 不含扩展名的备份名 */
  name: string
  path: string
  bytes: number
  /** 文件修改时间，毫秒 */
  mtime: number
}

/* ══════════════════════════════════════════════════════════
 * 长任务的统一返回
 *
 * 长操作同时在任务中心产生一条 Job（日志/进度/取消都走事件通道），
 * 调用方拿到 jobId 便于订阅；结果通过 value/error 一并返回，
 * 避免调用方再去任务列表里捞结果。
 * ══════════════════════════════════════════════════════════ */

export type OpResult<T> =
  | { ok: true; jobId: string; value: T }
  | { ok: false; jobId: string; error: string }

export interface GitAvailability {
  ok: boolean
  version: string | null
  error: string | null
}

/* ══════════════════════════════════════════════════════════
 * 渲染进程可见的 API（preload 通过 contextBridge 暴露）
 * ══════════════════════════════════════════════════════════ */

export type Unsubscribe = () => void

export interface SelfUpdateStatus {
  /** latest：已是最新。available：可点更新。error：检查或发布不可用 */
  state: 'latest' | 'available' | 'error'
  version: string | null
  message: string | null
  /** 开发模式为 false，点击只提示，不替换当前进程 */
  packaged: boolean
}

export interface SelfUpdateProgress {
  percent: number
}

export interface LauncherApi {
  /* ---- 设置 ---- */
  getSettings(): Promise<AppSettings>
  patchSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  pickDirectory(defaultPath?: string): Promise<string | null>

  /* ---- 环境 ---- */
  checkEnv(root?: string): Promise<EnvLayout>
  probeRuntime(root?: string): Promise<RuntimeInfo>
  /** 根目录所在卷的剩余/总容量 */
  probeDisk(): Promise<DiskProbe>

  /* ---- 服务进程 ---- */
  getServiceStatus(): Promise<ServiceStatus>
  startService(override?: Partial<LaunchDefaults>): Promise<ServiceStatus>
  stopService(): Promise<ServiceStatus>
  getServiceLogs(): Promise<LogLine[]>
  clearServiceLogs(): Promise<void>

  /* ---- 任务 ---- */
  listJobs(): Promise<JobSnapshot[]>
  getJob(id: string): Promise<JobSnapshot | null>
  cancelJob(id: string): Promise<boolean>

  /* ---- 版本管理（M2） ---- */
  gitCheck(): Promise<GitAvailability>
  getVersionState(root?: string): Promise<VersionState>
  listRemoteTags(root?: string): Promise<{ name: string; commit: string }[]>
  listCommits(root?: string): Promise<CommitInfo[]>
  /**
   * 联网拉一次远端。版本列表读的是本地 git 历史，
   * 不 fetch 就永远停在旧状态 —— 当初「刷新看不到新版本」就是这个原因。
   * 失败不抛异常，返回结果让调用方决定怎么提示。
   */
  fetchRemote(root?: string): Promise<{ ok: boolean; error: string | null }>
  checkUpdate(root?: string, force?: boolean): Promise<UpdateCheck>
  planSwitch(target: string, refKind: RefKind, root?: string): Promise<SwitchPlan>
  switchVersion(
    target: string,
    refKind: RefKind,
    opts: { backup?: boolean },
    root?: string
  ): Promise<OpResult<SwitchResult>>
  syncDependencies(root?: string): Promise<OpResult<null>>
  officialUpdate(stable: boolean, root?: string): Promise<OpResult<null>>

  /* ---- 备份（M2） ---- */
  listBackups(root?: string): Promise<BackupSnapshot[]>
  getBackupDetail(id: string, root?: string): Promise<BackupDetail | null>
  createBackup(label?: string, root?: string): Promise<OpResult<BackupSnapshot>>
  restoreBackup(id: string, root?: string): Promise<OpResult<RestoreResult>>
  deleteBackup(id: string, root?: string): Promise<void>
  getBackupsDir(root?: string): Promise<string>

  /* ---- 插件管理（M3） ---- */
  listInstalledNodes(root?: string): Promise<InstalledNode[]>
  /** limit 由渲染进程按网格列数 × 行数算出，保证每页正好铺满一屏 */
  searchRegistry(query: string, page?: number, limit?: number): Promise<RegistrySearchResult>
  installFromRegistry(
    nodeId: string,
    root?: string
  ): Promise<OpResult<InstallResult>>
  installFromGit(url: string, dirName?: string, root?: string): Promise<OpResult<InstallResult>>
  setNodeEnabled(dirName: string, enabled: boolean, root?: string): Promise<InstalledNode[]>
  updateNode(dirName: string, root?: string): Promise<OpResult<null>>
  updateAllNodes(root?: string): Promise<OpResult<string[]>>
  uninstallNode(dirName: string, root?: string): Promise<OpResult<null>>
  installNodeDeps(dirName: string, root?: string): Promise<OpResult<null>>
  checkNodeDeps(root?: string): Promise<NodeDepsReport>
  checkNodeUpdates(root?: string): Promise<NodeUpdateInfo[]>
  nodeDepsDetail(dirName: string, root?: string): Promise<NodeDepsDetail>
  nodeReleases(dirName: string, root?: string, fetch?: boolean): Promise<NodeReleases>
  nodeCheckout(dirName: string, ref: string, root?: string): Promise<OpResult<null>>
  nodeDepInstall(dirName: string, name: string, spec: string, root?: string): Promise<OpResult<null>>
  reinstallAllNodeDeps(root?: string): Promise<OpResult<string[]>>

  /* ---- 环境管理 ---- */
  listPipPackages(root?: string): Promise<PipPackage[]>
  installPip(spec: string, root?: string): Promise<OpResult<null>>
  uninstallPip(name: string, root?: string): Promise<OpResult<null>>
  reinstallPip(name: string, version: string, root?: string): Promise<OpResult<null>>
  /** 打开该包在 site-packages 中的目录，返回实际打开的路径 */
  locatePipPackage(name: string, root?: string): Promise<string>
  listEnvBackups(root?: string): Promise<EnvBackupFile[]>
  backupEnv(label: string, root?: string): Promise<OpResult<EnvBackupFile>>
  restoreEnv(filePath: string, root?: string): Promise<OpResult<null>>
  pickPipFile(defaultPath?: string): Promise<string | null>
  /**
   * 从拖放进来的文件取出本机路径。
   * 参数是渲染进程的 File；写成结构化类型，避免共享契约依赖 DOM lib。
   */
  pathForFile(file: { readonly name: string }): string

  /* ---- 模型管理（M4） ---- */
  scanModels(root?: string): Promise<ModelScanReport>
  deleteModelFile(relative: string, root?: string): Promise<void>
  revealModelFile(relative: string, root?: string): Promise<void>
  getModelsDir(root?: string): Promise<string>

  /* ---- 系统交互 ---- */
  windowMinimize(): Promise<void>
  windowMaximize(): Promise<boolean>
  windowClose(): Promise<void>
  isWindowMaximized(): Promise<boolean>

  openExternal(url: string): Promise<void>
  openPath(target: string): Promise<void>
  showItemInFolder(target: string): Promise<void>

  /* ---- 事件订阅 ---- */
  onLog(cb: (line: LogLine) => void): Unsubscribe
  onServiceStatus(cb: (status: ServiceStatus) => void): Unsubscribe
  onJobEvent(cb: (event: JobEvent) => void): Unsubscribe
  /** 托盘「设置」等：主进程要求切到某个页面 */
  onNavigate(cb: (page: string) => void): Unsubscribe

  /* ---- 启动器自身更新 ---- */
  selfUpdateStatus(): Promise<SelfUpdateStatus>
  selfUpdateInstall(): Promise<void>
  onSelfUpdate(cb: (progress: SelfUpdateProgress) => void): Unsubscribe
}
