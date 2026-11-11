import assert from "node:assert/strict";
import { join } from "node:path";

import { describe, it } from "vitest";

import { nodeDirForEnabled } from "./nodeScan";

/*
 * ComfyUI 的禁用约定是「目录名加 .disabled 后缀」，插件的逻辑名始终不带后缀。
 * 这里的期望值直接来自这条约定，而不是从实现反推：
 * 启用后目录必须叫 ComfyUI-GGUF，禁用后必须叫 ComfyUI-GGUF.disabled。
 */
describe(nodeDirForEnabled, () => {
  const customNodesDir = "D:\\ComfyUI-Main\\custom_nodes";
  const baseName = "ComfyUI-GGUF";

  it("启用禁用中的插件：目标去掉 .disabled，不能原地撞上旧目录", () => {
    assert.equal(
      nodeDirForEnabled(customNodesDir, baseName, true),
      join(customNodesDir, "ComfyUI-GGUF")
    );
  });

  it("禁用已启用的插件：目标补上 .disabled", () => {
    assert.equal(
      nodeDirForEnabled(customNodesDir, baseName, false),
      join(customNodesDir, "ComfyUI-GGUF.disabled")
    );
  });

  it("启用目标永远不带 .disabled 后缀", () => {
    assert.ok(
      !nodeDirForEnabled(customNodesDir, baseName, true).endsWith(".disabled")
    );
  });
});
