/**
 * git 远端地址 → 浏览器里能打开的网页地址。
 *
 * remote 来自 `git remote get-url origin`，可能是 https、ssh://，也可能是
 * scp 风格的 git@host:owner/repo.git。系统浏览器只认 http(s)，其余协议（file://、
 * 本地路径）返回 null，由界面决定不可点。
 */
const SCP_LIKE = /^[\w.-]+@(?<host>[\w.-]+):(?<path>.+)$/u;
const SSH_LIKE = /^ssh:\/\/(?:[\w.-]+@)?(?<host>[\w.-]+)\/(?<path>.+)$/u;
const GIT_PROTOCOL = /^git:\/\/(?:[\w.-]+@)?(?<host>[\w.-]+)\/(?<path>.+)$/u;
const WEB_LIKE = /^https?:\/\//iu;
const GITHUB_PREFIX = /^https?:\/\/(?:www\.)?github\.com\//iu;

const dropGitSuffix = (url: string): string =>
  url.replace(/\.git$/iu, "").replace(/\/+$/u, "");

const fromMatch = (match: RegExpExecArray): string | null => {
  const host = match.groups?.host;
  const path = match.groups?.path;

  if (host === undefined || path === undefined) {
    return null;
  }

  return dropGitSuffix(`https://${host}/${path}`);
};

export const remoteWebUrl = (
  remote: string | null | undefined
): string | null => {
  if (remote === null || remote === undefined) {
    return null;
  }

  const value = remote.trim();

  if (value.length === 0) {
    return null;
  }

  const scp = SCP_LIKE.exec(value);

  if (scp) {
    return fromMatch(scp);
  }

  const ssh = SSH_LIKE.exec(value) ?? GIT_PROTOCOL.exec(value);

  if (ssh) {
    return fromMatch(ssh);
  }

  return WEB_LIKE.test(value) ? dropGitSuffix(value) : null;
};

/**
 * 表格里的显示名：GitHub 只留 owner/repo（这一列本来就窄），
 * 其他主机的地址原样保留，方便看出代码托管在哪。
 */
export const remoteLabel = (remote: string): string =>
  dropGitSuffix(remoteWebUrl(remote) ?? remote).replace(GITHUB_PREFIX, "");
