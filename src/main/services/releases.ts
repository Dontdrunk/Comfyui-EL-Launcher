import { app, session } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ReleaseInfo, UpdateCheck } from '@shared/types'
import { readAppVersion } from './env'
import { resolveComfyPaths } from '../lib/paths'
import { compareSemverDesc, parseSemver } from './version'

/* ══════════════════════════════════════════════════════════
 * 检查更新（GitHub Releases）
 *
 * 网络走 Electron 的 session.fetch —— 它能自动使用系统代理；
 * 断网时退回本地缓存，不让一次抖动把更新日志整块抹掉。
 * ══════════════════════════════════════════════════════════ */

const REPO = 'Comfy-Org/ComfyUI'
const API = `https://api.github.com/repos/${REPO}/releases`
const CACHE_TTL_MS = 10 * 60 * 1000
// GitHub 单页上限就是 100。和 25 条相比请求次数、限额消耗完全一样，
// 但版本列表里能补上日期与说明的行数从 25 行变成 100 行。
const PER_PAGE = 100

interface DiskCache {
  fetchedAt: number
  releases: ReleaseInfo[]
}

let memoryCache: DiskCache | null = null

function cacheFile(): string {
  return join(app.getPath('userData'), 'cache', 'releases.json')
}

async function readDiskCache(): Promise<DiskCache | null> {
  if (memoryCache) return memoryCache
  try {
    const raw = await readFile(cacheFile(), 'utf-8')
    const parsed = JSON.parse(raw) as DiskCache
    if (Array.isArray(parsed.releases)) {
      memoryCache = parsed
      return parsed
    }
  } catch {
    /* 无缓存 */
  }
  return null
}

async function writeDiskCache(data: DiskCache): Promise<void> {
  memoryCache = data
  try {
    const file = cacheFile()
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(data, null, 2), 'utf-8')
  } catch {
    /* 缓存写失败不影响主流程 */
  }
}

interface GitHubRelease {
  tag_name: string
  name: string | null
  published_at: string
  body: string | null
  html_url: string
  prerelease: boolean
  draft: boolean
}

function toReleaseInfo(r: GitHubRelease): ReleaseInfo {
  return {
    tag: r.tag_name,
    name: r.name ?? r.tag_name,
    publishedAt: r.published_at,
    body: (r.body ?? '').slice(0, 20_000),
    url: r.html_url,
    prerelease: r.prerelease
  }
}

/** Chromium 的 net::ERR_* 直接甩给用户没人看得懂，换成一句话（原始错误码留着便于排查） */
function readableFetchError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (!/net::ERR_/.test(raw)) return raw
  return `连不上 GitHub（${raw}）。稍后重试即可。`
}

async function fetchReleases(force: boolean): Promise<{ releases: ReleaseInfo[]; fromCache: boolean }> {
  const cached = await readDiskCache()
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { releases: cached.releases, fromCache: true }
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ExplorerLauncher/0.1.0',
    'X-GitHub-Api-Version': '2022-11-28'
  }

  const res = await session.defaultSession.fetch(`${API}?per_page=${PER_PAGE}`, { headers })

  if (!res.ok) {
    const remaining = res.headers.get('x-ratelimit-remaining')
    const resetAt = res.headers.get('x-ratelimit-reset')

    if ((res.status === 403 || res.status === 429) && remaining === '0') {
      const when = resetAt
        ? new Date(Number(resetAt) * 1000).toLocaleTimeString('zh-CN')
        : '稍后'
      const err = new Error(`GitHub API 限额已用尽（${when} 重置），稍后再试。`)
      if (cached) {
        // 有旧缓存时降级返回，但把错误附在调用方处理
        ;(err as Error & { fallback?: ReleaseInfo[] }).fallback = cached.releases
      }
      throw err
    }

    throw new Error(`GitHub API 返回 ${res.status} ${res.statusText}`)
  }

  const json = (await res.json()) as GitHubRelease[]
  const releases = json.filter((r) => !r.draft).map(toReleaseInfo)
  await writeDiskCache({ fetchedAt: Date.now(), releases })
  return { releases, fromCache: false }
}

/** 检查更新；force=true 时忽略缓存 */
export async function checkUpdate(root: string, force = false): Promise<UpdateCheck> {
  const paths = resolveComfyPaths(root)
  const current = await readAppVersion(paths.versionFile)

  const base: UpdateCheck = {
    current,
    latest: null,
    hasUpdate: false,
    release: null,
    releases: [],
    checkedAt: Date.now(),
    fromCache: false,
    error: null
  }

  try {
    const { releases, fromCache } = await fetchReleases(force)
    if (releases.length === 0) {
      return { ...base, error: '远端没有可用的 Release 记录。' }
    }

    // 取版本号最大的正式版（排除预发布）
    const stable = releases.filter((r) => !r.prerelease)
    const pool = stable.length > 0 ? stable : releases
    const latest = [...pool].sort((a, b) => compareSemverDesc(a.tag, b.tag))[0]

    const parse = (v: string | null): number[] | null => (v ? parseSemver(v) : null)
    const cur = parse(current)
    const lat = parse(latest.tag)
    const hasUpdate = Boolean(cur && lat && compareSemverDesc(latest.tag, `v${current}`) < 0)

    return {
      current,
      latest: latest.tag,
      hasUpdate,
      release: latest,
      releases: pool.slice(0, PER_PAGE),
      checkedAt: Date.now(),
      fromCache,
      error: null
    }
  } catch (err) {
    // 限额用尽时 fetchReleases 把缓存挂在错误上；其它失败（断网、连接被重置）同样退回缓存，
    // 否则一次网络抖动就会让「更新日志」整块消失，还甩给用户一个 net::ERR_*
    const cached =
      (err as Error & { fallback?: ReleaseInfo[] }).fallback ?? (await readDiskCache())?.releases
    if (cached && cached.length > 0) {
      const latest = cached[0]
      return {
        ...base,
        latest: latest.tag,
        release: latest,
        releases: cached,
        fromCache: true,
        error: `联网检查失败，显示缓存结果：${readableFetchError(err)}`
      }
    }
    return { ...base, error: readableFetchError(err) }
  }
}
