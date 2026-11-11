import { ipcMain } from "electron";

import { IPC } from "@explorer-launcher/electron";
import type {
  InstallResult,
  InstalledNode,
  NodeDepsDetail,
  NodeBulkUpdateResult,
  NodeDepsReport,
  NodeReleases,
  NodeToggleResult,
  NodeUpdateInfo,
  OpResult,
  RegistrySearchResult,
} from "@explorer-launcher/electron";

import { runOp } from "./lib/runOp";
import { bulkUpdateError } from "./services/nodeBulkUpdate.mjs";
import {
  checkNodeDeps,
  checkNodeUpdates,
  checkoutNode,
  installFromGit,
  installFromRegistry,
  installNodeDeps,
  installOneNodeDep,
  isSafeNodeDirName,
  listInstalledNodes,
  nodeDepsDetail,
  nodeReleases,
  reinstallAllNodeDeps,
  setNodeEnabled,
  uninstallNode,
  updateAllNodes,
  updateNode,
} from "./services/nodes";
import { searchRegistry } from "./services/registry";
import { pickRoot } from "./services/settings";

/* ══════════════════════════════════════════════════════════
 * 插件管理 IPC（M3）
 * ══════════════════════════════════════════════════════════ */

/** 目录名进入文件系统路径，必须先做白名单校验 */
function assertSafeDirName(dirName: string): void {
  if (!isSafeNodeDirName(dirName)) {
    throw new Error(`非法的插件目录名：${dirName}`);
  }
}

export function registerNodesIpc(): void {
  ipcMain.handle(
    IPC.nodesList,
    async (_e, root?: string): Promise<InstalledNode[]> =>
      await listInstalledNodes(pickRoot(root))
  );

  ipcMain.handle(
    IPC.nodesSearch,
    async (
      _e,
      query: string,
      page?: number,
      limit?: number
    ): Promise<RegistrySearchResult> => {
      // Registry 的 limit 上限是 100，超了会被静默截断
      const size = limit && limit > 0 ? Math.min(100, Math.floor(limit)) : 24;

      return await searchRegistry(
        query ?? "",
        page && page > 0 ? Math.floor(page) : 1,
        size
      );
    }
  );

  ipcMain.handle(
    IPC.nodesCheckUpdates,
    async (_e, root?: string): Promise<NodeUpdateInfo[]> =>
      await checkNodeUpdates(pickRoot(root))
  );

  ipcMain.handle(
    IPC.nodesCheckDeps,
    async (_e, root?: string): Promise<NodeDepsReport> =>
      await checkNodeDeps(pickRoot(root))
  );

  ipcMain.handle(
    IPC.nodesSetEnabled,
    async (
      _e,
      dirName: string,
      enabled: boolean,
      root?: string
    ): Promise<NodeToggleResult> => {
      assertSafeDirName(dirName);

      return await setNodeEnabled(pickRoot(root), dirName, Boolean(enabled));
    }
  );

  ipcMain.handle(
    IPC.nodesInstallRegistry,
    async (
      _e,
      nodeId: string,
      root?: string
    ): Promise<OpResult<InstallResult>> => {
      const target = pickRoot(root);

      return await runOp(
        "node-install",
        `安装插件 ${nodeId}`,
        async (ctx) =>
          await installFromRegistry(
            target,
            nodeId,
            (stream, text) => {
              ctx.log(text, stream);
            },
            ctx.signal
          )
      );
    }
  );

  ipcMain.handle(
    IPC.nodesInstallGit,
    async (
      _e,
      url: string,
      dirName?: string,
      root?: string
    ): Promise<OpResult<InstallResult>> => {
      const target = pickRoot(root);

      return await runOp(
        "node-install",
        `从 Git 安装 ${url}`,
        async (ctx) =>
          await installFromGit(
            target,
            url,
            dirName,
            (stream, text) => {
              ctx.log(text, stream);
            },
            ctx.signal
          )
      );
    }
  );

  ipcMain.handle(
    IPC.nodesUpdate,
    async (_e, dirName: string, root?: string): Promise<OpResult<null>> => {
      assertSafeDirName(dirName);
      const target = pickRoot(root);

      return await runOp("node-update", `更新插件 ${dirName}`, async (ctx) => {
        await updateNode(
          target,
          dirName,
          (stream, text) => {
            ctx.log(text, stream);
          },
          ctx.signal
        );

        return null;
      });
    }
  );

  ipcMain.handle(
    IPC.nodesUpdateAll,
    async (_e, root?: string): Promise<OpResult<NodeBulkUpdateResult>> => {
      const target = pickRoot(root);

      return await runOp("node-update-all", "批量更新插件", async (ctx) => {
        const result = await updateAllNodes(
          target,
          (stream, text) => {
            ctx.log(text, stream);
          },
          ctx.signal
        );

        // 有失败就让任务失败：返回 ok 会在任务中心打「完成」，把失败说成成功
        const failure = bulkUpdateError(result);

        if (failure !== null) {
          throw new Error(failure);
        }

        return result;
      });
    }
  );

  ipcMain.handle(
    IPC.nodesUninstall,
    async (_e, dirName: string, root?: string): Promise<OpResult<null>> => {
      assertSafeDirName(dirName);
      const target = pickRoot(root);

      return await runOp(
        "node-uninstall",
        `卸载插件 ${dirName}`,
        async (ctx) => {
          await uninstallNode(target, dirName, (stream, text) => {
            ctx.log(text, stream);
          });

          return null;
        }
      );
    }
  );

  ipcMain.handle(
    IPC.nodesInstallDeps,
    async (_e, dirName: string, root?: string): Promise<OpResult<null>> => {
      assertSafeDirName(dirName);
      const target = pickRoot(root);

      return await runOp("node-deps", `安装依赖 ${dirName}`, async (ctx) => {
        await installNodeDeps(
          target,
          dirName,
          (stream, text) => {
            ctx.log(text, stream);
          },
          ctx.signal
        );

        return null;
      });
    }
  );

  /* ---- 依赖查看 / 版本切换（都只在插件目录里读，checkout 才写） ---- */

  ipcMain.handle(
    IPC.nodesDepsDetail,
    async (_e, dirName: string, root?: string): Promise<NodeDepsDetail> => {
      assertSafeDirName(dirName);

      return await nodeDepsDetail(pickRoot(root), dirName);
    }
  );

  ipcMain.handle(
    IPC.nodesReleases,
    async (
      _e,
      dirName: string,
      root?: string,
      fetch?: boolean
    ): Promise<NodeReleases> => {
      assertSafeDirName(dirName);

      return await nodeReleases(pickRoot(root), dirName, Boolean(fetch));
    }
  );

  ipcMain.handle(
    IPC.nodesReinstallAllDeps,
    async (_e, root?: string): Promise<OpResult<string[]>> => {
      const target = pickRoot(root);

      return await runOp(
        "node-deps-all",
        "重装所有插件依赖",
        async (ctx) =>
          await reinstallAllNodeDeps(
            target,
            (stream, text) => {
              ctx.log(text, stream);
            },
            ctx.signal
          )
      );
    }
  );

  ipcMain.handle(
    IPC.nodesDepInstall,
    async (
      _e,
      dirName: string,
      spec: string,
      root?: string
    ): Promise<OpResult<null>> => {
      assertSafeDirName(dirName);
      const target = pickRoot(root);

      return await runOp(
        "node-dep-install",
        `安装依赖 ${spec}`,
        async (ctx) => {
          await installOneNodeDep(
            target,
            dirName,
            spec,
            (stream, text) => {
              ctx.log(text, stream);
            },
            ctx.signal
          );

          return null;
        }
      );
    }
  );

  ipcMain.handle(
    IPC.nodesCheckout,
    async (
      _e,
      dirName: string,
      ref: string,
      root?: string
    ): Promise<OpResult<null>> => {
      assertSafeDirName(dirName);
      const target = pickRoot(root);

      return await runOp(
        "node-checkout",
        `切换插件版本 ${dirName}`,
        async (ctx) => {
          ctx.log(`[插件] 切换到 ${ref}`);
          await checkoutNode(target, dirName, ref);
          ctx.log(`[插件] ${dirName} 已切到 ${ref}，重启 ComfyUI 后生效。`);

          return null;
        }
      );
    }
  );
}
