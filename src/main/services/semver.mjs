/** "v0.40.0" → [0,40,0]；非法返回 null */
export function parseSemver(name) {
  const m = String(name).match(/^v?(\d+)\.(\d+)(?:\.(\d+))?$/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]
}

/** 降序：b 比 a 新时返回正数。给 Array.sort 和「远端是否更新」共用。 */
export function compareSemverDesc(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (pa && pb) {
    for (let i = 0; i < 3; i++) {
      if (pa[i] !== pb[i]) return pb[i] - pa[i]
    }
    return 0
  }
  if (pa) return -1
  if (pb) return 1
  return String(b).localeCompare(String(a))
}
