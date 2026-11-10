import { randomUUID } from "node:crypto";

import { classifyLogLevel } from "@explorer-launcher/electron";
import type {
  JobEvent,
  JobSnapshot,
  JobStatus,
  LogLevel,
  LogLine,
  LogStream,
  Unsubscribe,
} from "@explorer-launcher/electron";

import { serviceManager } from "./service";

/* ══════════════════════════════════════════════════════════
 * 任务管理器
 *
 * 所有耗时操作（更新、切版、装插件、装依赖）都走这里：
 * 进度给底部状态栏，过程与记录只写进控制台，不在业务页再铺一块输出。
 * ══════════════════════════════════════════════════════════ */

const MAX_LINES_PER_JOB = 2000;
const MAX_FINISHED_JOBS = 30;

export interface JobContext {
  id: string;
  signal: AbortSignal;
  /** 追加一行日志；已知结果时显式传 level，否则按内容判定 */
  log(text: string, stream?: LogStream, level?: LogLevel): void;
  /** 设置进度，null 表示不确定进度 */
  progress(percent: number | null): void;
}

/** 任务快照 + 进程内的取消句柄与日志序号 */
interface JobRecord extends JobSnapshot {
  controller: AbortController;
  seq: number;
}

class JobManager {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly listeners = new Set<(e: JobEvent) => void>();

  onEvent(cb: (e: JobEvent) => void): Unsubscribe {
    this.listeners.add(cb);

    return () => this.listeners.delete(cb);
  }

  private emit(e: JobEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        /* 单个订阅者异常不应影响其他订阅者 */
      }
    }
  }

  /** 运行一个任务；成功返回结果，失败抛出原始错误 */
  async run<T>(
    kind: string,
    title: string,
    fn: (ctx: JobContext) => Promise<T>
  ): Promise<T> {
    const rec: JobRecord = {
      id: randomUUID(),
      kind,
      title,
      status: "running",
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      error: null,
      percent: null,
      lines: [],
      controller: new AbortController(),
      seq: 0,
    };

    this.jobs.set(rec.id, rec);
    this.gc();
    this.emit({ jobId: rec.id, kind: "created", snapshot: this.snapshot(rec) });
    serviceManager.logLauncher(`[任务] 开始：${title}`, "system", "info");

    const ctx: JobContext = {
      id: rec.id,
      signal: rec.controller.signal,
      log: (text, stream, level) => {
        this.append(rec, text, stream ?? "system", level);
      },
      progress: (percent) => {
        rec.percent = percent;
        this.emit({ jobId: rec.id, kind: "progress", percent });
      },
    };

    try {
      const result = await fn(ctx);
      this.finish(rec, "succeeded", 0, null);

      return result;
    } catch (error) {
      const aborted = rec.controller.signal.aborted;
      const message = error instanceof Error ? error.message : String(error);
      this.finish(
        rec,
        aborted ? "canceled" : "failed",
        null,
        aborted ? null : message
      );
      throw error;
    }
  }

  private append(
    rec: JobRecord,
    text: string,
    stream: LogStream,
    explicit?: LogLevel
  ): void {
    const previous = rec.lines.at(-1)?.level;
    const level = classifyLogLevel(text, explicit, previous);
    const line: LogLine = {
      seq: ++rec.seq,
      ts: Date.now(),
      stream,
      level,
      text,
    };
    rec.lines.push(line);

    if (rec.lines.length > MAX_LINES_PER_JOB) {
      rec.lines.splice(0, rec.lines.length - MAX_LINES_PER_JOB);
    }

    this.emit({ jobId: rec.id, kind: "line", line });
    const visible = text.trim();

    if (visible) {
      serviceManager.logLauncher(visible, stream, level);
    }
  }

  private finish(
    rec: JobRecord,
    status: JobStatus,
    exitCode: number | null,
    error: string | null
  ): void {
    rec.status = status;
    rec.endedAt = Date.now();
    rec.exitCode = exitCode;
    rec.error = error;
    this.emit({
      jobId: rec.id,
      kind: "finished",
      snapshot: this.snapshot(rec),
    });
    const level: LogLevel =
      status === "succeeded"
        ? "success"
        : status === "canceled"
          ? "warn"
          : "error";

    serviceManager.logLauncher(
      status === "succeeded"
        ? `[任务] 完成：${rec.title}`
        : status === "canceled"
          ? `[任务] 已取消：${rec.title}`
          : `[任务] 失败：${rec.title}${error ? ` — ${error}` : ""}`,
      "system",
      level
    );
  }

  cancel(id: string): boolean {
    const rec = this.jobs.get(id);

    if (!rec || rec.status !== "running") {
      return false;
    }
    rec.controller.abort();

    return true;
  }

  get(id: string): JobSnapshot | null {
    const rec = this.jobs.get(id);

    return rec ? this.snapshot(rec) : null;
  }

  list(): JobSnapshot[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((r) => this.snapshot(r));
  }

  private snapshot(rec: JobRecord): JobSnapshot {
    return {
      id: rec.id,
      kind: rec.kind,
      title: rec.title,
      status: rec.status,
      startedAt: rec.startedAt,
      endedAt: rec.endedAt,
      exitCode: rec.exitCode,
      error: rec.error,
      lines: rec.lines.slice(-400),
      percent: rec.percent,
    };
  }

  /** 只保留最近若干个已完成任务，避免长会话内存膨胀 */
  private gc(): void {
    const finished = [...this.jobs.values()]
      .filter((r) => r.status !== "running")
      .sort((a, b) => b.startedAt - a.startedAt);

    for (const r of finished.slice(MAX_FINISHED_JOBS)) {
      this.jobs.delete(r.id);
    }
  }
}

export const jobManager = new JobManager();
