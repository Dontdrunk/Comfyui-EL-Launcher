/**
 * Registry 搜索的纯逻辑：只按「插件名 / id」匹配，再做本地分页。
 *
 * 为什么需要它：api.comfy.org 的 /nodes/search 是全文匹配（名称 + 描述 + 标签），
 * 搜 "MD" 会把描述里出现 md 的无关插件一起带回来。产品要的是「搜名字」，
 * 所以抓回来之后自己筛、自己分页。这里不碰网络，方便单测。
 */

/** 名称或 id 含关键字就算命中（不区分大小写） */
export function hitsName(node, query) {
  const q = String(query ?? "")
    .trim()
    .toLowerCase();

  if (!q) {
    return true;
  }
  const name = String(node?.name ?? "").toLowerCase();
  const id = String(node?.id ?? "").toLowerCase();

  return name.includes(q) || id.includes(q);
}

/** 按名称过滤，保持原有顺序 */
export function filterByName(nodes, query) {
  const list = Array.isArray(nodes) ? nodes : [];
  const q = String(query ?? "").trim();

  if (!q) {
    return list.slice();
  }
  return list.filter((n) => hitsName(n, q));
}

/**
 * 本地分页。页码越界时夹回 [1, totalPages]，避免翻到空页。
 * total 返回的是过滤后的条数，不是 Registry 的全文命中数。
 */
export function paginate(nodes, page = 1, limit = 24) {
  const list = Array.isArray(nodes) ? nodes : [];
  const size = Math.max(1, Math.floor(Number(limit)) || 1);
  const totalPages = Math.max(1, Math.ceil(list.length / size));

  const current = Math.min(
    Math.max(1, Math.floor(Number(page)) || 1),
    totalPages
  );

  const start = (current - 1) * size;

  return {
    nodes: list.slice(start, start + size),
    total: list.length,
    page: current,
    pageSize: size,
    totalPages,
  };
}
