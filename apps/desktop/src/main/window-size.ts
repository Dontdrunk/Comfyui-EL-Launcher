import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { BrowserWindow } from "electron";
import { z } from "zod";

/* ══════════════════════════════════════════════════════════
 * 窗口长宽的记忆
 *
 * 每次启动都开成同一个尺寸：退出前的长宽写进
 * <userData>/window-state.json，下次开机按它开窗。
 * 文件缺失或损坏时回落到默认尺寸，位置仍交给系统居中。
 * ══════════════════════════════════════════════════════════ */

export interface WindowSize {
  height: number;
  width: number;
}

/** 首次启动（还没有状态文件）时的窗口长宽 */
export const DEFAULT_WINDOW_SIZE: WindowSize = { height: 780, width: 1200 };

/** 布局能容纳的最小长宽：再小侧栏就会压到状态条上 */
export const MIN_WINDOW_SIZE: WindowSize = { height: 720, width: 950 };

/** 拖拽缩放时不必每帧落盘，停手后再写 */
const SAVE_DELAY_MS = 400;

const sizeSchema = z.object({
  height: z.number().int().positive(),
  width: z.number().int().positive(),
});

const clampSize = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

/** 收敛成「不小于最小尺寸、不超出屏幕工作区」的整数长宽 */
export const normalizeWindowSize = (
  size: Partial<WindowSize> | null,
  workArea: WindowSize
): WindowSize => ({
  height: clampSize(
    size?.height ?? DEFAULT_WINDOW_SIZE.height,
    MIN_WINDOW_SIZE.height,
    workArea.height
  ),
  width: clampSize(
    size?.width ?? DEFAULT_WINDOW_SIZE.width,
    MIN_WINDOW_SIZE.width,
    workArea.width
  ),
});

export const parseWindowSize = (
  raw: string,
  workArea: WindowSize
): WindowSize => {
  try {
    const parsed = sizeSchema.safeParse(JSON.parse(raw));

    return normalizeWindowSize(parsed.success ? parsed.data : null, workArea);
  } catch {
    // 半截 JSON（写入时断电）按「没有状态文件」处理
    return normalizeWindowSize(null, workArea);
  }
};

export interface WindowSizeStore {
  read: () => WindowSize;
  track: (win: BrowserWindow) => void;
}

/**
 * 状态文件读写：先写临时文件再改名，与设置同一套原子写入，
 * 断电不会留下半截 JSON 把窗口卡在错误的尺寸上。
 */
export const createWindowSizeStore = (
  file: string,
  workArea: WindowSize
): WindowSizeStore => {
  let pending: ReturnType<typeof setTimeout> | null = null;

  const write = (size: WindowSize): void => {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.tmp`;

      writeFileSync(
        temp,
        JSON.stringify(normalizeWindowSize(size, workArea)),
        "utf-8"
      );
      renameSync(temp, file);
    } catch {
      // 尺寸只是体验优化，写不进去不该拦住退出流程
    }
  };

  const save = (win: BrowserWindow): void => {
    if (pending !== null) {
      clearTimeout(pending);
      pending = null;
    }

    const { height, width } = win.getNormalBounds();

    write({ height, width });
  };

  return {
    read: (): WindowSize => {
      try {
        return parseWindowSize(readFileSync(file, "utf-8"), workArea);
      } catch {
        // 还没写过状态文件，按默认尺寸开窗
        return normalizeWindowSize(null, workArea);
      }
    },
    track: (win: BrowserWindow): void => {
      win.on("resize", () => {
        if (pending !== null) {
          clearTimeout(pending);
        }

        pending = setTimeout(() => {
          save(win);
        }, SAVE_DELAY_MS);
      });
      // 关闭（含收进托盘、退出）时补最后一次：拖动中途被关掉也不会丢尺寸
      win.on("close", () => {
        save(win);
      });
    },
  };
};
