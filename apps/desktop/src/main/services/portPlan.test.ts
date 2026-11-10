import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  isLoopback,
  isOurComfy,
  listenersOf,
  looksLikeComfy,
  normalizePath,
  pickOwner,
} from "./portPlan.mjs";

describe("portPlan", () => {
  const NETSTAT = [
    "活动连接",
    "",
    "  协议  本地地址          外部地址        状态           PID",
    "  TCP    0.0.0.0:8188           0.0.0.0:0              LISTENING       12345",
    "  TCP    127.0.0.1:8188         127.0.0.1:52133        ESTABLISHED     12345",
    "  TCP    [::]:8188              [::]:0                 LISTENING       12345",
    "  TCP    127.0.0.1:8188         127.0.0.1:52220        ESTABLISHED     999",
    "  TCP    127.0.0.1:8189         0.0.0.0:0              LISTENING       777",
    "  UDP    0.0.0.0:8188           *:*                                    888",
  ].join("\r\n");

  it("listenersOf: 只认 LISTENING，IPv4/IPv6 去重", () => {
    assert.deepEqual(listenersOf(NETSTAT, 8188), [12345]);
  });

  it("listenersOf: 其它端口互不干扰", () => {
    assert.deepEqual(listenersOf(NETSTAT, 8189), [777]);
    assert.deepEqual(listenersOf(NETSTAT, 9999), []);
  });

  it("listenersOf: 非法入参返回空数组", () => {
    assert.deepEqual(listenersOf("", 8188), []);
    assert.deepEqual(listenersOf(NETSTAT, 0), []);
    assert.deepEqual(listenersOf(NETSTAT, Number.NaN), []);
  });

  it("listenersOf: 同一端口多个监听 PID 全部返回", () => {
    const text = [
      "  TCP    127.0.0.1:8188         0.0.0.0:0              LISTENING       1111",
      "  TCP    192.168.1.2:8188       0.0.0.0:0              LISTENING       2222",
    ].join("\n");
    assert.deepEqual(listenersOf(text, 8188), [1111, 2222]);
  });

  it("normalizePath: 统一分隔符与大小写", () => {
    assert.equal(
      normalizePath("D:/Projects/ComfyUI-X/ComfyUI/main.py"),
      "d:\\projects\\comfyui-x\\comfyui\\main.py"
    );
  });

  const OUR_CMD =
    '"D:\\Projects\\Procedure\\ComfyUI-X\\python_embeded\\python.exe" -s ComfyUI\\main.py --windows-standalone-build --port 8188';

  it("isOurComfy: 命令行属于当前 comfyRoot 的 python → 是我们的", () => {
    assert.equal(
      isOurComfy(
        { name: "python.exe", commandLine: OUR_CMD },
        "D:\\Projects\\Procedure\\ComfyUI-X"
      ),
      true
    );
  });

  it("isOurComfy: 根目录用正斜杠也认", () => {
    assert.equal(
      isOurComfy(
        { name: "python.exe", commandLine: OUR_CMD },
        "D:/Projects/Procedure/ComfyUI-X"
      ),
      true
    );
  });

  it("isOurComfy: 前缀相似的另一个目录不认（ComfyUI-X2 不是 ComfyUI-X）", () => {
    assert.equal(
      isOurComfy(
        { name: "python.exe", commandLine: OUR_CMD },
        "D:\\Projects\\Procedure\\ComfyUI-X2"
      ),
      false
    );
  });

  it("isOurComfy: 别的 ComfyUI 实例不认", () => {
    const other =
      '"E:\\AI\\ComfyUI\\python_embeded\\python.exe" -s ComfyUI\\main.py';
    assert.equal(
      isOurComfy(
        { name: "python.exe", commandLine: other },
        "D:\\Projects\\Procedure\\ComfyUI-X"
      ),
      false
    );
    assert.equal(
      looksLikeComfy({ name: "python.exe", commandLine: other }),
      true
    );
  });

  it("isOurComfy: 非 python 或没有命令行一律不认（不自动接管别人的进程）", () => {
    assert.equal(
      isOurComfy(
        { name: "node.exe", commandLine: OUR_CMD },
        "D:\\Projects\\Procedure\\ComfyUI-X"
      ),
      false
    );
    assert.equal(
      isOurComfy(
        { name: "python.exe", commandLine: null },
        "D:\\Projects\\Procedure\\ComfyUI-X"
      ),
      false
    );
    assert.equal(isOurComfy(null, "D:\\X"), false);
  });

  it("isOurComfy: 没有配置根目录时，只要是 ComfyUI 主脚本就认", () => {
    assert.equal(
      isOurComfy({ name: "python.exe", commandLine: OUR_CMD }, ""),
      true
    );
  });
  /* ── 多监听者选择 ── */

  const OUR_ROOT = "D:\\Projects\\Procedure\\ComfyUI-X";
  const OUR = {
    pid: 11280,
    localAddress: "127.0.0.1",
    name: "python.exe",
    commandLine:
      '"D:\\Projects\\Procedure\\ComfyUI-X\\python_embeded\\python.exe" "ComfyUI\\main.py" --port 8188',
  };
  const FOREIGN = {
    pid: 4652,
    localAddress: "0.0.0.0",
    name: "node.exe",
    commandLine: '"node.exe" fake.js',
  };

  it("isLoopback: 只认真正的回环", () => {
    assert.equal(isLoopback("127.0.0.1"), true);
    assert.equal(isLoopback("::1"), true);
    assert.equal(isLoopback("0.0.0.0"), false);
    assert.equal(isLoopback("192.168.1.3"), false);
  });

  it("pickOwner: 同一端口有多个监听者时优先本机 ComfyUI", () => {
    const picked = pickOwner([FOREIGN, OUR], OUR_ROOT);
    assert.ok(picked);
    assert.equal(picked.pid, 11280);
    assert.equal(picked.isOurComfy, true);
  });

  it("pickOwner: 没有本机 ComfyUI 时优先回环监听", () => {
    const other = { ...FOREIGN, pid: 777, localAddress: "127.0.0.1" };
    const picked = pickOwner([FOREIGN, other], OUR_ROOT);
    assert.ok(picked);
    assert.equal(picked.pid, 777);
    assert.equal(picked.isOurComfy, false);
  });

  it("pickOwner: 空列表返回 null", () => {
    assert.equal(pickOwner([], OUR_ROOT), null);
    assert.equal(pickOwner(null, OUR_ROOT), null);
  });

  it("pickOwner: 忽略 PID 非法的条目", () => {
    assert.equal(pickOwner([{ pid: 0 }, { pid: "x" }], OUR_ROOT), null);
  });
});
