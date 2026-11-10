import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * electron-builder 包装器。
 *
 * 三件事必须在这里做，否则发版会出错：
 *  1. 剔除 ELECTRON_RUN_AS_NODE：宿主环境带着它，electron 会退化成 Node，
 *     打包出的应用第一次启动就报错。
 *  2. 指定 electron-builder 二进制的国内镜像（NSIS / winCodeSign），
 *     否则从 GitHub 拉取会很慢甚至失败。
 *  3. electron-builder 写出的 latest.yml 只列安装版；便携版也要写进去，
 *     不然便携版用户点更新找不到文件。
 */
const require = createRequire(import.meta.url);
const appDir = path.join(import.meta.dirname, "..");
const releaseDir = path.join(appDir, "release");
const cliPath = require.resolve("electron-builder/out/cli/cli.js");

const mirror =
  "https://registry.npmmirror.com/-/binary/electron-builder-binaries/";

const versionPattern = /^version:\s*(?<version>\S+)/mu;

const env: Record<string, string> = {};

for (const [key, value] of Object.entries(process.env)) {
  if (value === undefined) {
    continue;
  }

  if (key === "ELECTRON_RUN_AS_NODE" || key === "ELECTRON_NO_ATTACH_CONSOLE") {
    continue;
  }

  env[key] = value;
}

env.ELECTRON_BUILDER_BINARIES_MIRROR ??= mirror;

const versionOf = (text: string) => versionPattern.exec(text)?.groups?.version;

const includePortable = async () => {
  const ymlFile = path.join(releaseDir, "latest.yml");
  const text = await readFile(ymlFile, "utf-8");
  const version = versionOf(text);

  if (version === undefined) {
    throw new Error(`latest.yml has no version: ${ymlFile}`);
  }

  const portable = `ExplorerLauncher-${version}-portable.exe`;

  if (text.includes(`url: ${portable}`)) {
    return;
  }

  const file = path.join(releaseDir, portable);

  const sha512 = createHash("sha512")
    .update(await readFile(file))
    .digest("base64");

  const { size } = await stat(file);
  const entry = `  - url: ${portable}\n    sha512: ${sha512}\n    size: ${size}\n`;

  await writeFile(ymlFile, text.replace(/^path:/mu, `${entry}path:`));
  process.stdout.write(`[package] latest.yml now lists ${portable}\n`);
};

const result = spawnSync(
  process.execPath,
  [cliPath, "--win", "--x64", "--publish", "never"],
  { cwd: appDir, env, stdio: "inherit" }
);

if (result.error !== undefined) {
  throw result.error;
}

if (result.status === 0) {
  await includePortable();
} else {
  process.stderr.write(
    `[package] electron-builder exited with ${String(result.status)}\n`
  );
  process.exitCode = result.status ?? 1;
}
