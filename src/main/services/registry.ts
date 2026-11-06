import { session } from 'electron'
import type { RegistryNode, RegistrySearchResult } from '@shared/types'
import { filterByName, paginate } from './registryPlan.mjs'

/* ══════════════════════════════════════════════════════════
 * ComfyUI Registry 客户端
 *
 * 数据源：https://api.comfy.org（依据官方 openapi 规范实测确定）
 *   GET /nodes/search?search=<q>&page=<n>&limit=<m>   ← 真正支持关键字过滤
 *   GET /nodes/<id>
 *
 * 踩坑记录：`/nodes?search=` 会忽略所有查询参数、恒定返回同一页，
 * 看起来「有结果」但其实是默认列表。必须用 /nodes/search。
 *
 * 另一个坑：/nodes/search 是「全文匹配」（名称 + 描述 + 标签）。
 * 搜 MD 会带回一堆描述里出现 md 的无关插件，所以这里只把服务端当检索器用，
 * 拿到结果后再按名称/仓库名筛一遍，并由我们自己分页——这才是用户要的「搜插件名」。
 *
 * 网络走 Electron session.fetch，自动继承系统代理。
 * ══════════════════════════════════════════════════════════ */

const API = 'https://api.comfy.org'
const SEARCH_TTL_MS = 5 * 60 * 1000
/** 单次向 Registry 要多少条。实测 limit=100 可用，"MD" 的 54 条全文命中一次就拿完 */
const SERVER_PAGE_SIZE = 100
/** 名称过滤会砍掉大量全文命中；最多往前翻 3 页，避免大关键字把请求拖长 */
const MAX_SCAN_PAGES = 3

interface RawNodeVersion {
  version?: string
  dependencies?: string[] | null
  deprecated?: boolean | null
  supported_comfyui_version?: string | null
}

interface RawNode {
  id?: string
  name?: string
  description?: string | null
  author?: string | null
  repository?: string | null
  downloads?: number | null
  github_stars?: number | null
  rating?: number | null
  icon?: string | null
  tags?: string[] | null
  category?: string | null
  publisher?: { id?: string; name?: string } | null
  latest_version?: RawNodeVersion | null
  status?: string | null
}

interface RawSearch {
  nodes?: RawNode[]
  total?: number
  page?: number
  limit?: number
  totalPages?: number
}

/** 热门列表（空关键字）按页缓存 */
const hotCache = new Map<string, { at: number; data: RegistrySearchResult }>()
/** 关键字搜索缓存过滤后的完整结果，翻页不再打网络 */
const nameCache = new Map<string, { at: number; nodes: RegistryNode[]; scanned: number; sourceTotal: number }>()

function normalize(raw: RawNode): RegistryNode {
  const lv = raw.latest_version ?? null
  const deps = Array.isArray(lv?.dependencies) ? lv!.dependencies!.filter(Boolean) : []
  return {
    id: raw.id ?? '',
    name: raw.name ?? raw.id ?? '(未命名)',
    description: raw.description?.trim() || null,
    author: raw.publisher?.name || raw.author?.trim() || null,
    repository: raw.repository?.trim() || null,
    latestVersion: lv?.version ?? null,
    downloads: typeof raw.downloads === 'number' ? raw.downloads : null,
    githubStars: typeof raw.github_stars === 'number' ? raw.github_stars : null,
    rating: typeof raw.rating === 'number' ? raw.rating : null,
    icon: raw.icon?.trim() || null,
    tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [],
    category: raw.category?.trim() || null,
    publisher: raw.publisher?.name ?? null,
    dependencies: deps,
    supportedComfyuiVersion: lv?.supported_comfyui_version?.trim() || null,
    deprecated: Boolean(lv?.deprecated)
  }
}

function readable(err: unknown): string {
  return `无法连接 ComfyUI Registry：${err instanceof Error ? err.message : String(err)}`
}

interface RawPage {
  nodes: RegistryNode[]
  total: number
  page: number
  totalPages: number
}

/** 原样请求 Registry 的一页（不做任何本地过滤） */
async function fetchPage(q: string, page: number, limit: number): Promise<RawPage> {
  const url = `${API}/nodes/search?search=${encodeURIComponent(q)}&page=${page}&limit=${limit}`
  const res = await session.defaultSession.fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'ExplorerLauncher/0.1.5' }
  })
  if (!res.ok) throw new Error(`Registry 返回 ${res.status} ${res.statusText}`)

  const json = (await res.json()) as RawSearch
  const nodes = (json.nodes ?? []).map(normalize).filter((n) => n.id.length > 0)
  const total = json.total ?? nodes.length
  return {
    nodes,
    total,
    page: json.page ?? page,
    totalPages: json.totalPages ?? Math.max(1, Math.ceil(total / limit))
  }
}

/**
 * 关键字搜索：先按 100 条一页抓取（最多 3 页），再按名称/仓库名过滤。
 * 返回过滤后的完整列表，交给调用方分页。
 */
async function collectByName(q: string): Promise<{
  nodes: RegistryNode[]
  scanned: number
  sourceTotal: number
}> {
  const collected: RegistryNode[] = []
  let scanned = 0
  let sourceTotal = 0

  for (let page = 1; page <= MAX_SCAN_PAGES; page++) {
    const res = await fetchPage(q, page, SERVER_PAGE_SIZE)
    sourceTotal = res.total
    scanned += res.nodes.length
    collected.push(...res.nodes)
    if (page >= res.totalPages || res.nodes.length === 0) break
  }

  // 分页抖动时同一条可能出现两次，按 id 去重
  const seen = new Set<string>()
  const unique: RegistryNode[] = []
  for (const node of collected) {
    if (seen.has(node.id)) continue
    seen.add(node.id)
    unique.push(node)
  }

  return { nodes: filterByName(unique, q), scanned, sourceTotal }
}

/** 空关键字：热门列表，保持原来的服务端分页 */
async function searchHot(page: number, limit: number): Promise<RegistrySearchResult> {
  const key = `hot|${page}|${limit}`
  const cached = hotCache.get(key)
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.data

  try {
    const res = await fetchPage('', page, limit)
    const data: RegistrySearchResult = {
      nodes: res.nodes,
      total: res.total,
      page: res.page,
      pageSize: limit,
      totalPages: res.totalPages,
      error: null
    }
    hotCache.set(key, { at: Date.now(), data })
    return data
  } catch (err) {
    return { nodes: [], total: 0, page, pageSize: limit, totalPages: 0, error: readable(err) }
  }
}

export async function searchRegistry(
  query: string,
  page = 1,
  limit = 24
): Promise<RegistrySearchResult> {
  const q = query.trim()
  if (!q) return searchHot(page, limit)

  const key = q.toLowerCase()
  let hit = nameCache.get(key)
  if (!hit || Date.now() - hit.at >= SEARCH_TTL_MS) {
    try {
      hit = { at: Date.now(), ...(await collectByName(q)) }
      nameCache.set(key, hit)
    } catch (err) {
      return {
        nodes: [],
        total: 0,
        page,
        pageSize: limit,
        totalPages: 0,
        error: readable(err)
      }
    }
  }

  const paged = paginate(hit.nodes, page, limit)
  return {
    nodes: paged.nodes,
    total: paged.total,
    page: paged.page,
    pageSize: paged.pageSize,
    totalPages: paged.totalPages,
    error: null,
    // 服务端全文命中数 vs 实际扫描数：UI 用来说清「为什么只剩这几个」
    sourceTotal: hit.sourceTotal,
    scanned: hit.scanned
  }
}

/** 按 id 在 registry 中定位插件（安装时用） */
export async function getRegistryNode(id: string): Promise<RegistryNode | null> {
  try {
    const res = await session.defaultSession.fetch(`${API}/nodes/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'ExplorerLauncher/0.1.5' }
    })
    if (!res.ok) return null
    const json = (await res.json()) as RawNode
    const node = normalize(json)
    return node.id ? node : null
  } catch {
    return null
  }
}
