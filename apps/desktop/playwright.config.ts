import { defineConfig } from "@playwright/test";

const ci = process.env.CI !== undefined;

// Electron 用例各自启动一个应用实例：串行执行，失败时保留 trace。
export default defineConfig({
  expect: { timeout: 15_000 },
  forbidOnly: ci,
  fullyParallel: false,
  reporter: ci ? [["github"], ["html", { open: "never" }]] : "list",
  testDir: "tests/e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  use: { trace: "retain-on-failure" },
  workers: 1,
});
