import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { get as httpGet } from "node:http";
import { createServer } from "node:net";

import { launchArgs } from "@explorer-launcher/electron";
import type {
  LaunchDefaults,
  LogLine,
  LogStream,
  PortOwner,
  ServiceStatus,
  Unsubscribe,
} from "@explorer-launcher/electron";

import { buildChildEnv } from "../lib/childEnv";
import { killTree, run, stripAnsi } from "../lib/exec";
import { resolveComfyPaths } from "../lib/paths";
import type { PortCandidate } from "./portPlan.mjs";
import { listenersOf, pickOwner } from "./portPlan.mjs";
import { settingsStore } from "./settings";

/* ══════════════════════════════════════════════════════════
 * ComfyUI 服务进程管理
 *
 * 对齐官方便携版的启动方式：
 *   .\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build
 * 额外补充 --port，并支持 GPU/CPU 模式与自定义参数。
 * ══════════════════════════════════════════════════════════ */

const MAX_SERVICE_LINES = 3000;
const READY_TIMEOUT_MS = 300_000;
const READY_POLL_MS = 700;

class ServiceManager {
  private child: ChildProcess | null = null;
  private state: ServiceStatus["state"] = "stopped";
  private pid: number | null = null;
  private ready = false;
  private startedAt: number | null = null;
  private exitedAt: number | null = null;
  private exitCode: number | null = null;
  private commandLine: string | null = null;
  private lastError: string | null = null;
  private bootMs: number | null = null;
  private port = 8188;
  /** 就绪探测与访问地址用的主机；开远程时可能是具体网卡 IP */
  private host = "127.0.0.1";

  private lines: LogLine[] = [];
  private seq = 0;
  private readonly logListeners = new Set<(l: LogLine) => void>();
  private readonly statusListeners = new Set<(s: ServiceStatus) => void>();
  private readyTimer: NodeJS.Timeout | null = null;
  private readyDeadline = 0;
  /** 接管了外部/遗留的 ComfyUI：进程不是本次 spawn 的 */
  private external = false;
  /** 端口冲突时记下占用者，UI 用它显示「是谁占着」并提供一键结束 */
  private portOwner: PortOwner | null = null;
  /** 端口上已有能响应的 ComfyUI（哪怕不是我们起的） */
  private portLive = false;
  /** 接管时的存活轮询；外部进程随时可能自己退出 */
  private externalTimer: NodeJS.Timeout | null = null;

  /* ── 订阅 ── */

  onLog(cb: (l: LogLine) => void): Unsubscribe {
    this.logListeners.add(cb);

    return () => this.logListeners.delete(cb);
  }

  onStatus(cb: (s: ServiceStatus) => void): Unsubscribe {
    this.statusListeners.add(cb);

    return () => this.statusListeners.delete(cb);
  }

  getLogs(): LogLine[] {
    return [...this.lines];
  }

  clearLogs(): void {
    this.lines = [];
    this.seq = 0;
  }

  status(): ServiceStatus {
    return {
      state: this.state,
      pid: this.pid,
      port: this.port,
      url: this.ready ? `http://${this.host}:${this.port}` : null,
      ready: this.ready,
      startedAt: this.startedAt,
      exitedAt: this.exitedAt,
      exitCode: this.exitCode,
      commandLine: this.commandLine,
      lastError: this.lastError,
      bootMs: this.bootMs,
      external: this.external,
      portOwner: this.portOwner,
      portLive: this.portLive,
    };
  }

  private log(text: string, stream: LogStream = "system"): void {
    const line: LogLine = {
      seq: ++this.seq,
      ts: Date.now(),
      stream,
      text: stripAnsi(text),
    };

    this.lines.push(line);

    if (this.lines.length > MAX_SERVICE_LINES) {
      this.lines.splice(0, this.lines.length - MAX_SERVICE_LINES);
    }

    for (const cb of this.logListeners) {
      cb(line);
    }
  }

  /**
   * 把非 ComfyUI 进程的输出也写进同一条日志流。
   * 任务系统（git clone / pip install / 版本切换）用它，控制台页才能看到完整记录。
   */
  logExternal(text: string, stream: LogStream = "system"): void {
    this.log(text, stream);
  }

  private pushStatus(): void {
    const s = this.status();

    for (const cb of this.statusListeners) {
      cb(s);
    }
  }

  private setState(state: ServiceStatus["state"]): void {
    this.state = state;
    this.pushStatus();
  }

  /* ── 启动 ── */

  async start(override?: Partial<LaunchDefaults>): Promise<ServiceStatus> {
    if (this.child || this.state === "launching" || this.state === "running") {
      return this.status();
    }

    const settings = settingsStore.get();
    const cfg: LaunchDefaults = { ...settings.launch, ...override };
    const paths = resolveComfyPaths(settings.comfyRoot);

    this.port = cfg.port;
    /* 探测与「打开界面」都打这个地址：绑定到具体网卡时 127.0.0.1 是不通的 */
    this.host = accessHost(cfg);
    this.lastError = null;
    this.exitCode = null;
    this.exitedAt = null;
    this.bootMs = null;
    this.ready = false;
    this.portOwner = null;
    this.portLive = false;
    this.external = false;
    this.stopExternalWatch();

    /* 端口占用预检：先查清是谁占着，再决定能不能接管 */
    const free = await isPortFree(cfg.port);

    if (!free) {
      const owner = await findPortOwner(cfg.port, settings.comfyRoot);
      const live = await probeSystemStats(this.host, cfg.port);
      this.portOwner = owner;
      this.portLive = live;

      // 本机这套 ComfyUI 还活着（上次启动器被强杀留下的）：直接接管，不再重复起一份
      if (live && owner?.isOurComfy) {
        this.log(
          "[启动器] 端口上已经有一个本机 ComfyUI 在运行，直接接管，不再重复启动"
        );
        this.attachExternal(owner, cfg.port, this.host);

        return this.status();
      }

      const who = owner ? `${owner.name}（PID ${owner.pid}）` : "未知进程";
      this.lastError = live
        ? `端口 ${cfg.port} 已被 ${who} 占用，而且这个端口上已经有一个能响应的 ComfyUI。可以直接打开它，或者结束该进程后重新启动。`
        : `端口 ${cfg.port} 已被 ${who} 占用。可以结束该进程后重新启动，或在设置里换个端口。`;
      this.log(`[启动器] ${this.lastError}`, "stderr");
      this.setState("error");

      return this.status();
    }

    // 浏览器由 ComfyUI 自己开（--windows-standalone-build 在服务开始监听后调 call_on_start），
    // 只有设置里关掉「自动打开」时才传 --disable-auto-launch
    const args = launchArgs(cfg);
    this.commandLine = `${paths.pythonExe} ${args.join(" ")}`;

    this.log(`[启动器] 工作目录：${paths.root}`);
    this.log(`[启动器] 命令：${this.commandLine}`);

    if (cfg.mode === "cpu") {
      this.log("[启动器] 模式：CPU（速度很慢，仅用于排障）");
    } else {
      this.log("[启动器] 模式：GPU");
    }

    try {
      this.child = spawn(paths.pythonExe, args, {
        cwd: paths.root,
        env: buildChildEnv(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      this.state = "error";
      this.lastError = `无法启动进程：${error instanceof Error ? error.message : String(error)}`;
      this.log(`[启动器] ${this.lastError}`, "stderr");
      this.pushStatus();

      return this.status();
    }

    this.pid = this.child.pid ?? null;
    this.startedAt = Date.now();
    this.setState("launching");

    this.child.stdout?.setEncoding("utf-8");
    this.child.stderr?.setEncoding("utf-8");
    this.child.stdout?.on("data", (d: string) => {
      this.ingest(d, "stdout");
    });
    this.child.stderr?.on("data", (d: string) => {
      this.ingest(d, "stderr");
    });

    this.child.on("error", (err) => {
      this.lastError = `进程错误：${err.message}`;
      this.log(`[启动器] ${this.lastError}`, "stderr");
    });

    this.child.on("close", (code) => {
      this.child = null;
      this.pid = null;
      this.exitCode = code;
      this.exitedAt = Date.now();
      this.ready = false;
      this.stopReadyPoll();

      if (this.state === "stopping") {
        this.log("[启动器] ComfyUI 已停止。");
        this.setState("stopped");
      } else if (code === 0) {
        this.log("[启动器] ComfyUI 进程已退出（退出码 0）。");
        this.setState("stopped");
      } else {
        this.lastError = `ComfyUI 异常退出，退出码 ${code}`;
        this.log(`[启动器] ${this.lastError}`, "stderr");
        this.setState("error");
      }
    });

    this.startReadyPoll();
    this.pushStatus();

    return this.status();
  }

  /* ── 停止 ── */

  async stop(): Promise<ServiceStatus> {
    if (!this.child && !this.external) {
      this.ready = false;

      if (this.state !== "stopped") {
        this.setState("stopped");
      }
      return this.status();
    }

    this.setState("stopping");
    this.log("[启动器] 正在停止 ComfyUI…");

    /* 接管来的进程没有 close 事件可等：taskkill 之后自己收拾状态 */
    if (!this.child) {
      this.stopExternalWatch();
      killTree(this.pid ?? undefined);
      await new Promise((r) => setTimeout(r, 900));
      this.external = false;
      this.pid = null;
      this.ready = false;
      this.exitedAt = Date.now();
      this.portOwner = null;
      this.portLive = false;
      this.log("[启动器] 已结束接管的 ComfyUI。");
      this.setState("stopped");

      return this.status();
    }

    const { pid } = this.child;
    killTree(pid);

    // 给进程树最多 8 秒优雅退出，超时则放弃等待（taskkill /F 已经是强杀）
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 8000);
      this.child?.once("close", () => {
        clearTimeout(t);
        resolve();
      });
    });

    if (this.child) {
      this.child = null;
      this.pid = null;
      this.ready = false;
      this.exitedAt = Date.now();
      this.stopReadyPoll();
      this.setState("stopped");
    }

    return this.status();
  }

  /** 应用退出时调用，保证不留孤儿进程 */
  dispose(): void {
    this.stopReadyPoll();
    this.stopExternalWatch();

    // 接管来的进程不是我们 spawn 的，退出启动器时不动它（下次启动还能继续接管）
    if (this.child?.pid) {
      killTree(this.child.pid);
    }
  }

  /* ── 接管 / 端口冲突 ── */

  /**
   * 启动器刚起来时探一次端口：如果上面跑的就是本机这套 ComfyUI，
   * 直接接管成 running，用户不用再手动去关进程。
   */
  async adoptExisting(): Promise<ServiceStatus> {
    if (this.child || this.state === "running" || this.state === "launching") {
      return this.status();
    }

    const cfg = settingsStore.get().launch;
    this.port = cfg.port;
    this.host = accessHost(cfg);

    if (await isPortFree(cfg.port)) {
      return this.status();
    }
    if (!(await probeSystemStats(this.host, cfg.port))) {
      return this.status();
    }

    const owner = await findPortOwner(cfg.port, settingsStore.get().comfyRoot);

    if (!owner?.isOurComfy) {
      return this.status();
    }

    this.log(
      `[启动器] 检测到上次留下的 ComfyUI 仍在运行，直接接管（PID ${owner.pid}）`
    );
    this.attachExternal(owner, cfg.port, this.host);

    return this.status();
  }

  /** 结束占着端口、导致起不来的那个进程（用户在端口冲突提示里确认后调用） */
  async killPortOwner(): Promise<ServiceStatus> {
    // 只在「端口冲突、起不来」时才允许动手：
    // 自己 spawn 的进程走 stop()，接管的进程走 stop()，绝不能从这里误杀
    if (this.child || this.external) {
      return this.status();
    }

    const target =
      this.portOwner ??
      (await findPortOwner(this.port, settingsStore.get().comfyRoot));

    if (target) {
      this.log(
        `[启动器] 正在结束占用端口 ${this.port} 的进程：${target.name}（PID ${target.pid}）`
      );
      killTree(target.pid);
      // taskkill /F 是异步的，给它一点时间把端口让出来
      await new Promise((r) => setTimeout(r, 1200));
    }

    this.portOwner = null;
    this.portLive = false;
    this.lastError = null;

    if (this.state === "error") {
      this.setState("stopped");
    } else {
      this.pushStatus();
    }
    return this.status();
  }

  /** 接管一个已经在跑的 ComfyUI */
  private attachExternal(owner: PortOwner, port: number, host: string): void {
    this.stopReadyPoll();
    this.external = true;
    this.pid = owner.pid;
    this.port = port;
    this.host = host;
    this.ready = true;
    this.startedAt = Date.now();
    this.exitedAt = null;
    this.exitCode = null;
    this.bootMs = null;
    this.lastError = null;
    this.portOwner = owner;
    this.portLive = true;
    this.commandLine = owner.commandLine;
    this.log(
      `[启动器] 已接管端口 ${port} 上的 ComfyUI（PID ${owner.pid}），点「停止」可以直接关掉它`
    );
    this.watchExternal();
    this.setState("running");
  }

  /** 外部进程不受我们管理，靠 /system_stats 轮询判断它是否还活着 */
  private watchExternal(): void {
    this.stopExternalWatch();
    let misses = 0;
    this.externalTimer = setInterval(() => {
      if (!this.external) {
        return;
      }
      void probeSystemStats(this.host, this.port).then((alive) => {
        if (!this.external) {
          return;
        }
        if (alive) {
          misses = 0;

          return;
        }

        misses++;

        if (misses < 2) {
          return;
        }
        this.stopExternalWatch();
        this.external = false;
        this.pid = null;
        this.ready = false;
        this.exitedAt = Date.now();
        this.log("[启动器] 接管的 ComfyUI 已经不在线了。");
        this.setState("stopped");
      });
    }, 4000);
  }

  private stopExternalWatch(): void {
    if (this.externalTimer) {
      clearInterval(this.externalTimer);
      this.externalTimer = null;
    }
  }

  /* ── 输出解析 ── */

  private pending = "";

  private ingest(chunk: string, stream: LogStream): void {
    this.pending += chunk;
    let idx: number;

    while ((idx = this.pending.search(/\r\n|\n|\r/)) !== -1) {
      const line = this.pending.slice(0, idx);
      const sep = /^\r\n|^\n|^\r/.exec(this.pending.slice(idx))?.[0] ?? "";
      this.pending = this.pending.slice(idx + sep.length);

      if (line.length > 0) {
        this.handleLine(line, stream);
      }
    }

    // 防止异常进程刷屏把内存吃光
    if (this.pending.length > 64 * 1024) {
      this.pending = this.pending.slice(-8192);
    }
  }

  private handleLine(line: string, stream: LogStream): void {
    this.log(line, stream);

    // 官方启动横幅会打印可直接访问的地址
    const m = /To see the GUI go to:\s*(https?:\/\/\S+)/i.exec(line);

    if (m) {
      this.log(`[启动器] 检测到服务地址：${m[1]}`);
    }
  }

  /* ── 就绪探测 ── */

  private startReadyPoll(): void {
    this.stopReadyPoll();
    this.readyDeadline = Date.now() + READY_TIMEOUT_MS;

    const tick = async (): Promise<void> => {
      if (!this.child || this.state === "stopping") {
        return;
      }

      if (await probeSystemStats(this.host, this.port)) {
        this.ready = true;
        this.bootMs = this.startedAt ? Date.now() - this.startedAt : null;
        this.log(
          `[启动器] ComfyUI 已就绪：http://${this.host}:${this.port}${
            this.bootMs
              ? `（启动耗时 ${(this.bootMs / 1000).toFixed(1)}s）`
              : ""
          }`
        );
        this.setState("running");

        return;
      }

      if (Date.now() > this.readyDeadline) {
        this.lastError = `等待服务就绪超时（${READY_TIMEOUT_MS / 1000} 秒），请查看日志排查。`;
        this.log(`[启动器] ${this.lastError}`, "stderr");
        this.setState("error");

        return;
      }

      this.readyTimer = setTimeout(() => void tick(), READY_POLL_MS);
    };

    void tick();
  }

  private stopReadyPoll(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
  }
}

/* ── 工具函数 ── */

/** 实际访问/探测用的主机：绑定 0.0.0.0 或没开远程时，回环地址才是通的 */
function accessHost(launch: Pick<LaunchDefaults, "remote" | "listen">): string {
  return launch.remote && launch.listen && launch.listen !== "0.0.0.0"
    ? launch.listen
    : "127.0.0.1";
}

/** 用 /system_stats 判断服务是否真的起来了 */
async function probeSystemStats(
  host: string,
  port: number,
  timeoutMs = 2500
): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpGet(
      { host, port, path: "/system_stats", timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(
          Boolean(
            res.statusCode && res.statusCode >= 200 && res.statusCode < 500
          )
        );
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => {
      resolve(false);
    });
  });
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => {
      resolve(false);
    });
    srv.once("listening", () =>
      srv.close(() => {
        resolve(true);
      })
    );
    srv.listen(port, "127.0.0.1");
  });
}

/* ── 端口占用者识别 ── */

/**
 * 枚举「监听该端口」的连接及其进程信息。
 *
 * 为什么不用 netstat：本机实测 netstat 会漏掉 / 把 PID 打成 0
 * （连 Get-NetTCPConnection 的 State 列在本机也是空的），
 * 所以主路径用 Get-NetTCPConnection 拿 OwningProcess，再查进程名与命令行。
 * PID / 端口都走环境变量，避免脚本拼接。
 */
const OWNER_PS_SCRIPT = [
  "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
  "$port = [int]$env:XL_OWNER_PORT",
  "$rows = @()",
  "foreach ($c in @(Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue)) {",
  '  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue',
  "  if ($proc) {",
  "    $rows += [pscustomobject]@{ pid = [int]$c.OwningProcess; localAddress = $c.LocalAddress; name = $proc.Name; commandLine = $proc.CommandLine }",
  "  }",
  "}",
  "$rows | ConvertTo-Json -Compress",
].join("\n");

/** 单个进程的名称与命令行（netstat 兜底路径用） */
const PROC_PS_SCRIPT = [
  "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
  '$p = Get-CimInstance Win32_Process -Filter "ProcessId=$env:XL_OWNER_PID" -ErrorAction SilentlyContinue',
  "if ($p) { $p | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress }",
].join("\n");

function asRows(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    return parsed as Record<string, unknown>[];
  }
  if (parsed && typeof parsed === "object") {
    return [parsed as Record<string, unknown>];
  }
  return [];
}

async function listPortCandidates(port: number): Promise<PortCandidate[]> {
  const ps = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", OWNER_PS_SCRIPT],
    { timeoutMs: 12_000, env: { ...process.env, XL_OWNER_PORT: String(port) } }
  );

  if (ps.code === 0 && ps.stdout.trim()) {
    try {
      const rows = asRows(JSON.parse(ps.stdout.trim()));
      const out: PortCandidate[] = [];

      for (const row of rows) {
        const pid = Number(row.pid);

        if (!Number.isInteger(pid) || pid <= 0) {
          continue;
        }
        out.push({
          pid,
          name: typeof row.name === "string" ? row.name : "unknown",
          commandLine:
            typeof row.commandLine === "string" ? row.commandLine : null,
          localAddress:
            typeof row.localAddress === "string" ? row.localAddress : null,
        });
      }

      if (out.length > 0) {
        return out;
      }
    } catch {
      /* 落到 netstat 兜底 */
    }
  }

  // 兜底：netstat 拿 PID，再逐个查进程信息
  const netstat = await run("netstat", ["-ano", "-p", "tcp"], {
    timeoutMs: 8000,
  });

  const pids = listenersOf(netstat.stdout, port);
  const out: PortCandidate[] = [];

  for (const pid of pids) {
    const info = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", PROC_PS_SCRIPT],
      { timeoutMs: 10_000, env: { ...process.env, XL_OWNER_PID: String(pid) } }
    );

    let name = "unknown";
    let commandLine: string | null = null;

    if (info.code === 0 && info.stdout.trim()) {
      try {
        const row = asRows(JSON.parse(info.stdout.trim()))[0] ?? {};

        if (typeof row.Name === "string") {
          name = row.Name;
        }
        if (typeof row.CommandLine === "string") {
          commandLine = row.CommandLine;
        }
      } catch {
        /* 保持 unknown */
      }
    }

    out.push({ pid, name, commandLine });
  }

  return out;
}

/**
 * 找出占着某个端口的进程。同一端口可能有多个监听者：
 * 优先返回本机这套 ComfyUI，其次回环监听的那个。
 * 拿不到命令行时 commandLine 为 null —— 这种情况不会自动接管，只会提示用户。
 */
async function findPortOwner(
  port: number,
  comfyRoot: string
): Promise<PortOwner | null> {
  const candidates = await listPortCandidates(port);

  return pickOwner(candidates, comfyRoot);
}

export const serviceManager = new ServiceManager();
