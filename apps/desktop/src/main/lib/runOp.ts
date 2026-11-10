import type { OpResult } from "@explorer-launcher/electron";

import { jobManager } from "../services/jobs";
import type { JobContext } from "../services/jobs";

/**
 * 把一个带日志流的长操作包成任务，并同时返回 jobId 与结果。
 *
 * holder.id 之所以可靠：jobManager.run 的同步段内就会创建任务并调用 fn，
 * 因此即使 fn 抛错，holder.id 也已经拿到了。
 */
export async function runOp<T>(
  kind: string,
  title: string,
  fn: (ctx: JobContext) => Promise<T>
): Promise<OpResult<T>> {
  const holder = { id: "" };

  try {
    const value = await jobManager.run(kind, title, async (ctx) => {
      holder.id = ctx.id;

      return await fn(ctx);
    });

    return { ok: true, jobId: holder.id, value };
  } catch (error) {
    return {
      ok: false,
      jobId: holder.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
