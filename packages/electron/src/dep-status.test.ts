import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { depDot, depVisualTone } from "./dep-status.mjs";

describe("depStatus", () => {
  /** 圆点可能是 null（不显示），测试里只关心「有圆点」的场景 */
  const dotOf = (...args: Parameters<typeof depDot>) => {
    const value = depDot(...args);
    assert.ok(value);
    return value;
  };

  it("没有 requirements.txt 的插件也算就绪：绿灯 + 可运行提示", () => {
    const dot = dotOf(false, null);
    assert.equal(dot.tone, "ok");
    assert.match(dot.hint, /可直接运行/);
    assert.equal(dotOf(false, { total: 0, missing: 0 }).tone, "ok");
  });

  it("还没拿到检查结果时是灰色（检查中）", () => {
    assert.equal(dotOf(true, null).tone, "idle");
    assert.match(dotOf(true, null).hint, /正在检查/);
  });

  it("检查失败是灰色，并把错误带进提示", () => {
    const dot = dotOf(true, { total: 3, missing: 3, error: "python 起不来" });
    assert.equal(dot.tone, "idle");
    assert.match(dot.hint, /python 起不来/);
  });

  it("全部装好 = 绿", () => {
    const dot = dotOf(true, { total: 3, missing: 0 });
    assert.equal(dot.tone, "ok");
    assert.match(dot.hint, /3\/3/);
  });

  it("部分缺失 = 黄", () => {
    const dot = dotOf(true, { total: 5, missing: 2 });
    assert.equal(dot.tone, "warn");
    assert.match(dot.hint, /缺少 2/);
  });

  it("一个都没装上 = 红", () => {
    const dot = dotOf(true, { total: 3, missing: 3 });
    assert.equal(dot.tone, "error");
    assert.match(dot.hint, /全部缺失/);
  });

  it("声明了依赖但 requirements 为空时也算就绪", () => {
    assert.equal(dotOf(true, { total: 0, missing: 0 }).tone, "ok");
  });

  it("边界：缺 1 个也算黄，不是红", () => {
    assert.equal(dotOf(true, { total: 1, missing: 1 }).tone, "error");
    assert.equal(dotOf(true, { total: 2, missing: 1 }).tone, "warn");
  });
  /* ── 指示器视觉状态 ── */

  it("视觉状态：没声明依赖是 ok，未检查是 busy", () => {
    assert.equal(depVisualTone(false, null), "ok");
    assert.equal(depVisualTone(true, null), "busy");
  });

  it("视觉状态：检查失败退回 none（不再转圈）", () => {
    assert.equal(
      depVisualTone(true, { total: 3, missing: 3, error: "boom" }),
      "none"
    );
  });

  it("视觉状态：绿黄红三档", () => {
    assert.equal(depVisualTone(true, { total: 3, missing: 0 }), "ok");
    assert.equal(depVisualTone(true, { total: 5, missing: 2 }), "warn");
    assert.equal(depVisualTone(true, { total: 3, missing: 3 }), "error");
    assert.equal(depVisualTone(true, { total: 2, missing: 1 }), "warn");
  });

  it("视觉状态：声明了但 requirements 为空 → ok", () => {
    assert.equal(depVisualTone(true, { total: 0, missing: 0 }), "ok");
  });
});
