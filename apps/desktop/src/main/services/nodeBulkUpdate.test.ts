import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { bulkUpdateError } from "./nodeBulkUpdate.mjs";

describe(bulkUpdateError, () => {
  it("全部失败必须报失败，不能说成「所有插件都已是最新」", () => {
    const message = bulkUpdateError({
      updated: [],
      failed: [
        {
          dirName: "ComfyUI-MAINDodes",
          error: "git pull --ff-only 失败（退出码 128）",
        },
        {
          dirName: "ComfyUI-Manager",
          error: "git pull --ff-only 失败（退出码 128）",
        },
      ],
    });

    if (message === null) {
      throw new Error("全部失败时必须给出失败文案");
    }

    assert.match(message, /全部 2 个插件更新失败/u);
    assert.match(message, /退出码 128/u);
    assert.doesNotMatch(message, /最新|完成/u);
  });

  it("git 的多行 hint 不进口径，只保留第一行", () => {
    const message = bulkUpdateError({
      updated: [],
      failed: [
        {
          dirName: "ComfyUI-MAINodes",
          error:
            "git pull --ff-only 失败（退出码 128）\nhint: or:\n\tgit rebase\nfatal: Not possible to fast-forward, aborting.",
        },
      ],
    });

    assert.equal(
      message,
      "全部 1 个插件更新失败：git pull --ff-only 失败（退出码 128）"
    );
  });

  it("部分成功：给出成功数，并列出失败的插件", () => {
    const message = bulkUpdateError({
      updated: ["ComfyUI_Text_Translation"],
      failed: [
        { dirName: "ComfyUI-Manager", error: "超时" },
        { dirName: "KaYTool", error: "超时" },
      ],
    });

    assert.equal(
      message,
      "已更新 1 个，2 个失败（ComfyUI-Manager、KaYTool）：超时"
    );
  });

  it("没有失败时返回 null，成功路径不该被算成任务失败", () => {
    assert.equal(bulkUpdateError({ updated: ["A"], failed: [] }), null);
    assert.equal(bulkUpdateError({ updated: [], failed: [] }), null);
  });
});
