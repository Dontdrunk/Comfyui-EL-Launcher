import assert from "node:assert/strict";
import { join } from "node:path";

import { describe, it } from "vitest";

import {
  installedSourceVersion,
  nodeDirForEnabled,
  parseRequirement,
  sourceLabel,
} from "./nodeScan";

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

/*
 * 期望值来自上游真实的 requirements.txt（ComfyUI-Impact-Pack 第 10 行就是
 * `git+https://github.com/facebookresearch/sam2`）与 pip 的 PEP 508 / PEP 610 语义。
 */
describe(parseRequirement, () => {
  it("git 直接引用是源码依赖，不能当包名叫 git", () => {
    const entry = parseRequirement(
      "git+https://github.com/facebookresearch/sam2"
    );

    assert.equal(entry.kind, "source");
    assert.equal(entry.name, "");
    assert.equal(entry.install, "git+https://github.com/facebookresearch/sam2");
  });

  it("普通包拆成 名称/约束/完整规格，行尾注释不进规格", () => {
    const entry = parseRequirement("pillow>=11.0.0  # 注释");

    assert.equal(entry.kind, "package");
    assert.equal(entry.name, "pillow");
    assert.equal(entry.spec, ">=11.0.0");
    assert.equal(entry.install, "pillow>=11.0.0");
  });

  it("extras 保留在安装规格里", () => {
    const entry = parseRequirement("onnxruntime[gpu]>=1.17");

    assert.equal(entry.name, "onnxruntime");
    assert.equal(entry.spec, ">=1.17");
    assert.equal(entry.install, "onnxruntime[gpu]>=1.17");
  });

  it("环境标记不进安装规格", () => {
    const entry = parseRequirement("torch>=2.0 ; python_version>'3.8'");

    assert.equal(entry.install, "torch>=2.0");
  });
});

describe(sourceLabel, () => {
  it("取地址最后两段做展示名", () => {
    assert.equal(
      sourceLabel("git+https://github.com/facebookresearch/sam2.git"),
      "facebookresearch/sam2"
    );
  });
});

describe(installedSourceVersion, () => {
  const repo = "https://github.com/facebookresearch/sam2";

  it("direct_url.json 里的地址对得上就算装了", () => {
    assert.equal(
      installedSourceVersion(repo, {
        versions: {},
        directUrls: { "https://github.com/facebookresearch/sam2": "1.0" },
      }),
      "1.0"
    );
  });

  it("声明里带 @分支 也能对上（pip 记录的是仓库地址）", () => {
    assert.equal(
      installedSourceVersion(
        "git+https://github.com/facebookresearch/sam2@main",
        {
          versions: {},
          directUrls: { "https://github.com/facebookresearch/sam2": "1.0" },
        }
      ),
      "1.0"
    );
  });

  it("大小写、.git 后缀、结尾斜杠不影响比对", () => {
    assert.equal(
      installedSourceVersion(repo, {
        versions: {},
        directUrls: { "https://github.com/FacebookResearch/SAM2.git/": "1.0" },
      }),
      "1.0"
    );
  });

  it("从本地目录装源码包时按发行包名兜底", () => {
    assert.equal(
      installedSourceVersion(repo, {
        versions: { "sam-2": "1.0" },
        directUrls: { "file:///D:/sam2-src": "1.0" },
      }),
      "1.0"
    );
  });

  it("相对路径的源码依赖按包名兜底", () => {
    assert.equal(
      installedSourceVersion("./sam2", {
        versions: { "sam-2": "1.0" },
        directUrls: {},
      }),
      "1.0"
    );
  });

  it("没装就是 null", () => {
    assert.equal(
      installedSourceVersion(repo, {
        versions: { numpy: "2.3.2" },
        directUrls: {},
      }),
      null
    );
  });
});
