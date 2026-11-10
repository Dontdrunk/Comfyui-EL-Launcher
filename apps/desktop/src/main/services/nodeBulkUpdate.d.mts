/** 批量更新结果里本函数用到的字段；与 NodeBulkUpdateResult 同形，这里自持避免 .d.mts 跨文件引用 */
export interface BulkUpdateResultLike {
  updated: string[];
  failed: { dirName: string; error: string }[];
}

/**
 * 批量更新的失败文案；没有失败时返回 null（任务照常算成功）。
 * 全部失败与部分成功用不同口径，避免 0 个成功被读成「已是最新」。
 */
export function bulkUpdateError(result: BulkUpdateResultLike): string | null;
