/**
 * 探索者启动器 —— 主进程 / 渲染进程共享领域模型
 *
 * 该文件是整个应用的类型契约：主进程实现、渲染进程消费，
 * 双方只通过这里声明的结构与 IPC 通道交互。
 */

/* ══════════════════════════════════════════════════════════
 * 设置
 * ══════════════════════════════════════════════════════════ */

export type ThemeMode = "dark" | "light";

export type LaunchMode = "gpu" | "cpu";

/** 启动默认值 */
export interface LaunchDefaults {
  mode: LaunchMode;
  /** 监听地址（--listen），仅在开启远程访问时生效；留空按 0.0.0.0 */
  listen: string;
  port: number;
  /** 允许局域网/远程访问；关闭时只监听 127.0.0.1 */
  remote: boolean;
  /** 启动就绪后自动打开浏览器（关掉会传 --disable-auto-launch） */
  autoOpenBrowser: boolean;
  extraArgs: string;
  /** --fast fp16_accumulation */
  fastFp16: boolean;
  /** --disable-api-nodes */
  disableApiNodes: boolean;
}

/** 模型管理页的快捷目录卡片 */
export interface ModelShortcut {
  /** 绝对路径 */
  path: string;
  /** 卡片标题；空串表示用路径最后一段 */
  name: string;
}

export interface AppSettings {
  /** ComfyUI 便携版根目录，例如 D:\Projects\Procedure\ComfyUI-X */
  comfyRoot: string;
  theme: ThemeMode;
  launch: LaunchDefaults;
  /** 启动参数预设（含内置） */
  presets: LaunchPreset[];
  /** 当前选中的预设 id，null 表示自定义 */
  activePresetId: string | null;
  /** 模型管理页的快捷目录卡片，按添加顺序显示 */
  modelShortcuts: ModelShortcut[];
}

/* ══════════════════════════════════════════════════════════
 * 环境探测
 * ══════════════════════════════════════════════════════════ */

export type IssueLevel = "error" | "warn" | "info";

export interface EnvIssue {
  level: IssueLevel;
  message: string;
  hint?: string;
}

/** 目录结构探测结果（纯文件系统检查，快速） */
export interface EnvLayout {
  root: string;
  /** 三件套齐全即视为可用便携版 */
  valid: boolean;
  portable: boolean;
  issues: EnvIssue[];
  pythonExe: string | null;
  comfyDir: string | null;
  mainPy: string | null;
  customNodesDir: string | null;
  modelsDir: string | null;
  /** ComfyUI/input：上传/工作流输入图片目录 */
  inputDir: string | null;
  outputDir: string | null;
  updateDir: string | null;
  updateScript: string | null;
  /** ComfyUI/.git 是否存在 */
  isGitRepo: boolean;
  /** comfyui_version.py 中读到的版本号 */
  appVersion: string | null;
  /** ComfyUI 根目录总占用（字节），懒计算 */
  diskUsage: number | null;
}

/** 运行时探测结果（需要拉起 python，较慢） */
export interface RuntimeInfo {
  probed: boolean;
  ok: boolean;
  pythonVersion: string | null;
  torchVersion: string | null;
  cudaVersion: string | null;
  cudaAvailable: boolean;
  gpuName: string | null;
  deviceCount: number;
  pipVersion: string | null;
  error: string | null;
  probedAt: number | null;
}

/* ══════════════════════════════════════════════════════════
 * 磁盘容量（模型页展示剩余空间）
 * ══════════════════════════════════════════════════════════ */

export interface DiskProbe {
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  /** 根目录所在盘符，例如 D: */
  drive: string | null;
}

/* ══════════════════════════════════════════════════════════
 * 日志 / 任务
 * ══════════════════════════════════════════════════════════ */

export type LogStream = "stdout" | "stderr" | "system";

/**
 * 日志级别：控制台按它上色，与输出通道无关。
 * Python 的 logging 默认把 INFO/WARNING/ERROR 全写到 stderr，
 * 所以「stderr = 错误」会让整屏普通日志变红。
 */
export type LogLevel = "debug" | "info" | "success" | "warn" | "error";

export interface LogLine {
  seq: number;
  ts: number;
  stream: LogStream;
  /** 严重级别；由写入方或内容判定，stream 只保留来源信息 */
  level: LogLevel;
  text: string;
}

export type JobStatus = "running" | "succeeded" | "failed" | "canceled";

export interface JobSnapshot {
  id: string;
  kind: string;
  title: string;
  status: JobStatus;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  error: string | null;
  lines: LogLine[];
  /** 0-100，null 表示不确定进度 */
  percent: number | null;
}

export type JobEventKind = "created" | "line" | "progress" | "finished";

export interface JobEvent {
  jobId: string;
  kind: JobEventKind;
  snapshot?: JobSnapshot;
  line?: LogLine;
  percent?: number | null;
}

/* ══════════════════════════════════════════════════════════
 * ComfyUI 服务进程
 * ══════════════════════════════════════════════════════════ */

export type ServiceState =
  | "stopped"
  | "launching"
  | "running"
  | "stopping"
  | "error";

/** 端口被占用时，占着它的那个进程 */
export interface PortOwner {
  pid: number;
  name: string;
  /** 拿不到命令行时为 null（这种情况下不自动接管） */
  commandLine: string | null;
  /** 命令行指向当前 comfyRoot 这套 ComfyUI */
  isOurComfy: boolean;
}

export interface ServiceStatus {
  state: ServiceState;
  pid: number | null;
  port: number;
  /** http://127.0.0.1:<port> */
  url: string | null;
  /** /system_stats 探测通过 */
  ready: boolean;
  startedAt: number | null;
  exitedAt: number | null;
  exitCode: number | null;
  /** 启动时使用的完整命令行，便于排障 */
  commandLine: string | null;
  lastError: string | null;
  /** 启动耗时（ms），就绪后填充 */
  bootMs: number | null;
  /** 进程不是本次启动的，而是接管了遗留/外部启动的 ComfyUI */
  external: boolean;
  /** 端口冲突时记录占用者，供 UI 展示与「结束并启动」 */
  portOwner: PortOwner | null;
  /** 端口上已经有一个能响应的 ComfyUI（/system_stats 探通） */
  portLive: boolean;
}

/* ══════════════════════════════════════════════════════════
 * 版本管理（M2）
 * ══════════════════════════════════════════════════════════ */

export type RefKind = "tag" | "branch" | "backup-branch" | "commit";

export interface VersionRef {
  name: string;
  kind: RefKind;
  commit: string;
  shortCommit: string;
  date: string | null;
  subject: string | null;
  isCurrent: boolean;
  /** 本地是否已有该 ref 的对象（false 表示需要先 fetch） */
  fetched: boolean;
}

export interface HeadInfo {
  commit: string;
  shortCommit: string;
  tag: string | null;
  branch: string | null;
  detached: boolean;
  date: string | null;
  subject: string | null;
  /** comfyui_version.py 读到的版本号 */
  appVersion: string | null;
}

/**
 * 本地提交历史的一行。
 * 版本列表直接用 git log，所以每行天然带说明与时间 —— 与疯狂启动器同一套逻辑。
 */
export interface CommitInfo {
  sha: string;
  shortSha: string;
  date: string | null;
  subject: string;
}

export interface CommitPage {
  commits: CommitInfo[];
  total: number;
}

export interface VersionState {
  isRepo: boolean;
  head: HeadInfo | null;
  /** 工作区是否干净 */
  clean: boolean;
  dirtyCount: number;
  stashedCount: number;
  remote: string | null;
  refs: VersionRef[];
  /**
   * 与最新发版的谱系关系。判「是否最新」只看它，不看 comfyui_version.py ——
   * 发行线以外的提交（PR 分支、浅取碎片）里那个文件停在旧值。
   */
  release: {
    /** 本地语义版本最大的 tag；一个都没有时为 null */
    newestTag: string | null;
    /** HEAD 独有 / 最新 tag 独有的提交数（浅克隆下会少算，但方向可靠） */
    ahead: number;
    behind: number;
    /** HEAD 属于哪个发版的历史（git describe --contains HEAD）；不在任何 tag 上时为 null */
    willShipIn: string | null;
  } | null;
  error: string | null;
}

export interface ReleaseInfo {
  tag: string;
  name: string;
  publishedAt: string;
  body: string;
  url: string;
  prerelease: boolean;
}

export interface UpdateCheck {
  current: string | null;
  latest: string | null;
  hasUpdate: boolean;
  release: ReleaseInfo | null;
  /** 最近若干条 release，用于更新日志列表 */
  releases: ReleaseInfo[];
  checkedAt: number;
  fromCache: boolean;
  error: string | null;
}

export interface BackupSnapshot {
  id: string;
  dir: string;
  createdAt: number;
  tag: string | null;
  commit: string;
  branch: string | null;
  appVersion: string | null;
  nodeCount: number;
  dirty: boolean;
  /** 该备份是否已被还原过 */
  restoredAt: number | null;
}

/** 备份里的单个插件条目（仅清单，不含插件文件内容） */
export interface BackupNodeEntry {
  dirName: string;
  baseName: string;
  enabled: boolean;
  isGit: boolean;
  remote: string | null;
  commit: string | null;
  dirty: boolean;
}

export interface BackupDetail {
  snapshot: BackupSnapshot;
  remote: string | null;
  /** 备份时是否为脏工作区 */
  dirty: boolean;
  hasUserConfig: boolean;
  hasExtraModelPaths: boolean;
  nodes: BackupNodeEntry[];
  /** 备份目录内的文件清单 */
  files: { relative: string; size: number }[];
  error: string | null;
}

export interface RestoreResult {
  snapshotId: string;
  fromCommit: string | null;
  toCommit: string;
  userConfigRestored: boolean;
  /** 备份清单里有、但当前 custom_nodes 中已不存在（不会被自动补装） */
  missingNodes: string[];
  /** 当前存在、但备份清单里没有 */
  extraNodes: string[];
}

/** 版本切换后的依赖差异 */
export interface RequirementsDiff {
  from: string | null;
  to: string | null;
  added: string[];
  removed: string[];
  changed: string[];
  same: number;
}

export interface SwitchPlan {
  target: string;
  refKind: RefKind;
  /** 当前所在的 tag / 短 commit */
  currentRef: string | null;
  currentCommit: string | null;
  /** 目标 commit；本地尚未取得该对象时为 null */
  targetCommit: string | null;
  /** 目标是否已在本地（false 表示切换时需要先联网下载） */
  fetched: boolean;
  willStash: boolean;
  dirtyCount: number;
  willBackup: boolean;
  requirementsDiff: RequirementsDiff | null;
  /** 两版本之间的提交数量 */
  commitCount: number | null;
  /** 当前提交里不在目标中的提交数（分叉时 > 0：切过去这些改动不在此版本里） */
  aheadCount: number | null;
  /** 阻止切换的硬性原因（例如 ComfyUI 正在运行） */
  blockers: string[];
  warnings: string[];
}

export interface SwitchResult {
  target: string;
  refKind: RefKind;
  fromRef: string | null;
  fromCommit: string | null;
  toCommit: string;
  toTag: string | null;
  backupId: string | null;
  stashed: boolean;
  fetched: boolean;
  requirementsDiff: RequirementsDiff | null;
  changeSummary: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  } | null;
  /** 区间内的提交摘要（最多 200 条） */
  commits: string[];
}

/* ══════════════════════════════════════════════════════════
 * 插件管理（M3）
 * ══════════════════════════════════════════════════════════ */

export interface InstalledNode {
  dirName: string;
  /** 去掉 .disabled 后缀后的逻辑名 */
  baseName: string;
  path: string;
  enabled: boolean;
  isGit: boolean;
  remote: string | null;
  commit: string | null;
  shortCommit: string | null;
  commitDate: string | null;
  subject: string | null;
  branch: string | null;
  detached: boolean;
  hasRequirements: boolean;
  requirementsCount: number;
  /** 从 pyproject.toml / registry id 推断 */
  displayName: string | null;
  registryId: string | null;
  version: string | null;
  description: string | null;
  /** 未满足的依赖包名 */
  missingDeps: string[];
  /** 有远端且落后于远端 */
  hasUpdate: boolean | null;
  error: string | null;
}

/**
 * 启用 / 禁用的结果。
 * 目录改名之外的状态（git、依赖、清单）都不会变，所以只回这一条，
 * 让界面就地更新——重扫整张表要给每个插件 spawn 一堆 git，点一次卡几秒。
 */
export interface NodeToggleResult {
  /** 改名后的物理目录名（禁用时带 .disabled 后缀） */
  dirName: string;
  /** 逻辑名：切换前后不变，也是列表行的稳定标识 */
  baseName: string;
  path: string;
  enabled: boolean;
}

export interface RegistryNode {
  id: string;
  name: string;
  description: string | null;
  author: string | null;
  repository: string | null;
  latestVersion: string | null;
  downloads: number | null;
  githubStars: number | null;
  rating: number | null;
  icon: string | null;
  tags: string[];
  category: string | null;
  publisher: string | null;
  /** registry 声明的依赖（来自 latest_version.dependencies） */
  dependencies: string[];
  /** registry 声明的 ComfyUI 兼容版本范围 */
  supportedComfyuiVersion: string | null;
  deprecated: boolean;
}

export interface RegistrySearchResult {
  /** 当前页数据（关键字搜索时已按名称过滤） */
  nodes: RegistryNode[];
  /** 名称命中的总条数（关键字搜索）；热门列表则是 Registry 的总数 */
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  error: string | null;
  /** 关键字搜索：Registry 全文命中的总条数（含描述/标签命中） */
  sourceTotal?: number;
  /** 关键字搜索：实际扫描过的条数；小于 sourceTotal 说明只看了前几页 */
  scanned?: number;
}

export interface InstallResult {
  dirName: string;
  path: string;
  source: "registry" | "git";
  remote: string | null;
  commit: string | null;
  /** requirements.txt 是否存在且已尝试安装 */
  requirementsTried: boolean;
  requirementsOk: boolean;
  warnings: string[];
}

export interface NodeDepsEntry {
  dirName: string;
  displayName: string | null;
  enabled: boolean;
  requirements: string[];
  missing: string[];
  satisfied: number;
  error: string | null;
}

/** 单个插件的依赖明细：requirements.txt 声明 vs 实际装到的版本 */
export interface NodeDepLine {
  /** 包名；直接引用没有包名，用仓库名（`facebookresearch/sam2`） */
  name: string;
  /** 展示用约束：版本约束，直接引用显示「源码」 */
  spec: string;
  /** 实际装到的版本；未安装为 null */
  installed: string | null;
  /** true = requirements 里直接引用仓库（pip 会去 clone），不按包名查索引 */
  source: boolean;
  /** 交给 `pip install` 的完整规格，渲染进程原样回传 */
  install: string;
}

export interface NodeDepsDetail {
  dirName: string;
  /** requirements.txt 是否存在（不存在时 entries 为空，不是错误） */
  hasRequirements: boolean;
  entries: NodeDepLine[];
  error: string | null;
}

/** 单个插件可切换的版本：本地分支/标签指向的提交，外加当前 HEAD */
export interface NodeReleaseEntry {
  sha: string;
  short: string;
  date: string | null;
  subject: string;
  current: boolean;
}

export interface NodeReleases {
  dirName: string;
  remote: string | null;
  branch: string | null;
  /** 本地分支（供「切换分支」下拉用） */
  branches: { name: string; current: boolean; isDefault: boolean }[];
  entries: NodeReleaseEntry[];
  error: string | null;
}

export interface NodeDepsReport {
  checkedAt: number;
  entries: NodeDepsEntry[];
  totalMissing: number;
  pythonPackageCount: number;
  error: string | null;
}

/** 批量更新里失败的插件与原因 */
export interface NodeUpdateFailure {
  dirName: string;
  error: string;
}

/**
 * 批量更新的结果。成功与失败分开统计：只有成功列表长度时，
 * 「全部失败」和「没有需要更新的」在界面上分不开。
 */
export interface NodeBulkUpdateResult {
  updated: string[];
  failed: NodeUpdateFailure[];
}

/** 单个插件的远端更新检查结果（需要联网，按需触发） */
export interface NodeUpdateInfo {
  /** 检查时的物理目录名（禁用中的目录带 .disabled 后缀） */
  dirName: string;
  /** 逻辑名：开关只改目录名，版本状态必须挂在稳定的这个名字上 */
  baseName: string;
  hasUpdate: boolean;
  localCommit: string | null;
  remoteCommit: string | null;
  error: string | null;
}

/* ══════════════════════════════════════════════════════════
 * 模型管理（M4）
 * ══════════════════════════════════════════════════════════ */

/** 模型目录树的一个节点。目录的 children 里只有子文件夹和模型文件。 */
export interface ModelNode {
  name: string;
  /** 相对 models 目录的路径，统一用 / 分隔。根的直接子项不会以 / 开头 */
  relative: string;
  kind: "dir" | "file";
  /** 文件体积；目录则是其下全部模型文件的体积合计 */
  size: number;
  mtime: number;
  /** 目录为空字符串 */
  ext: string;
  /** 目录：其下模型文件数；文件：1 */
  fileCount: number;
  children: ModelNode[];
}

export interface ModelScanReport {
  modelsDir: string;
  /** 只计模型文件，不含 yaml / json 等旁路文件 */
  totalSize: number;
  totalFiles: number;
  /** models 根目录的第一层，文件夹在前 */
  entries: ModelNode[];
  error: string | null;
}

/* ══════════════════════════════════════════════════════════
 * 启动参数预设（M4）
 * ══════════════════════════════════════════════════════════ */

export interface LaunchPreset {
  id: string;
  name: string;
  description: string;
  /** 内置预设不可删除 */
  builtin: boolean;
  launch: LaunchDefaults;
}

/* ══════════════════════════════════════════════════════════
 * 环境管理（嵌入式 Python 的 site-packages）
 * ══════════════════════════════════════════════════════════ */

/** `pip list --format=json` 的一行 */
export interface PipPackage {
  name: string;
  version: string;
}

/** `pip freeze` 写成的一份环境清单 */
export interface EnvBackupFile {
  /** 不含扩展名的备份名 */
  name: string;
  path: string;
  bytes: number;
  /** 文件修改时间，毫秒 */
  mtime: number;
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
  | { ok: false; jobId: string; error: string };

export interface GitAvailability {
  ok: boolean;
  version: string | null;
  error: string | null;
}

/* ══════════════════════════════════════════════════════════
 * 渲染进程可见的 API（preload 通过 contextBridge 暴露）
 * ══════════════════════════════════════════════════════════ */

export type Unsubscribe = () => void;

/**
 * 自更新阶段：
 *  - idle        未开始 / 用户取消（主进程已中止下载）
 *  - checking    正在检查 Release
 *  - downloading 正在下载安装包
 *  - verifying   下载完，正在校验 sha512
 *  - installing  校验通过，正在启动安装程序或替换便携版（随后进程退出）
 *  - error       失败，原因在 message 里
 */
export type SelfUpdateStage =
  | "idle"
  | "checking"
  | "downloading"
  | "verifying"
  | "installing"
  | "error";

export interface SelfUpdateStatus {
  /** latest：已是最新。available：可点更新。error：检查或发布不可用 */
  state: "latest" | "available" | "error";
  /** 当前安装的版本，弹窗里显示在箭头左侧 */
  currentVersion: string;
  version: string | null;
  message: string | null;
  /** 开发模式为 false：不替换当前进程，弹窗里给出说明 */
  packaged: boolean;
  /** 便携版换的是 portable.exe，安装版跑的是 setup.exe */
  portable: boolean;
  /** GitHub Release 的更新说明（Markdown 原文） */
  notes: string | null;
  publishedAt: string | null;
  releaseUrl: string | null;
  /** 将要下载的安装包大小（字节）；发布里没有对应包时为 null */
  size: number | null;
}

export interface SelfUpdateProgress {
  stage: SelfUpdateStage;
  /** 下载百分比；非下载阶段为 null */
  percent: number | null;
  receivedBytes: number;
  totalBytes: number | null;
  /** 下载速度（字节/秒）；采样不足时为 null */
  bytesPerSecond: number | null;
  /** 阶段说明或错误原因 */
  message: string | null;
}

export interface LauncherApi {
  /* ---- 设置 ---- */
  getSettings(): Promise<AppSettings>;
  patchSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  /** 选目录对话框；title 为空时用通用标题 */
  pickDirectory(defaultPath?: string, title?: string): Promise<string | null>;

  /* ---- 环境 ---- */
  checkEnv(root?: string): Promise<EnvLayout>;
  probeRuntime(root?: string): Promise<RuntimeInfo>;
  /** 根目录所在卷的剩余/总容量 */
  probeDisk(): Promise<DiskProbe>;

  /* ---- 服务进程 ---- */
  getServiceStatus(): Promise<ServiceStatus>;
  startService(override?: Partial<LaunchDefaults>): Promise<ServiceStatus>;
  stopService(): Promise<ServiceStatus>;
  /** 结束占着服务端口的进程（端口冲突时由用户确认后调用） */
  killPortOwner(): Promise<ServiceStatus>;
  /** ComfyUI 进程输出（控制台「运行日志」） */
  getServiceLogs(): Promise<LogLine[]>;
  clearServiceLogs(): Promise<void>;
  /** 主进程/任务操作（控制台「启动器日志」） */
  getLauncherLogs(): Promise<LogLine[]>;
  clearLauncherLogs(): Promise<void>;

  /* ---- 任务 ---- */
  listJobs(): Promise<JobSnapshot[]>;
  getJob(id: string): Promise<JobSnapshot | null>;
  cancelJob(id: string): Promise<boolean>;

  /* ---- 版本管理（M2） ---- */
  gitCheck(): Promise<GitAvailability>;
  getVersionState(root?: string): Promise<VersionState>;
  listRemoteTags(root?: string): Promise<{ name: string; commit: string }[]>;
  listCommits(
    root?: string,
    offset?: number,
    limit?: number
  ): Promise<CommitPage>;
  /**
   * 联网拉一次远端。版本列表读的是本地 git 历史，
   * 不 fetch 就永远停在旧状态 —— 当初「刷新看不到新版本」就是这个原因。
   * 失败不抛异常，返回结果让调用方决定怎么提示。
   */
  fetchRemote(root?: string): Promise<{ ok: boolean; error: string | null }>;
  checkUpdate(root?: string, force?: boolean): Promise<UpdateCheck>;
  planSwitch(
    target: string,
    refKind: RefKind,
    root?: string
  ): Promise<SwitchPlan>;
  switchVersion(
    target: string,
    refKind: RefKind,
    opts: { backup?: boolean },
    root?: string
  ): Promise<OpResult<SwitchResult>>;
  syncDependencies(root?: string): Promise<OpResult<null>>;
  officialUpdate(stable: boolean, root?: string): Promise<OpResult<null>>;

  /* ---- 备份（M2） ---- */
  listBackups(root?: string): Promise<BackupSnapshot[]>;
  getBackupDetail(id: string, root?: string): Promise<BackupDetail | null>;
  createBackup(
    label?: string,
    root?: string
  ): Promise<OpResult<BackupSnapshot>>;
  restoreBackup(id: string, root?: string): Promise<OpResult<RestoreResult>>;
  deleteBackup(id: string, root?: string): Promise<void>;
  getBackupsDir(root?: string): Promise<string>;

  /* ---- 插件管理（M3） ---- */
  listInstalledNodes(root?: string): Promise<InstalledNode[]>;
  /** limit 由渲染进程按网格列数 × 行数算出，保证每页正好铺满一屏 */
  searchRegistry(
    query: string,
    page?: number,
    limit?: number
  ): Promise<RegistrySearchResult>;
  installFromRegistry(
    nodeId: string,
    root?: string
  ): Promise<OpResult<InstallResult>>;
  installFromGit(
    url: string,
    dirName?: string,
    root?: string
  ): Promise<OpResult<InstallResult>>;
  setNodeEnabled(
    dirName: string,
    enabled: boolean,
    root?: string
  ): Promise<NodeToggleResult>;
  updateNode(dirName: string, root?: string): Promise<OpResult<null>>;
  updateAllNodes(root?: string): Promise<OpResult<NodeBulkUpdateResult>>;
  uninstallNode(dirName: string, root?: string): Promise<OpResult<null>>;
  installNodeDeps(dirName: string, root?: string): Promise<OpResult<null>>;
  checkNodeDeps(root?: string): Promise<NodeDepsReport>;
  checkNodeUpdates(root?: string): Promise<NodeUpdateInfo[]>;
  nodeDepsDetail(dirName: string, root?: string): Promise<NodeDepsDetail>;
  nodeReleases(
    dirName: string,
    root?: string,
    fetch?: boolean
  ): Promise<NodeReleases>;
  nodeCheckout(
    dirName: string,
    ref: string,
    root?: string
  ): Promise<OpResult<null>>;
  nodeDepInstall(
    dirName: string,
    target: string,
    root?: string
  ): Promise<OpResult<null>>;
  reinstallAllNodeDeps(root?: string): Promise<OpResult<string[]>>;

  /* ---- 环境管理 ---- */
  listPipPackages(root?: string): Promise<PipPackage[]>;
  installPip(spec: string, root?: string): Promise<OpResult<null>>;
  uninstallPip(name: string, root?: string): Promise<OpResult<null>>;
  reinstallPip(
    name: string,
    version: string,
    root?: string
  ): Promise<OpResult<null>>;
  /** 打开该包在 site-packages 中的目录，返回实际打开的路径 */
  locatePipPackage(name: string, root?: string): Promise<string>;
  listEnvBackups(root?: string): Promise<EnvBackupFile[]>;
  backupEnv(label: string, root?: string): Promise<OpResult<EnvBackupFile>>;
  restoreEnv(filePath: string, root?: string): Promise<OpResult<null>>;
  pickPipFile(defaultPath?: string): Promise<string | null>;
  /**
   * 从拖放进来的文件取出本机路径。
   * 参数是渲染进程的 File；写成结构化类型，避免共享契约依赖 DOM lib。
   */
  pathForFile(file: { readonly name: string }): string;

  /* ---- 模型管理（M4） ---- */
  scanModels(root?: string): Promise<ModelScanReport>;
  deleteModelFile(relative: string, root?: string): Promise<void>;
  revealModelFile(relative: string, root?: string): Promise<void>;
  getModelsDir(root?: string): Promise<string>;

  /* ---- 系统交互 ---- */
  windowMinimize(): Promise<void>;
  windowMaximize(): Promise<boolean>;
  /** 关闭窗口：只收进托盘，进程与 ComfyUI 继续运行（退出走托盘菜单） */
  windowClose(): Promise<void>;
  isWindowMaximized(): Promise<boolean>;

  openExternal(url: string): Promise<void>;
  openPath(target: string): Promise<void>;
  showItemInFolder(target: string): Promise<void>;

  /* ---- 事件订阅 ---- */
  onLog(cb: (line: LogLine) => void): Unsubscribe;
  onLauncherLog(cb: (line: LogLine) => void): Unsubscribe;
  onServiceStatus(cb: (status: ServiceStatus) => void): Unsubscribe;
  onJobEvent(cb: (event: JobEvent) => void): Unsubscribe;
  /** 托盘「设置」等：主进程要求切到某个页面 */
  onNavigate(cb: (page: string) => void): Unsubscribe;

  /* ---- 启动器自身更新 ---- */
  selfUpdateStatus(): Promise<SelfUpdateStatus>;
  selfUpdateInstall(): Promise<void>;
  /** 中止下载并清掉临时文件；安装阶段不可取消 */
  selfUpdateCancel(): Promise<void>;
  /** 进度窗口挂载完成（只用于更新进度窗口内部） */
  selfUpdateUiReady(): void;
  /** 关闭进度窗口并恢复主窗口（失败后的出口） */
  selfUpdateDismiss(): Promise<void>;
  onSelfUpdate(cb: (progress: SelfUpdateProgress) => void): Unsubscribe;
}
