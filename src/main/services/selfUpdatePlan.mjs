import { createHash } from 'node:crypto'
import { compareSemverDesc, parseSemver } from './semver.mjs'

const ASSET_NAME = /^ExplorerLauncher-\d+\.\d+\.\d+-(setup|portable)\.exe$/

/**
 * @param {string} text electron-builder 生成的 latest.yml
 * @returns {{ version: string, files: { url: string, sha512: string, size: number }[] } | null}
 */
export function parseLatestYml(text) {
  const version = text.match(/^version:\s*['"]?([^'"\s#]+)['"]?\s*$/m)?.[1]
  if (!version) return null

  /** @type {{ url: string, sha512: string, size: number }[]} */
  const files = []
  /** @type {{ url?: string, sha512?: string, size?: number } | null} */
  let cur = null

  const flush = () => {
    if (cur?.url && cur.sha512 && typeof cur.size === 'number') {
      files.push({ url: cur.url, sha512: cur.sha512, size: cur.size })
    }
    cur = null
  }

  for (const line of text.split(/\r?\n/)) {
    const url = line.match(/^\s*-\s*url:\s*['"]?(.+?)['"]?\s*$/)
    if (url) {
      flush()
      cur = { url: url[1] }
      continue
    }
    if (!cur) continue
    const sha = line.match(/^\s+sha512:\s*['"]?([A-Za-z0-9+/=]+)['"]?\s*$/)
    if (sha) cur.sha512 = sha[1]
    const size = line.match(/^\s+size:\s*(\d+)\s*$/)
    if (size) cur.size = Number(size[1])
  }
  flush()
  if (files.length === 0) return null
  return { version, files }
}

/** 远端版本号更高才返回 true。任一端不是 x.y.z 都算不能更新。 */
export function isNewer(current, remote) {
  if (!parseSemver(current) || !parseSemver(remote)) return false
  return compareSemverDesc(current, remote) > 0
}

/**
 * @param {{ url: string, sha512: string, size: number }[]} files
 * @param {boolean} portable
 */
export function pickFile(files, portable) {
  const suffix = portable ? '-portable.exe' : '-setup.exe'
  return files.find((f) => fileNameOf(f.url).endsWith(suffix)) ?? null
}

/** @param {string} url */
export function fileNameOf(url) {
  const name = decodeURIComponent((url.split('/').pop() ?? '').split('?')[0] ?? '')
  return name
}

/** @param {string} name */
export function isLauncherAsset(name) {
  return ASSET_NAME.test(name)
}

/** electron-builder latest.yml 里的 sha512 是原始摘要的 base64，不是 hex。 */
export function sha512Base64(data) {
  return createHash('sha512').update(data).digest('base64')
}
