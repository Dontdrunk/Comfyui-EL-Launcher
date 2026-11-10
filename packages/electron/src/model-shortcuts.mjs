/**
 * 模型管理页快捷目录的规范化（纯逻辑，方便单测）。
 *
 * 设置里存的是用户添加过的目录卡片：只保留有路径的条目，
 * 按路径去重（Windows 路径不区分大小写），名称去空白并限长；
 * 名称留空时由界面用路径最后一段兜底。
 */

/** 快捷目录上限：再多会把模型列表挤没，也偏离「常去目录」的定位 */
export const MAX_MODEL_SHORTCUTS = 12;

const MAX_NAME_LENGTH = 40;

/**
 * @param {unknown} input
 * @returns {{ path: string, name: string }[]}
 */
export function normalizeModelShortcuts(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const out = [];
  const seen = new Set();

  for (const raw of input) {
    if (out.length >= MAX_MODEL_SHORTCUTS) {
      break;
    }
    if (!raw || typeof raw !== "object") {
      continue;
    }
    /** @type {{ path?: unknown, name?: unknown }} */
    const entry = raw;
    const path = typeof entry.path === "string" ? entry.path.trim() : "";

    if (!path) {
      continue;
    }
    const key = path.toLowerCase();

    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const name = typeof entry.name === "string" ? entry.name.trim() : "";

    out.push({ path, name: name.slice(0, MAX_NAME_LENGTH) });
  }

  return out;
}
