import { z } from "zod";

import { IPC } from "./ipc.ts";

/**
 * 启动器 IPC 契约（主进程 / preload / 渲染进程共用）
 *
 * 领域模型与通道常量来自旧项目 `src/shared`，原样迁入本包；
 * 通道字符串只在这里定义一次，避免三端各写一遍导致漂移。
 */
export * from "./dep-status.mjs";

export * from "./ipc.ts";

export * from "./launch-command.ts";

export type * from "./types.ts";

export const desktopBridgeGlobal = "desktop";

// https, because clients such as Better Auth accept only http and https origins.
export const rendererHost = "app.localhost";
export const rendererOrigin = `https://${rendererHost}`;

export const desktopChannels = IPC;

export const versionsSchema = z.object({
  app: z.string(),
  chrome: z.string(),
  electron: z.string(),
  node: z.string(),
});

export type DesktopVersions = z.infer<typeof versionsSchema>;

export interface DesktopApi {
  versions: () => Promise<DesktopVersions>;
}
