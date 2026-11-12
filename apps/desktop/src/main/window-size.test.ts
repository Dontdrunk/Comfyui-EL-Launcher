import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_WINDOW_SIZE,
  MIN_WINDOW_SIZE,
  normalizeWindowSize,
  parseWindowSize,
} from "./window-size";

const workArea = { height: 1080, width: 1920 };

/**
 * 「每次启动都是同一个尺寸」这一条约定：
 * 上次退出时的长宽要原样回到下一次启动，没有记录时用默认值，
 * 记录坏了、屏幕变小了都不能把窗口卡在打不开的尺寸上。
 */
describe("window size memory", () => {
  it("reopens at the size remembered by the previous launch", () => {
    const saved = parseWindowSize('{"height":740,"width":1000}', workArea);

    expect(saved).toStrictEqual({ height: 740, width: 1000 });
    // 再启动一次读到的还是同一份尺寸
    expect(parseWindowSize(JSON.stringify(saved), workArea)).toStrictEqual(
      saved
    );
  });

  it("falls back to the default size when nothing was saved", () => {
    expect(parseWindowSize("", workArea)).toStrictEqual(DEFAULT_WINDOW_SIZE);
  });

  it("falls back to the default size when the state file is corrupt", () => {
    expect(parseWindowSize('{"width":1000,', workArea)).toStrictEqual(
      DEFAULT_WINDOW_SIZE
    );
    expect(
      parseWindowSize('{"height":"740","width":1000}', workArea)
    ).toStrictEqual(DEFAULT_WINDOW_SIZE);
  });

  it("keeps the size the layout needs", () => {
    expect(
      normalizeWindowSize({ height: 400, width: 600 }, workArea)
    ).toStrictEqual(MIN_WINDOW_SIZE);
  });

  it("fits a remembered size into a smaller screen", () => {
    expect(
      normalizeWindowSize(
        { height: 1200, width: 2400 },
        { height: 900, width: 1600 }
      )
    ).toStrictEqual({ height: 900, width: 1600 });
  });

  it("never drops below the layout minimum on a small screen", () => {
    expect(
      normalizeWindowSize(
        { height: 600, width: 800 },
        { height: 700, width: 1024 }
      )
    ).toStrictEqual(MIN_WINDOW_SIZE);
  });
});
