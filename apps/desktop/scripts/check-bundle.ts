import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * 打包产物自检：asar 里没有 node_modules，主进程与 preload 的 bundle
 * 只能引用 electron 和 node 内置模块。
 *
 * 漏打包的依赖在开发机上看不出来 —— 祖先目录的 node_modules 会替它兜底，
 * 装到用户机器上才变成 ERR_MODULE_NOT_FOUND。v0.1.7 的 zod 事故就是这样。
 */
const dist = path.join(import.meta.dirname, "../dist");

const files = [
  path.join(dist, "main", "index.js"),
  path.join(dist, "preload", "index.cjs"),
  path.join(dist, "preload", "tray-menu.cjs"),
];

const specifierPattern = /(?:from\s*|require\()\s*"(?<specifier>[^"]+)"/gu;

const isAllowed = (specifier: string) =>
  specifier === "electron" || specifier.startsWith("node:");

const problems: string[] = [];

const sources = await Promise.all(
  files.map(async (file) => ({ file, text: await readFile(file, "utf-8") }))
);

for (const { file, text } of sources) {
  for (const match of text.matchAll(specifierPattern)) {
    const specifier = match.groups?.specifier;

    if (specifier === undefined || isAllowed(specifier)) {
      continue;
    }

    problems.push(`${path.relative(dist, file)} imports "${specifier}"`);
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `[check-bundle] 打包产物引用了未打包的依赖：\n${problems
      .map((line) => `  - ${line}`)
      .join("\n")}\n` +
      "[check-bundle] 把依赖改成随包构建（ssr.noExternal），或从运行时依赖里去掉。\n"
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    "[check-bundle] 主进程与 preload 只引用 electron / node 内置模块\n"
  );
}
