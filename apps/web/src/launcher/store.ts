import { create } from "zustand";

import type {
  AppSettings,
  EnvLayout,
  JobEvent,
  JobSnapshot,
  LaunchDefaults,
  LogLine,
  RuntimeInfo,
  ServiceStatus,
} from "@explorer-launcher/electron";
/* ══════════════════════════════════════════════════════════
 * 全局状态
 *
 * 原则：IPC 是唯一数据源，store 只做「缓存 + 订阅转发」，
 * 不在渲染进程推导任何业务事实（例如「是否已就绪」一律取主进程结论）。
 * ══════════════════════════════════════════════════════════ */

/** 托盘菜单可发起的页面跳转（等于各路由路径去掉前导斜杠） */
export type PageId =
  | "dashboard"
  | "versions"
  | "nodes"
  | "models"
  | "packages"
  | "logs"
  | "settings";

const MAX_LOG_LINES = 3000;

/** 全局轻提示：装/卸/更新这类「跑完就该知道」的结果统一走这里 */
interface Toast {
  id: number;
  tone: "ok" | "warn" | "error";
  text: string;
}

let toastSeq = 0;

const TOAST_TTL_MS = 5200;
const MAX_TOASTS = 4;

interface AppState {
  /* 引导 */
  booted: boolean;
  bootError: string | null;

  /* 数据 */
  settings: AppSettings | null;
  env: EnvLayout | null;
  envLoading: boolean;
  runtime: RuntimeInfo | null;
  runtimeLoading: boolean;
  service: ServiceStatus | null;
  logs: LogLine[];
  jobs: JobSnapshot[];
  toasts: Toast[];

  /* 动作 */
  boot: () => Promise<void>;
  refreshEnv: (root?: string) => Promise<void>;
  probeRuntime: (root?: string) => Promise<void>;
  startService: (override?: Partial<LaunchDefaults>) => Promise<void>;
  stopService: () => Promise<void>;
  clearLogs: () => Promise<void>;
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>;
  toggleTheme: () => Promise<void>;
  pushToast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
}

const MAX_JOBS = 40;

/**
 * 同一条任务可能先收到「已结束」、后收到启动时的旧 running 快照。
 * 已经结束的记录不能再被 running 盖回去，否则底部进度条会一直转。
 * 日志留更长的那份：渲染进程是逐行累的，主进程快照只带最后 400 行。
 */
function preferJob(current: JobSnapshot, incoming: JobSnapshot): JobSnapshot {
  const lines =
    current.lines.length >= incoming.lines.length
      ? current.lines
      : incoming.lines;

  if (current.status !== "running" && incoming.status === "running") {
    return {
      ...incoming,
      status: current.status,
      endedAt: current.endedAt,
      exitCode: current.exitCode,
      error: current.error,
      percent: current.percent,
      lines,
    };
  }

  return { ...current, ...incoming, lines };
}

function upsertJob(jobs: JobSnapshot[], incoming: JobSnapshot): JobSnapshot[] {
  const idx = jobs.findIndex((j) => j.id === incoming.id);

  if (idx === -1) {
    return [incoming, ...jobs].slice(0, MAX_JOBS);
  }
  const updated = [...jobs];
  const current = jobs[idx];

  if (!current) {
    return jobs;
  }
  updated[idx] = preferJob(current, incoming);

  return updated;
}

function mergeJobLists(
  live: JobSnapshot[],
  fetched: JobSnapshot[]
): JobSnapshot[] {
  const seen = new Set<string>();
  const out: JobSnapshot[] = [];
  const liveMap = new Map(live.map((j) => [j.id, j]));
  const fetchedMap = new Map(fetched.map((j) => [j.id, j]));

  for (const id of [...liveMap.keys(), ...fetchedMap.keys()]) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const a = liveMap.get(id);
    const b = fetchedMap.get(id);

    if (a && b) {
      out.push(preferJob(a, b));
    } else {
      const fallback = a ?? b;

      if (fallback) {
        out.push(fallback);
      }
    }
  }

  out.sort((x, y) => y.startedAt - x.startedAt);

  return out.slice(0, MAX_JOBS);
}

function applyJobEvent(jobs: JobSnapshot[], event: JobEvent): JobSnapshot[] {
  if (event.kind === "created" && event.snapshot) {
    return upsertJob(jobs, event.snapshot);
  }

  const idx = jobs.findIndex((j) => j.id === event.jobId);

  if (idx === -1) {
    return event.snapshot ? upsertJob(jobs, event.snapshot) : jobs;
  }

  const current = jobs[idx];

  if (!current) {
    return jobs;
  }
  let next = current;

  if (event.line) {
    next = { ...next, lines: [...next.lines, event.line] };
  }
  if (event.percent !== undefined) {
    next = { ...next, percent: event.percent };
  }
  if (event.snapshot) {
    next = preferJob(next, event.snapshot);
  }

  const updated = [...jobs];
  updated[idx] = next;

  return updated;
}

/** preload 未成功注入时给出可操作的提示，而不是白屏 */
function api(): Window["launcher"] {
  const l = window.launcher;

  if (!l) {
    throw new Error(
      "预加载脚本未注入（window.launcher 不存在），请重启应用或检查 preload 构建产物。"
    );
  }

  return l;
}

let eventsBound = false;
let reconcileTimer: number | null = null;

/** 主进程里任务已经结束、但 finished 事件没送到时，把界面上的 running 对回去。 */
function ensureJobReconcile(): void {
  if (reconcileTimer !== null) {
    return;
  }
  reconcileTimer = window.setInterval(() => {
    const running = useApp
      .getState()
      .jobs.filter((j) => j.status === "running");

    if (running.length === 0) {
      if (reconcileTimer !== null) {
        window.clearInterval(reconcileTimer);
      }
      reconcileTimer = null;

      return;
    }

    for (const job of running) {
      void api()
        .getJob(job.id)
        .then((fresh) => {
          if (fresh?.status === "running") {
            return;
          }
          useApp.setState((state) => ({
            jobs: fresh
              ? state.jobs.map((j) =>
                  j.id === fresh.id ? preferJob(j, fresh) : j
                )
              : state.jobs.filter((j) => j.id !== job.id),
          }));
        })
        .catch(() => {
          /* 下一轮再问 */
        });
    }
  }, 1000);
}

export const useApp = create<AppState>((set, get) => ({
  booted: false,
  bootError: null,
  settings: null,
  env: null,
  envLoading: false,
  runtime: null,
  runtimeLoading: false,
  service: null,
  logs: [],
  jobs: [],
  toasts: [],

  pushToast(text, tone = "ok") {
    const id = ++toastSeq;
    set((s) => ({
      toasts: [...s.toasts, { id, tone, text }].slice(-MAX_TOASTS),
    }));
    window.setTimeout(() => {
      get().dismissToast(id);
    }, TOAST_TTL_MS);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  async boot() {
    try {
      const launcher = api();

      /* 先订阅再拉列表。反过来的话，列表读到 running 之后、订阅安上之前结束的任务，
         finished 事件没人接，界面会永远停在「进行中」，底部进度条就停不下来。 */
      if (!eventsBound) {
        eventsBound = true;
        launcher.onLog((line) => {
          const next = [...get().logs, line];
          set({
            logs:
              next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next,
          });
        });
        launcher.onServiceStatus((status) => {
          set({ service: status });
        });
        launcher.onJobEvent((event) => {
          set((state) => ({ jobs: applyJobEvent(state.jobs, event) }));

          if (get().jobs.some((j) => j.status === "running")) {
            ensureJobReconcile();
          }
        });
      }

      const [settings, service, logs, jobs] = await Promise.all([
        launcher.getSettings(),
        launcher.getServiceStatus(),
        launcher.getServiceLogs(),
        launcher.listJobs(),
      ]);

      applyTheme(settings.theme);
      set((state) => ({
        settings,
        service,
        logs,
        jobs: mergeJobLists(state.jobs, jobs),
        booted: true,
        bootError: null,
      }));

      if (get().jobs.some((j) => j.status === "running")) {
        ensureJobReconcile();
      }

      await get().refreshEnv();
      void get().probeRuntime();
    } catch (error) {
      set({
        bootError: error instanceof Error ? error.message : String(error),
        booted: true,
      });
    }
  },

  async refreshEnv(root) {
    set({ envLoading: true });

    try {
      const env = await api().checkEnv(root);
      set({ env, envLoading: false });
    } catch (error) {
      set({
        envLoading: false,
        bootError: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async probeRuntime(root) {
    set({ runtimeLoading: true });

    try {
      const runtime = await api().probeRuntime(root);
      set({ runtime, runtimeLoading: false });
    } catch (error) {
      set({
        runtimeLoading: false,
        runtime: {
          probed: true,
          ok: false,
          pythonVersion: null,
          torchVersion: null,
          cudaVersion: null,
          cudaAvailable: false,
          gpuName: null,
          deviceCount: 0,
          pipVersion: null,
          error: error instanceof Error ? error.message : String(error),
          probedAt: Date.now(),
        },
      });
    }
  },

  async startService(override) {
    const service = await api().startService(override);
    set({ service });
  },

  async stopService() {
    const service = await api().stopService();
    set({ service });
  },

  async clearLogs() {
    await api().clearServiceLogs();
    set({ logs: [] });
  },

  async patchSettings(patch) {
    const settings = await api().patchSettings(patch);

    if (patch.theme) {
      applyTheme(settings.theme);
    }
    set({ settings });
  },

  async toggleTheme() {
    const current = get().settings;

    if (!current) {
      return;
    }
    await get().patchSettings({
      theme: current.theme === "dark" ? "light" : "dark",
    });
  },
}));

const PAGE_IDS: readonly PageId[] = [
  "dashboard",
  "versions",
  "nodes",
  "models",
  "packages",
  "logs",
  "settings",
];

function isPageId(value: string): value is PageId {
  return (PAGE_IDS as readonly string[]).includes(value);
}

let hostNavigate: ((page: PageId) => void) | null = null;

/** 路由接管「主进程要求跳转」的唯一入口；返回注销函数。 */
export function onHostNavigate(fn: (page: PageId) => void): () => void {
  hostNavigate = fn;

  return () => {
    hostNavigate = null;
  };
}

/**
 * 托盘菜单「设置」从主进程推页面。模块一加载就订阅，
 * 这样窗口还在首屏时事件也不会丢。
 */
function bindHostNavigation(): void {
  const flagHost = globalThis as typeof globalThis & {
    __xlHostNavBound?: boolean;
  };

  if (flagHost.__xlHostNavBound) {
    return;
  }
  const { launcher } = window;

  if (!launcher) {
    return;
  }
  flagHost.__xlHostNavBound = true;
  launcher.onNavigate((page) => {
    if (!isPageId(page)) {
      return;
    }
    // 页面由路由持有，这里只把主进程的意图转成一次路由跳转
    hostNavigate?.(page);
  });

  // 无人值守截图脚本（XL_CAPTURE_ROUTE）走 DOM 事件，同样汇到路由
  window.addEventListener("xl:navigate", (event) => {
    const detail: unknown = (event as CustomEvent<unknown>).detail;

    if (typeof detail === "string" && isPageId(detail)) {
      hostNavigate?.(detail);
    }
  });
}

bindHostNavigation();

function applyTheme(theme: AppSettings["theme"]): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // Element Plus 的暗色变量挂在 html.dark 上；原版切亮色时是 removeClass('dark') + addClass('light')
  root.classList.toggle("dark", theme !== "light");
  root.classList.toggle("light", theme === "light");
}
