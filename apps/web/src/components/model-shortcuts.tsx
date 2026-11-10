import { FolderOpen, GripVertical, X } from "lucide";
import { useEffect, useRef, useState } from "react";

import type { ModelShortcut } from "@explorer-launcher/electron";

import { Icon } from "#src/launcher/components/Icon.tsx";
import { useApp } from "#src/launcher/store.ts";

import "./model-shortcuts.css";

/*
 * 模型管理页的「快捷访问」卡片。
 *
 * 目录从模型树的「设为快捷」按钮加入；卡片本身负责打开文件夹、移除、
 * 拖拽排序与双击改名。列表存在 settings.modelShortcuts（主进程 config.json），
 * 顺序与自定义标题都随配置持久化。
 */

const RENAME_MAX_LENGTH = 40;

/** 单击打开要等这么久，给双击改名留出判定窗口 */
const CLICK_OPEN_DELAY_MS = 240;

const folderName = (path: string): string => {
  const parts = path.split(/[\\/]/u).filter(Boolean);

  return parts.at(-1) ?? path;
};

const displayName = (shortcut: ModelShortcut): string =>
  shortcut.name || folderName(shortcut.path);

export const ModelShortcuts = (): React.JSX.Element => {
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const pushToast = useApp((s) => s.pushToast);

  const shortcuts = settings?.modelShortcuts ?? [];

  const clickTimer = useRef<number | null>(null);
  const skipBlurCommit = useRef(false);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draggingPath, setDraggingPath] = useState<string | null>(null);

  const [dropHint, setDropHint] = useState<{
    path: string;
    after: boolean;
  } | null>(null);

  useEffect(
    () => () => {
      if (clickTimer.current !== null) {
        window.clearTimeout(clickTimer.current);
      }
    },
    []
  );

  const cancelPendingOpen = (): void => {
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
  };

  const open = async (target: ModelShortcut): Promise<void> => {
    try {
      await window.launcher.openPath(target.path);
    } catch (error) {
      pushToast(
        `打开失败：${error instanceof Error ? error.message : String(error)}`,
        "error"
      );
    }
  };

  /**
   * 单击打开、双击改名共用一个点击计时器：
   * 第一次点击先挂起，第二次点击在计时器触发前到达就取消打开，交给双击改名。
   */
  const scheduleOpen = (target: ModelShortcut): void => {
    if (editingPath !== null) {
      return;
    }

    if (clickTimer.current !== null) {
      cancelPendingOpen();

      return;
    }

    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      void open(target);
    }, CLICK_OPEN_DELAY_MS);
  };

  const startRename = (target: ModelShortcut): void => {
    if (editingPath !== null) {
      return;
    }

    cancelPendingOpen();
    skipBlurCommit.current = false;
    setDraft(displayName(target));
    setEditingPath(target.path);
  };

  const commitRename = async (target: ModelShortcut): Promise<void> => {
    const next = draft.trim().slice(0, RENAME_MAX_LENGTH);

    setEditingPath(null);

    if (next === displayName(target)) {
      return;
    }

    try {
      await patchSettings({
        modelShortcuts: shortcuts.map((shortcut) =>
          shortcut.path === target.path ? { ...shortcut, name: next } : shortcut
        ),
      });
    } catch (error) {
      pushToast(
        `重命名失败：${error instanceof Error ? error.message : String(error)}`,
        "error"
      );
    }
  };

  const cancelRename = (): void => {
    skipBlurCommit.current = true;
    setEditingPath(null);
  };

  const remove = async (target: ModelShortcut): Promise<void> => {
    cancelPendingOpen();

    if (editingPath === target.path) {
      setEditingPath(null);
    }

    try {
      await patchSettings({
        modelShortcuts: shortcuts.filter(
          (shortcut) => shortcut.path !== target.path
        ),
      });
    } catch (error) {
      pushToast(
        `移除失败：${error instanceof Error ? error.message : String(error)}`,
        "error"
      );
    }
  };

  const onDragStart = (
    event: React.DragEvent<HTMLDivElement>,
    target: ModelShortcut
  ): void => {
    if (editingPath !== null) {
      event.preventDefault();

      return;
    }

    cancelPendingOpen();
    setDraggingPath(target.path);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", target.path);
  };

  const onDragOver = (
    event: React.DragEvent<HTMLDivElement>,
    target: ModelShortcut
  ): void => {
    if (draggingPath === null || draggingPath === target.path) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;

    setDropHint((current) =>
      current?.path === target.path && current.after === after
        ? current
        : { path: target.path, after }
    );
  };

  const onDrop = async (
    event: React.DragEvent<HTMLDivElement>,
    target: ModelShortcut
  ): Promise<void> => {
    event.preventDefault();
    const fromPath = draggingPath;
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;

    setDraggingPath(null);
    setDropHint(null);

    if (fromPath === null || fromPath === target.path) {
      return;
    }

    const moved = shortcuts.find((shortcut) => shortcut.path === fromPath);

    if (!moved) {
      return;
    }

    const remaining = shortcuts.filter(
      (shortcut) => shortcut.path !== fromPath
    );

    const targetIndex = remaining.findIndex(
      (shortcut) => shortcut.path === target.path
    );

    if (targetIndex === -1) {
      return;
    }

    const next = [...remaining];

    next.splice(after ? targetIndex + 1 : targetIndex, 0, moved);

    if (next.every((shortcut, i) => shortcut.path === shortcuts[i]?.path)) {
      return;
    }

    try {
      await patchSettings({ modelShortcuts: next });
    } catch (error) {
      pushToast(
        `排序失败：${error instanceof Error ? error.message : String(error)}`,
        "error"
      );
    }
  };

  return (
    <section className="quickbar" aria-label="模型快捷访问">
      <div className="quickbar__head">
        <span className="section-title">快捷访问</span>
      </div>

      {shortcuts.length === 0 ? (
        <p className="quickbar__empty">
          在下方目录行右侧点「设为快捷」，把常去的文件夹固定到这里；卡片可以拖拽排序、双击标题改名。
        </p>
      ) : (
        <div className="quickbar__list">
          {shortcuts.map((shortcut) => {
            const title = displayName(shortcut);
            const isEditing = editingPath === shortcut.path;
            let dropEdge = "";

            if (dropHint?.path === shortcut.path) {
              dropEdge = dropHint.after
                ? "quickcard--drop-after"
                : "quickcard--drop-before";
            }

            return (
              <div
                className={[
                  "quickcard",
                  draggingPath === shortcut.path ? "quickcard--dragging" : "",
                  dropEdge,
                ]
                  .filter(Boolean)
                  .join(" ")}
                draggable={editingPath === null}
                key={shortcut.path}
                onDragEnd={() => {
                  setDraggingPath(null);
                  setDropHint(null);
                }}
                onDragOver={(event) => {
                  onDragOver(event, shortcut);
                }}
                onDragStart={(event) => {
                  onDragStart(event, shortcut);
                }}
                onDrop={(event) => {
                  void onDrop(event, shortcut);
                }}
              >
                <span className="quickcard__grip" aria-hidden>
                  <Icon icon={GripVertical} size={14} />
                </span>

                {isEditing ? (
                  <div className="quickcard__edit">
                    <input
                      // 编辑态一出现就聚焦并全选，直接输入即替换标题
                      autoFocus
                      className="quickcard__rename"
                      maxLength={RENAME_MAX_LENGTH}
                      value={draft}
                      onBlur={() => {
                        if (skipBlurCommit.current) {
                          skipBlurCommit.current = false;

                          return;
                        }

                        void commitRename(shortcut);
                      }}
                      onChange={(event) => {
                        setDraft(event.target.value);
                      }}
                      onFocus={(event) => {
                        event.currentTarget.select();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }

                        if (event.key === "Escape") {
                          cancelRename();
                        }
                      }}
                    />
                    <span className="quickcard__path">{shortcut.path}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="quickcard__open"
                    title={shortcut.path}
                    onClick={() => {
                      scheduleOpen(shortcut);
                    }}
                    onDoubleClick={() => {
                      startRename(shortcut);
                    }}
                  >
                    <span className="quickcard__icon">
                      <Icon icon={FolderOpen} size={16} />
                    </span>
                    <span className="quickcard__text">
                      <span className="quickcard__name">{title}</span>
                      <span className="quickcard__path">{shortcut.path}</span>
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  className="quickcard__remove"
                  title="移除快捷方式"
                  aria-label={`移除快捷方式 ${title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void remove(shortcut);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <Icon icon={X} size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
