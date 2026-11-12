import { createHash } from "node:crypto";

import { compareSemverDesc, parseSemver } from "./semver.mjs";

const ASSET_NAME = /^ExplorerLauncher-\d+\.\d+\.\d+-(setup|portable)\.exe$/;

/**
 * @param {string} text electron-builder 生成的 latest.yml
 * @returns {{ version: string, files: { url: string, sha512: string, size: number }[] } | null}
 */
export function parseLatestYml(text) {
  const version = /^version:\s*['"]?([^'"\s#]+)['"]?\s*$/m.exec(text)?.[1];

  if (!version) {
    return null;
  }

  /** @type {{ url: string, sha512: string, size: number }[]} */
  const files = [];
  /** @type {{ url?: string, sha512?: string, size?: number } | null} */
  let cur = null;

  const flush = () => {
    if (cur?.url && cur.sha512 && typeof cur.size === "number") {
      files.push({ url: cur.url, sha512: cur.sha512, size: cur.size });
    }

    cur = null;
  };

  for (const line of text.split(/\r?\n/)) {
    const url = /^\s*-\s*url:\s*['"]?(.+?)['"]?\s*$/.exec(line);

    if (url) {
      flush();
      cur = { url: url[1] };
      continue;
    }

    if (!cur) {
      continue;
    }
    const sha = /^\s+sha512:\s*['"]?([A-Za-z0-9+/=]+)['"]?\s*$/.exec(line);

    if (sha) {
      cur.sha512 = sha[1];
    }
    const size = /^\s+size:\s*(\d+)\s*$/.exec(line);

    if (size) {
      cur.size = Number(size[1]);
    }
  }

  flush();

  if (files.length === 0) {
    return null;
  }
  return { version, files };
}

/** 远端版本号更高才返回 true。任一端不是 x.y.z 都算不能更新。 */
export function isNewer(current, remote) {
  if (!parseSemver(current) || !parseSemver(remote)) {
    return false;
  }
  return compareSemverDesc(current, remote) > 0;
}

/**
 * @param {{ url: string, sha512: string, size: number }[]} files
 * @param {boolean} portable
 */
export function pickFile(files, portable) {
  const suffix = portable ? "-portable.exe" : "-setup.exe";

  return files.find((f) => fileNameOf(f.url).endsWith(suffix)) ?? null;
}

/** @param {string} url */
export function fileNameOf(url) {
  const name = decodeURIComponent(
    (url.split("/").pop() ?? "").split("?")[0] ?? ""
  );

  return name;
}

/** @param {string} name */
export function isLauncherAsset(name) {
  return ASSET_NAME.test(name);
}

/** electron-builder latest.yml 里的 sha512 是原始摘要的 base64，不是 hex。 */
export function sha512Base64(data) {
  return createHash("sha512").update(data).digest("base64");
}
/**
 * 下载速度计量：只保留最近 windowMs 的采样，算的是「当下」的速率，
 * 不会被开头几十秒的慢连接拖低，暂停后旧采样也会自然过期。
 */
export function createSpeedMeter(windowMs = 1000) {
  /** @type {{ bytes: number, at: number }[]} */
  let samples = [];

  return {
    /**
     * @param {number} bytes 累计已下载字节
     * @param {number} at 采样时刻（毫秒）
     */
    sample(bytes, at) {
      samples.push({ bytes, at });
      const cutoff = at - windowMs;

      samples = samples.filter((s) => s.at >= cutoff);
      if (samples.length > 32) {
        samples = samples.slice(-32);
      }
    },

    /**
     * @returns {number | null} 字节/秒；不足两个有效采样时返回 null
     */
    rate() {
      const first = samples[0];
      const last = samples.at(-1);

      if (!first || !last || samples.length < 2) {
        return null;
      }
      const elapsed = last.at - first.at;

      if (elapsed <= 0) {
        return null;
      }
      return Math.max(0, ((last.bytes - first.bytes) / elapsed) * 1000);
    },
  };
}
