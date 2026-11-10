import { contextBridge, ipcRenderer, webUtils } from "electron";

import { IPC } from "@explorer-launcher/electron";
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
  NodeBulkUpdateResult,
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
  VersionState,
} from "@explorer-launcher/electron";

/**
 * 渲染进程唯一的对外通道。
 * 这里不做任何业务逻辑，只做「通道搬运 + 类型对齐」。
 */

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => {
    cb(payload);
  };

  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: LauncherApi = {
  /* ---- 设置 ---- */
  getSettings: async () =>
    ipcRenderer.invoke(IPC.settingsGet) as Promise<AppSettings>,
  patchSettings: async (patch) =>
    ipcRenderer.invoke(IPC.settingsPatch, patch) as Promise<AppSettings>,
  pickDirectory: async (defaultPath, title) =>
    ipcRenderer.invoke(IPC.dialogPickDirectory, defaultPath, title) as Promise<
      string | null
    >,

  /* ---- 环境 ---- */
  checkEnv: async (root) =>
    ipcRenderer.invoke(IPC.envCheck, root) as Promise<EnvLayout>,
  probeRuntime: async (root) =>
    ipcRenderer.invoke(IPC.envProbeRuntime, root) as Promise<RuntimeInfo>,
  probeDisk: async () =>
    ipcRenderer.invoke(IPC.envProbeDisk) as Promise<DiskProbe>,

  /* ---- 服务进程 ---- */
  getServiceStatus: async () =>
    ipcRenderer.invoke(IPC.serviceStatus) as Promise<ServiceStatus>,
  startService: async (override?: Partial<LaunchDefaults>) =>
    ipcRenderer.invoke(IPC.serviceStart, override) as Promise<ServiceStatus>,
  stopService: async () =>
    ipcRenderer.invoke(IPC.serviceStop) as Promise<ServiceStatus>,
  killPortOwner: async () =>
    ipcRenderer.invoke(IPC.serviceKillPortOwner) as Promise<ServiceStatus>,
  getServiceLogs: async () =>
    ipcRenderer.invoke(IPC.serviceLogs) as Promise<LogLine[]>,
  clearServiceLogs: async () =>
    ipcRenderer.invoke(IPC.serviceLogsClear) as Promise<void>,
  getLauncherLogs: async () =>
    ipcRenderer.invoke(IPC.launcherLogs) as Promise<LogLine[]>,
  clearLauncherLogs: async () =>
    ipcRenderer.invoke(IPC.launcherLogsClear) as Promise<void>,

  /* ---- 任务 ---- */
  listJobs: async () =>
    ipcRenderer.invoke(IPC.jobList) as Promise<JobSnapshot[]>,
  getJob: async (id: string) =>
    ipcRenderer.invoke(IPC.jobGet, id) as Promise<JobSnapshot | null>,
  cancelJob: async (id: string) =>
    ipcRenderer.invoke(IPC.jobCancel, id) as Promise<boolean>,

  /* ---- 版本管理（M2） ---- */
  gitCheck: async () =>
    ipcRenderer.invoke(IPC.gitCheck) as Promise<GitAvailability>,
  getVersionState: async (root) =>
    ipcRenderer.invoke(IPC.versionState, root) as Promise<VersionState>,
  listRemoteTags: async (root) =>
    ipcRenderer.invoke(IPC.versionRemoteTags, root) as Promise<
      { name: string; commit: string }[]
    >,
  listCommits: async (root, offset, limit) =>
    ipcRenderer.invoke(
      IPC.versionCommits,
      root,
      offset,
      limit
    ) as Promise<CommitPage>,
  fetchRemote: async (root) =>
    ipcRenderer.invoke(IPC.versionFetchRemote, root) as Promise<{
      ok: boolean;
      error: string | null;
    }>,
  checkUpdate: async (root, force) =>
    ipcRenderer.invoke(
      IPC.versionCheckUpdate,
      root,
      force
    ) as Promise<UpdateCheck>,
  planSwitch: async (target, refKind, root) =>
    ipcRenderer.invoke(
      IPC.versionPlan,
      target,
      refKind,
      root
    ) as Promise<SwitchPlan>,
  switchVersion: async (target, refKind, opts, root) =>
    ipcRenderer.invoke(
      IPC.versionSwitch,
      target,
      refKind,
      opts,
      root
    ) as Promise<OpResult<SwitchResult>>,
  syncDependencies: async (root) =>
    ipcRenderer.invoke(IPC.versionSyncDeps, root) as Promise<OpResult<null>>,
  officialUpdate: async (stable, root) =>
    ipcRenderer.invoke(IPC.versionOfficialUpdate, stable, root) as Promise<
      OpResult<null>
    >,

  /* ---- 备份（M2） ---- */
  listBackups: async (root) =>
    ipcRenderer.invoke(IPC.backupList, root) as Promise<BackupSnapshot[]>,
  getBackupDetail: async (id, root) =>
    ipcRenderer.invoke(
      IPC.backupDetail,
      id,
      root
    ) as Promise<BackupDetail | null>,
  createBackup: async (label, root) =>
    ipcRenderer.invoke(IPC.backupCreate, label, root) as Promise<
      OpResult<BackupSnapshot>
    >,
  restoreBackup: async (id, root) =>
    ipcRenderer.invoke(IPC.backupRestore, id, root) as Promise<
      OpResult<RestoreResult>
    >,
  deleteBackup: async (id, root) =>
    ipcRenderer.invoke(IPC.backupDelete, id, root) as Promise<void>,
  getBackupsDir: async (root) =>
    ipcRenderer.invoke(IPC.backupDir, root) as Promise<string>,

  /* ---- 插件管理（M3） ---- */
  listInstalledNodes: async (root) =>
    ipcRenderer.invoke(IPC.nodesList, root) as Promise<InstalledNode[]>,
  searchRegistry: async (query, page, limit) =>
    ipcRenderer.invoke(
      IPC.nodesSearch,
      query,
      page,
      limit
    ) as Promise<RegistrySearchResult>,
  installFromRegistry: async (nodeId, root) =>
    ipcRenderer.invoke(IPC.nodesInstallRegistry, nodeId, root) as Promise<
      OpResult<InstallResult>
    >,
  installFromGit: async (url, dirName, root) =>
    ipcRenderer.invoke(IPC.nodesInstallGit, url, dirName, root) as Promise<
      OpResult<InstallResult>
    >,
  setNodeEnabled: async (dirName, enabled, root) =>
    ipcRenderer.invoke(IPC.nodesSetEnabled, dirName, enabled, root) as Promise<
      InstalledNode[]
    >,
  updateNode: async (dirName, root) =>
    ipcRenderer.invoke(IPC.nodesUpdate, dirName, root) as Promise<
      OpResult<null>
    >,
  updateAllNodes: async (root) =>
    ipcRenderer.invoke(IPC.nodesUpdateAll, root) as Promise<
      OpResult<NodeBulkUpdateResult>
    >,
  uninstallNode: async (dirName, root) =>
    ipcRenderer.invoke(IPC.nodesUninstall, dirName, root) as Promise<
      OpResult<null>
    >,
  installNodeDeps: async (dirName, root) =>
    ipcRenderer.invoke(IPC.nodesInstallDeps, dirName, root) as Promise<
      OpResult<null>
    >,
  checkNodeDeps: async (root) =>
    ipcRenderer.invoke(IPC.nodesCheckDeps, root) as Promise<NodeDepsReport>,
  checkNodeUpdates: async (root) =>
    ipcRenderer.invoke(IPC.nodesCheckUpdates, root) as Promise<
      NodeUpdateInfo[]
    >,
  nodeDepsDetail: async (dirName, root) =>
    ipcRenderer.invoke(
      IPC.nodesDepsDetail,
      dirName,
      root
    ) as Promise<NodeDepsDetail>,
  nodeReleases: async (dirName, root, fetch) =>
    ipcRenderer.invoke(
      IPC.nodesReleases,
      dirName,
      root,
      Boolean(fetch)
    ) as Promise<NodeReleases>,
  nodeCheckout: async (dirName, ref, root) =>
    ipcRenderer.invoke(IPC.nodesCheckout, dirName, ref, root) as Promise<
      OpResult<null>
    >,
  reinstallAllNodeDeps: async (root) =>
    ipcRenderer.invoke(IPC.nodesReinstallAllDeps, root) as Promise<
      OpResult<string[]>
    >,
  nodeDepInstall: async (dirName, name, spec, root) =>
    ipcRenderer.invoke(
      IPC.nodesDepInstall,
      dirName,
      name,
      spec,
      root
    ) as Promise<OpResult<null>>,

  /* ---- 环境管理 ---- */
  listPipPackages: async (root) =>
    ipcRenderer.invoke(IPC.pipList, root) as Promise<PipPackage[]>,
  installPip: async (spec, root) =>
    ipcRenderer.invoke(IPC.pipInstall, spec, root) as Promise<OpResult<null>>,
  uninstallPip: async (name, root) =>
    ipcRenderer.invoke(IPC.pipUninstall, name, root) as Promise<OpResult<null>>,
  reinstallPip: async (name, version, root) =>
    ipcRenderer.invoke(IPC.pipReinstall, name, version, root) as Promise<
      OpResult<null>
    >,
  locatePipPackage: async (name, root) =>
    ipcRenderer.invoke(IPC.pipLocate, name, root) as Promise<string>,
  listEnvBackups: async (root) =>
    ipcRenderer.invoke(IPC.pipBackups, root) as Promise<EnvBackupFile[]>,
  backupEnv: async (label, root) =>
    ipcRenderer.invoke(IPC.pipBackup, label, root) as Promise<
      OpResult<EnvBackupFile>
    >,
  restoreEnv: async (filePath, root) =>
    ipcRenderer.invoke(IPC.pipRestore, filePath, root) as Promise<
      OpResult<null>
    >,
  pickPipFile: async (defaultPath) =>
    ipcRenderer.invoke(IPC.dialogPickPipFile, defaultPath) as Promise<
      string | null
    >,
  pathForFile: (file) => webUtils.getPathForFile(file as never),

  /* ---- 模型管理（M4） ---- */
  scanModels: async (root) =>
    ipcRenderer.invoke(IPC.modelsScan, root) as Promise<ModelScanReport>,
  deleteModelFile: async (relative, root) =>
    ipcRenderer.invoke(IPC.modelsDelete, relative, root) as Promise<void>,
  revealModelFile: async (relative, root) =>
    ipcRenderer.invoke(IPC.modelsReveal, relative, root) as Promise<void>,
  getModelsDir: async (root) =>
    ipcRenderer.invoke(IPC.modelsDir, root) as Promise<string>,

  /* ---- 窗口控制 ---- */
  windowMinimize: async () =>
    ipcRenderer.invoke(IPC.windowMinimize) as Promise<void>,
  windowMaximize: async () =>
    ipcRenderer.invoke(IPC.windowMaximize) as Promise<boolean>,
  windowClose: async () => ipcRenderer.invoke(IPC.windowClose) as Promise<void>,
  isWindowMaximized: async () =>
    ipcRenderer.invoke(IPC.windowIsMaximized) as Promise<boolean>,

  /* ---- 系统交互 ---- */
  openExternal: async (url: string) =>
    ipcRenderer.invoke(IPC.shellOpenExternal, url) as Promise<void>,
  openPath: async (target: string) =>
    ipcRenderer.invoke(IPC.shellOpenPath, target) as Promise<void>,
  showItemInFolder: async (target: string) =>
    ipcRenderer.invoke(IPC.shellShowItem, target) as Promise<void>,

  /* ---- 事件订阅 ---- */
  onLog: (cb) => subscribe<LogLine>(IPC.evtLog, cb),
  onLauncherLog: (cb) => subscribe<LogLine>(IPC.evtLauncherLog, cb),
  onServiceStatus: (cb) => subscribe<ServiceStatus>(IPC.evtServiceStatus, cb),
  onJobEvent: (cb) => subscribe<JobEvent>(IPC.evtJob, cb),
  onNavigate: (cb) => subscribe<string>(IPC.evtNavigate, cb),

  /* ---- 启动器自身更新 ---- */
  selfUpdateStatus: async () =>
    ipcRenderer.invoke(IPC.selfUpdateStatus) as Promise<SelfUpdateStatus>,
  selfUpdateInstall: async () =>
    ipcRenderer.invoke(IPC.selfUpdateInstall) as Promise<void>,
  onSelfUpdate: (cb) => subscribe<SelfUpdateProgress>(IPC.evtSelfUpdate, cb),
};

contextBridge.exposeInMainWorld("launcher", api);
