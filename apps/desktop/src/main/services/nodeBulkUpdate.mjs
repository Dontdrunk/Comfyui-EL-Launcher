/**
 * 「一键更新」失败时的任务错误文案。
 *
 * 成功与失败必须分开数：早先批量更新只返回成功列表，全部失败时列表为空，
 * 界面把 0 个成功当成「所有插件都已是最新」，任务中心还打「完成」。
 * 只要有失败，批量更新就算失败；文案里同时给出成功数与失败插件名。
 */
export function bulkUpdateError(result) {
  const updated = Array.isArray(result?.updated) ? result.updated : [];
  const failed = Array.isArray(result?.failed) ? result.failed : [];

  if (failed.length === 0) {
    return null;
  }

  const names = failed
    .map((entry) => entry?.dirName)
    .filter(Boolean)
    .join("、");
  /* 只取第一行：git 的 stderr 后面跟着 hint 噪声，完整内容在控制台的失败日志里 */
  const reason =
    (failed[0]?.error ?? "未知原因").split(/\r?\n/u, 1)[0] ?? "未知原因";

  if (updated.length === 0) {
    return `全部 ${failed.length} 个插件更新失败：${reason}`;
  }

  return `已更新 ${updated.length} 个，${failed.length} 个失败（${names}）：${reason}`;
}
