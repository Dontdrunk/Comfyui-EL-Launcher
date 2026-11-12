import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  createSpeedMeter,
  isNewer,
  parseLatestYml,
  pickFile,
  sha512Base64,
} from "./selfUpdatePlan.mjs";

describe("selfUpdatePlan", () => {
  const YML = `
version: 0.2.0
files:
  - url: ExplorerLauncher-0.2.0-setup.exe
    sha512: abcdef==
    size: 10
  - url: ExplorerLauncher-0.2.0-portable.exe
    sha512: xyz==
    size: 20
path: ExplorerLauncher-0.2.0-setup.exe
sha512: abcdef==
`;

  it("远端更高才算可更新", () => {
    assert.equal(isNewer("0.1.0", "0.2.0"), true);
    assert.equal(isNewer("v0.1.0", "0.2.0"), true);
    assert.equal(isNewer("0.2.0", "0.1.0"), false);
    assert.equal(isNewer("0.1.0", "0.1.0"), false);
    assert.equal(isNewer("0.1.0", "latest"), false);
  });

  it("安装版和便携版选对文件名", () => {
    const parsed = parseLatestYml(YML);
    assert.ok(parsed);
    assert.equal(
      pickFile(parsed.files, false)?.url,
      "ExplorerLauncher-0.2.0-setup.exe"
    );
    assert.equal(
      pickFile(parsed.files, true)?.url,
      "ExplorerLauncher-0.2.0-portable.exe"
    );
  });

  it("下载速度按最近一秒的采样算", () => {
    const meter = createSpeedMeter(1000);

    // 只有一个采样：还算不出速度
    meter.sample(0, 0);
    assert.equal(meter.rate(), null);

    meter.sample(1024 * 1024, 1000);
    assert.equal(meter.rate(), 1024 * 1024);

    // 更早的采样被窗口挤掉，速度只反映当下
    meter.sample(2 * 1024 * 1024, 2000);
    assert.equal(meter.rate(), 1024 * 1024);
  });

  it("暂停后不给一个虚高的速度", () => {
    const meter = createSpeedMeter(1000);

    meter.sample(0, 0);
    meter.sample(1024, 1000);
    // 5 秒没有任何数据：只剩最早那个过期采样，速度未知
    meter.sample(1024, 6000);
    assert.equal(meter.rate(), null);
  });

  it("sha512 字符串对得上", () => {
    const parsed = parseLatestYml(YML);
    assert.equal(parsed?.files[0]?.sha512, "abcdef==");
    assert.equal(parsed?.files[1]?.sha512, "xyz==");
    assert.equal(
      sha512Base64(Buffer.from("explorer")),
      "1MoaINlTKMILP/18uWqON8f4iaHfAUJihSS4cINp+rQVql984Y+XOeQe3V9S12GiFzoc5gnsZZDvLn299Ar8DQ=="
    );
  });
});
