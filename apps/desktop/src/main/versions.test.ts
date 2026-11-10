import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

const root = path.join(import.meta.dirname, "../../../..");

// package.json 是外部输入：先按 schema 解析，再取 version。
const manifestSchema = z.object({ version: z.string() });

const readVersion = async (...segments: string[]) => {
  const file = path.join(root, ...segments, "package.json");
  const raw: unknown = JSON.parse(await readFile(file, "utf-8"));

  return manifestSchema.parse(raw).version;
};

/**
 * 安装包版本取自本包，界面显示的版本取自 apps/web，仓库版本是两者的约定。
 * 分开写就出现过「安装包 0.0.0、界面 0.1.6」——发布后自更新直接失效，
 * 所以这里把三个 manifest 锁在一起，漂移会让门禁立即变红。
 */
describe("release manifests", () => {
  it("agree on one version across repo, renderer, and installer", async () => {
    const repo = await readVersion();

    expect({
      renderer: await readVersion("apps", "web"),
      installer: await readVersion("apps", "desktop"),
    }).toStrictEqual({ renderer: repo, installer: repo });
  });
});
