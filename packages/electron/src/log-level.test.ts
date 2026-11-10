import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { classifyLogLevel } from "./log-level.mjs";

describe(classifyLogLevel, () => {
  it("方括号级别优先", () => {
    assert.equal(classifyLogLevel("[INFO] setup plugin alembic"), "info");
    assert.equal(classifyLogLevel("[DEBUG] load cache"), "debug");
    assert.equal(classifyLogLevel("[WARNING] forcing single GPU"), "warn");
    assert.equal(classifyLogLevel("[ERROR] failed to import"), "error");
    assert.equal(classifyLogLevel("[CRITICAL] boom"), "error");
  });

  it("文本前缀级别（pip / git / 通用）", () => {
    assert.equal(classifyLogLevel("INFO: ready"), "info");
    assert.equal(classifyLogLevel("WARNING: deprecated package"), "warn");
    assert.equal(classifyLogLevel("warning: LF will be replaced"), "warn");
    assert.equal(classifyLogLevel("ERROR: could not install"), "error");
    assert.equal(classifyLogLevel("error: pathspec did not match"), "error");
    assert.equal(classifyLogLevel("fatal: not a git repository"), "error");
  });

  it("没有级别特征的普通输出（包括 stderr）是 info", () => {
    assert.equal(
      classifyLogLevel("setup plugin alembic.autogenerate.schemas"),
      "info"
    );
    assert.equal(
      classifyLogLevel("Total VRAM 12282 MB, total RAM 32576 MB"),
      "info"
    );
    assert.equal(classifyLogLevel("Cloning into 'ComfyUI'..."), "info");
  });

  it("traceback 与续行都算错误", () => {
    assert.equal(
      classifyLogLevel("Traceback (most recent call last):"),
      "error"
    );
    assert.equal(
      classifyLogLevel('  File "D:\\ComfyUI\\main.py", line 4, in <module>'),
      "error"
    );
    assert.equal(classifyLogLevel("ValueError: bad value"), "error");
    assert.equal(
      classifyLogLevel(
        "During handling of the above exception, another exception occurred:"
      ),
      "error"
    );
    assert.equal(
      classifyLogLevel("!!! Exception during processing !!!"),
      "error"
    );
  });

  it("traceback 的缩进续行继承上一条的级别", () => {
    assert.equal(
      classifyLogLevel("  raise RuntimeError('x')", undefined, "error"),
      "error"
    );
    assert.equal(classifyLogLevel("  detail", undefined, "warn"), "warn");
    assert.equal(classifyLogLevel("  detail", undefined, "info"), "info");
  });

  it("启动器自己的任务/环境行", () => {
    assert.equal(classifyLogLevel("[任务] 开始：安装插件"), "info");
    assert.equal(classifyLogLevel("[任务] 完成：安装插件"), "success");
    assert.equal(classifyLogLevel("[任务] 已取消：安装插件"), "warn");
    assert.equal(classifyLogLevel("[任务] 失败：安装插件 — 网络错误"), "error");
    assert.equal(
      classifyLogLevel("[环境] 目录检查未通过：D:\\ComfyUI（2 个错误）"),
      "error"
    );
    assert.equal(
      classifyLogLevel("[启动器] 检测到服务地址：http://127.0.0.1:8188"),
      "info"
    );
  });

  it("显式级别优先于文本特征", () => {
    assert.equal(classifyLogLevel("[INFO] 只是提示", "error"), "error");
    assert.equal(classifyLogLevel("普通输出", "success"), "success");
  });
});
