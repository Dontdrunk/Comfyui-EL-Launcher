import { session } from 'electron'
import type { RegistryNode, RegistrySearchResult } from '@shared/types'

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
 * 网络走 Electron session.fetch，自动继承系统代理。
 * ══════════════════════════════════════════════════════════ */

const API = 'https://api.comfy.org'
const SEARCH_TTL_MS = 5 * 60 * 1000

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

/** 内存缓存：同一关键字短时间内重复搜索不再打网络 */
const searchCache = new Map<string, { at: number; data: RegistrySearchResult }>()

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

export async function searchRegistry(
  query: string,
  page = 1,
  limit = 24
): Promise<RegistrySearchResult> {
  const q = query.trim()
  const key = `${q}|${page}|${limit}`

  const cached = searchCache.get(key)
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) {
    return cached.data
  }

  const empty: RegistrySearchResult = {
    nodes: [],
    total: 0,
    page,
    pageSize: limit,
    totalPages: 0,
    error: null
  }

  try {
    const url = `${API}/nodes/search?search=${encodeURIComponent(q)}&page=${page}&limit=${limit}`
    const res = await session.defaultSession.fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'ExplorerLauncher/0.1.0' }
    })

    if (!res.ok) {
      return { ...empty, error: `Registry 返回 ${res.status} ${res.statusText}` }
    }

    const json = (await res.json()) as RawSearch
    const nodes = (json.nodes ?? []).map(normalize).filter((n) => n.id.length > 0)
    const total = json.total ?? nodes.length
    const data: RegistrySearchResult = {
      nodes,
      total,
      page: json.page ?? page,
      pageSize: json.limit ?? limit,
      totalPages: json.totalPages ?? Math.max(1, Math.ceil(total / limit)),
      error: null
    }
    searchCache.set(key, { at: Date.now(), data })
    return data
  } catch (err) {
    return {
      ...empty,
      error: `无法连接 ComfyUI Registry：${err instanceof Error ? err.message : String(err)}`
    }
  }
}

/** 按 id 在 registry 中定位插件（安装时用） */
export async function getRegistryNode(id: string): Promise<RegistryNode | null> {
  try {
    const res = await session.defaultSession.fetch(`${API}/nodes/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'ExplorerLauncher/0.1.0' }
    })
    if (!res.ok) return null
    const json = (await res.json()) as RawNode
    const node = normalize(json)
    return node.id ? node : null
  } catch {
    return null
  }
}

