/**
 * IPC 通道常量集中定义，避免主进程与 preload 之间出现字符串漂移。
 */

export const IPC = {
  /* ---- 设置 ---- */
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  dialogPickDirectory: 'dialog:pickDirectory',

  /* ---- 环境 ---- */
  envCheck: 'env:check',
  envProbeRuntime: 'env:probeRuntime',
  envProbeDisk: 'env:probeDisk',

  /* ---- 服务进程 ---- */
  serviceStatus: 'service:status',
  serviceStart: 'service:start',
  serviceStop: 'service:stop',
  serviceLogs: 'service:logs',
  serviceLogsClear: 'service:logsClear',

  /* ---- 任务 ---- */
  jobList: 'job:list',
  jobGet: 'job:get',
  jobCancel: 'job:cancel',

  /* ---- 版本管理 ---- */
  gitCheck: 'git:check',
  versionState: 'version:state',
  versionRemoteTags: 'version:remoteTags',
  versionCommits: 'version:commits',
  versionFetchRemote: 'version:fetchRemote',
  versionCheckUpdate: 'version:checkUpdate',
  versionPlan: 'version:plan',
  versionSwitch: 'version:switch',
  versionSyncDeps: 'version:syncDeps',
  versionOfficialUpdate: 'version:officialUpdate',

  /* ---- 备份 ---- */
  backupList: 'backup:list',
  backupDetail: 'backup:detail',
  backupCreate: 'backup:create',
  backupRestore: 'backup:restore',
  backupDelete: 'backup:delete',
  backupDir: 'backup:dir',

  /* ---- 插件管理 ---- */
  nodesList: 'nodes:list',
  nodesSearch: 'nodes:search',
  nodesInstallRegistry: 'nodes:installRegistry',
  nodesInstallGit: 'nodes:installGit',
  nodesSetEnabled: 'nodes:setEnabled',
  nodesUpdate: 'nodes:update',
  nodesUpdateAll: 'nodes:updateAll',
  nodesUninstall: 'nodes:uninstall',
  nodesInstallDeps: 'nodes:installDeps',
  nodesCheckDeps: 'nodes:checkDeps',
  nodesCheckUpdates: 'nodes:checkUpdates',
  nodesDepsDetail: 'nodes:depsDetail',
  nodesReleases: 'nodes:releases',
  nodesCheckout: 'nodes:checkout',
  nodesDepInstall: 'nodes:depInstall',
  nodesReinstallAllDeps: 'nodes:reinstallAllDeps',

  /* ---- 环境管理（pip） ---- */
  pipList: 'pip:list',
  pipInstall: 'pip:install',
  pipUninstall: 'pip:uninstall',
  pipReinstall: 'pip:reinstall',
  pipLocate: 'pip:locate',
  pipBackups: 'pip:backups',
  pipBackup: 'pip:backup',
  pipRestore: 'pip:restore',
  dialogPickPipFile: 'dialog:pickPipFile',

  /* ---- 模型管理 ---- */
  modelsScan: 'models:scan',
  modelsDelete: 'models:delete',
  modelsReveal: 'models:reveal',
  modelsDir: 'models:dir',

  /* ---- 系统交互 ---- */
  shellOpenExternal: 'shell:openExternal',
  shellOpenPath: 'shell:openPath',
  shellShowItem: 'shell:showItemInFolder',

  /* ---- 窗口控制（无边框自绘标题栏） ---- */
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:isMaximized',

  /* ---- 主进程 → 渲染进程 推送 ---- */
  evtLog: 'evt:log',
  evtServiceStatus: 'evt:serviceStatus',
  evtJob: 'evt:job',
  /** 托盘菜单等主进程发起的页面跳转，payload 为页面 id */
  evtNavigate: 'evt:navigate',

  /** 自绘托盘菜单里的点击，payload 为 open | settings | quit | dismiss */
  trayMenuAct: 'tray-menu:act',

  /* ---- 启动器自身更新 ---- */
  selfUpdateStatus: 'self-update:status',
  selfUpdateInstall: 'self-update:install',
  evtSelfUpdate: 'evt:selfUpdate'
} as const
