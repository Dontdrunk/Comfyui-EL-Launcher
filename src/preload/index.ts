import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppSettings,
  BackupDetail,
  BackupSnapshot,
  CommitPage,
  DiskProbe,
  EnvBackupFile,
  EnvLayout,
  GitAvailability,
  InstallResult,
  InstalledNode,
  JobEvent,
  JobSnapshot,
  LaunchDefaults,
  LauncherApi,
  LogLine,
  ModelScanReport,
  NodeDepsDetail,
  NodeDepsReport,
  NodeReleases,
  NodeUpdateInfo,
  OpResult,
  PipPackage,
  RegistrySearchResult,
  RestoreResult,
  RuntimeInfo,
  ServiceStatus,
  SwitchPlan,
  SelfUpdateProgress,
  SelfUpdateStatus,
  SwitchResult,
  Unsubscribe,
  UpdateCheck,
  VersionState
} from '@shared/types'

/**
 * 渲染进程唯一的对外通道。
 * 这里不做任何业务逻辑，只做「通道搬运 + 类型对齐」。
 */

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: LauncherApi = {
  /* ---- 设置 ---- */
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<AppSettings>,
  patchSettings: (patch) =>
    ipcRenderer.invoke(IPC.settingsPatch, patch) as Promise<AppSettings>,
  pickDirectory: (defaultPath) =>
    ipcRenderer.invoke(IPC.dialogPickDirectory, defaultPath) as Promise<string | null>,

  /* ---- 环境 ---- */
  checkEnv: (root) => ipcRenderer.invoke(IPC.envCheck, root) as Promise<EnvLayout>,
  probeRuntime: (root) => ipcRenderer.invoke(IPC.envProbeRuntime, root) as Promise<RuntimeInfo>,
  probeDisk: () => ipcRenderer.invoke(IPC.envProbeDisk) as Promise<DiskProbe>,

  /* ---- 服务进程 ---- */
  getServiceStatus: () => ipcRenderer.invoke(IPC.serviceStatus) as Promise<ServiceStatus>,
  startService: (override?: Partial<LaunchDefaults>) =>
    ipcRenderer.invoke(IPC.serviceStart, override) as Promise<ServiceStatus>,
  stopService: () => ipcRenderer.invoke(IPC.serviceStop) as Promise<ServiceStatus>,
  getServiceLogs: () => ipcRenderer.invoke(IPC.serviceLogs) as Promise<LogLine[]>,
  clearServiceLogs: () => ipcRenderer.invoke(IPC.serviceLogsClear) as Promise<void>,

  /* ---- 任务 ---- */
  listJobs: () => ipcRenderer.invoke(IPC.jobList) as Promise<JobSnapshot[]>,
  getJob: (id: string) => ipcRenderer.invoke(IPC.jobGet, id) as Promise<JobSnapshot | null>,
  cancelJob: (id: string) => ipcRenderer.invoke(IPC.jobCancel, id) as Promise<boolean>,

  /* ---- 版本管理（M2） ---- */
  gitCheck: () => ipcRenderer.invoke(IPC.gitCheck) as Promise<GitAvailability>,
  getVersionState: (root) => ipcRenderer.invoke(IPC.versionState, root) as Promise<VersionState>,
  listRemoteTags: (root) =>
    ipcRenderer.invoke(IPC.versionRemoteTags, root) as Promise<{ name: string; commit: string }[]>,
  listCommits: (root, offset, limit) =>
    ipcRenderer.invoke(IPC.versionCommits, root, offset, limit) as Promise<CommitPage>,
  fetchRemote: (root) =>
    ipcRenderer.invoke(IPC.versionFetchRemote, root) as Promise<{ ok: boolean; error: string | null }>,
  checkUpdate: (root, force) =>
    ipcRenderer.invoke(IPC.versionCheckUpdate, root, force) as Promise<UpdateCheck>,
  planSwitch: (target, refKind, root) =>
    ipcRenderer.invoke(IPC.versionPlan, target, refKind, root) as Promise<SwitchPlan>,
  switchVersion: (target, refKind, opts, root) =>
    ipcRenderer.invoke(IPC.versionSwitch, target, refKind, opts, root) as Promise<
      OpResult<SwitchResult>
    >,
  syncDependencies: (root) =>
    ipcRenderer.invoke(IPC.versionSyncDeps, root) as Promise<OpResult<null>>,
  officialUpdate: (stable, root) =>
    ipcRenderer.invoke(IPC.versionOfficialUpdate, stable, root) as Promise<OpResult<null>>,

  /* ---- 备份（M2） ---- */
  listBackups: (root) => ipcRenderer.invoke(IPC.backupList, root) as Promise<BackupSnapshot[]>,
  getBackupDetail: (id, root) =>
    ipcRenderer.invoke(IPC.backupDetail, id, root) as Promise<BackupDetail | null>,
  createBackup: (label, root) =>
    ipcRenderer.invoke(IPC.backupCreate, label, root) as Promise<OpResult<BackupSnapshot>>,
  restoreBackup: (id, root) =>
    ipcRenderer.invoke(IPC.backupRestore, id, root) as Promise<OpResult<RestoreResult>>,
  deleteBackup: (id, root) => ipcRenderer.invoke(IPC.backupDelete, id, root) as Promise<void>,
  getBackupsDir: (root) => ipcRenderer.invoke(IPC.backupDir, root) as Promise<string>,

  /* ---- 插件管理（M3） ---- */
  listInstalledNodes: (root) =>
    ipcRenderer.invoke(IPC.nodesList, root) as Promise<InstalledNode[]>,
  searchRegistry: (query, page, limit) =>
    ipcRenderer.invoke(IPC.nodesSearch, query, page, limit) as Promise<RegistrySearchResult>,
  installFromRegistry: (nodeId, root) =>
    ipcRenderer.invoke(IPC.nodesInstallRegistry, nodeId, root) as Promise<OpResult<InstallResult>>,
  installFromGit: (url, dirName, root) =>
    ipcRenderer.invoke(IPC.nodesInstallGit, url, dirName, root) as Promise<
      OpResult<InstallResult>
    >,
  setNodeEnabled: (dirName, enabled, root) =>
    ipcRenderer.invoke(IPC.nodesSetEnabled, dirName, enabled, root) as Promise<InstalledNode[]>,
  updateNode: (dirName, root) =>
    ipcRenderer.invoke(IPC.nodesUpdate, dirName, root) as Promise<OpResult<null>>,
  updateAllNodes: (root) =>
    ipcRenderer.invoke(IPC.nodesUpdateAll, root) as Promise<OpResult<string[]>>,
  uninstallNode: (dirName, root) =>
    ipcRenderer.invoke(IPC.nodesUninstall, dirName, root) as Promise<OpResult<null>>,
  installNodeDeps: (dirName, root) =>
    ipcRenderer.invoke(IPC.nodesInstallDeps, dirName, root) as Promise<OpResult<null>>,
  checkNodeDeps: (root) => ipcRenderer.invoke(IPC.nodesCheckDeps, root) as Promise<NodeDepsReport>,
  checkNodeUpdates: (root) =>
    ipcRenderer.invoke(IPC.nodesCheckUpdates, root) as Promise<NodeUpdateInfo[]>,
  nodeDepsDetail: (dirName, root) =>
    ipcRenderer.invoke(IPC.nodesDepsDetail, dirName, root) as Promise<NodeDepsDetail>,
  nodeReleases: (dirName, root, fetch) =>
    ipcRenderer.invoke(IPC.nodesReleases, dirName, root, Boolean(fetch)) as Promise<NodeReleases>,
  nodeCheckout: (dirName, ref, root) =>
    ipcRenderer.invoke(IPC.nodesCheckout, dirName, ref, root) as Promise<OpResult<null>>,
  reinstallAllNodeDeps: (root) =>
    ipcRenderer.invoke(IPC.nodesReinstallAllDeps, root) as Promise<OpResult<string[]>>,
  nodeDepInstall: (dirName, name, spec, root) =>
    ipcRenderer.invoke(IPC.nodesDepInstall, dirName, name, spec, root) as Promise<OpResult<null>>,

  /* ---- 环境管理 ---- */
  listPipPackages: (root) => ipcRenderer.invoke(IPC.pipList, root) as Promise<PipPackage[]>,
  installPip: (spec, root) =>
    ipcRenderer.invoke(IPC.pipInstall, spec, root) as Promise<OpResult<null>>,
  uninstallPip: (name, root) =>
    ipcRenderer.invoke(IPC.pipUninstall, name, root) as Promise<OpResult<null>>,
  reinstallPip: (name, version, root) =>
    ipcRenderer.invoke(IPC.pipReinstall, name, version, root) as Promise<OpResult<null>>,
  locatePipPackage: (name, root) =>
    ipcRenderer.invoke(IPC.pipLocate, name, root) as Promise<string>,
  listEnvBackups: (root) =>
    ipcRenderer.invoke(IPC.pipBackups, root) as Promise<EnvBackupFile[]>,
  backupEnv: (label, root) =>
    ipcRenderer.invoke(IPC.pipBackup, label, root) as Promise<OpResult<EnvBackupFile>>,
  restoreEnv: (filePath, root) =>
    ipcRenderer.invoke(IPC.pipRestore, filePath, root) as Promise<OpResult<null>>,
  pickPipFile: (defaultPath) =>
    ipcRenderer.invoke(IPC.dialogPickPipFile, defaultPath) as Promise<string | null>,
  pathForFile: (file) => webUtils.getPathForFile(file as never),

  /* ---- 模型管理（M4） ---- */
  scanModels: (root) => ipcRenderer.invoke(IPC.modelsScan, root) as Promise<ModelScanReport>,
  deleteModelFile: (relative, root) =>
    ipcRenderer.invoke(IPC.modelsDelete, relative, root) as Promise<void>,
  revealModelFile: (relative, root) =>
    ipcRenderer.invoke(IPC.modelsReveal, relative, root) as Promise<void>,
  getModelsDir: (root) => ipcRenderer.invoke(IPC.modelsDir, root) as Promise<string>,

  /* ---- 窗口控制 ---- */
  windowMinimize: () => ipcRenderer.invoke(IPC.windowMinimize) as Promise<void>,
  windowMaximize: () => ipcRenderer.invoke(IPC.windowMaximize) as Promise<boolean>,
  windowClose: () => ipcRenderer.invoke(IPC.windowClose) as Promise<void>,
  isWindowMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized) as Promise<boolean>,

  /* ---- 系统交互 ---- */
  openExternal: (url: string) => ipcRenderer.invoke(IPC.shellOpenExternal, url) as Promise<void>,
  openPath: (target: string) => ipcRenderer.invoke(IPC.shellOpenPath, target) as Promise<void>,
  showItemInFolder: (target: string) =>
    ipcRenderer.invoke(IPC.shellShowItem, target) as Promise<void>,

  /* ---- 事件订阅 ---- */
  onLog: (cb) => subscribe<LogLine>(IPC.evtLog, cb),
  onServiceStatus: (cb) => subscribe<ServiceStatus>(IPC.evtServiceStatus, cb),
  onJobEvent: (cb) => subscribe<JobEvent>(IPC.evtJob, cb),
  onNavigate: (cb) => subscribe<string>(IPC.evtNavigate, cb),

  /* ---- 启动器自身更新 ---- */
  selfUpdateStatus: () => ipcRenderer.invoke(IPC.selfUpdateStatus) as Promise<SelfUpdateStatus>,
  selfUpdateInstall: () => ipcRenderer.invoke(IPC.selfUpdateInstall) as Promise<void>,
  onSelfUpdate: (cb) => subscribe<SelfUpdateProgress>(IPC.evtSelfUpdate, cb)
}

contextBridge.exposeInMainWorld('launcher', api)
