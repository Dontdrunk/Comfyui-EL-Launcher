import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  MAX_MODEL_SHORTCUTS,
  normalizeModelShortcuts,
} from "./model-shortcuts.mjs";

describe(normalizeModelShortcuts, () => {
  it("不是数组时返回空列表", () => {
    assert.deepEqual(normalizeModelShortcuts(undefined), []);
    assert.deepEqual(normalizeModelShortcuts("D:\\models"), []);
    assert.deepEqual(normalizeModelShortcuts({ path: "D:\\models" }), []);
  });

  it("丢弃没有路径的条目，路径去空白", () => {
    assert.deepEqual(
      normalizeModelShortcuts([
        { path: "  D:\\models\\loras  ", name: " LoRA " },
        { name: "没有路径" },
        null,
        42,
        { path: "   " },
      ]),
      [{ path: "D:\\models\\loras", name: "LoRA" }]
    );
  });

  it("按路径去重（Windows 不区分大小写），保留第一次出现", () => {
    assert.deepEqual(
      normalizeModelShortcuts([
        { path: "D:\\Models\\LORA", name: "一" },
        { path: "d:\\models\\lora", name: "二" },
      ]),
      [{ path: "D:\\Models\\LORA", name: "一" }]
    );
  });

  it("名称限长，缺省名称留空串给界面兜底", () => {
    const [long] = normalizeModelShortcuts([
      { path: "D:\\a", name: "x".repeat(100) },
    ]);

    assert.equal(long?.name.length, 40);
    assert.equal(normalizeModelShortcuts([{ path: "D:\\a" }])[0]?.name, "");
  });

  it("保持输入顺序（拖拽排序直接落盘，不在规范化时重排）", () => {
    const input = [
      { path: "D:\\c", name: "C" },
      { path: "D:\\a", name: "A" },
      { path: "D:\\b", name: "B" },
    ];

    assert.deepEqual(
      normalizeModelShortcuts(input).map((shortcut) => shortcut.name),
      ["C", "A", "B"]
    );
  });

  it(`最多保留 ${MAX_MODEL_SHORTCUTS} 个`, () => {
    const input = Array.from({ length: 20 }, (_, i) => ({
      path: `D:\\m${i}`,
      name: "",
    }));

    assert.equal(normalizeModelShortcuts(input).length, MAX_MODEL_SHORTCUTS);
  });
});
