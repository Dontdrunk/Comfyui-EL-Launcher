import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";

import type { AppSettings } from "@explorer-launcher/electron";

/**
 * 端到端用例跑在真实 Electron 窗口里：真 preload、真 IPC、真 userData。
 * 唯一的隔离是 `--user-data-dir`，避免碰到用户正在用的配置与单实例锁。
 */
const appDir = path.join(import.meta.dirname, "../..");

/** ELECTRON_RUN_AS_NODE 会让 electron 退化成 Node，测试进程必须自己剔除。 */
const electronEnv = () => {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (
      value === undefined ||
      key === "ELECTRON_RUN_AS_NODE" ||
      key === "ELECTRON_NO_ATTACH_CONSOLE"
    ) {
      continue;
    }

    env[key] = value;
  }

  return env;
};

interface Launched {
  application: ElectronApplication;
  page: Page;
  userData: string;
}

const launchProfile = async (userData: string): Promise<Launched> => {
  const application = await electron.launch({
    args: [".", `--user-data-dir=${userData}`],
    cwd: appDir,
    env: electronEnv(),
  });

  const page = await application.firstWindow();

  await page.waitForLoadState("domcontentloaded");

  return { application, page, userData };
};

/** 新开一个临时配置目录；seed 用于模拟「上次运行留下的配置」 */
const launch = async (seed?: Partial<AppSettings>): Promise<Launched> => {
  const userData = await mkdtemp(
    path.join(os.tmpdir(), "explorer-launcher-e2e-")
  );

  if (seed) {
    await writeFile(
      path.join(userData, "config.json"),
      JSON.stringify(seed),
      "utf-8"
    );
  }

  return await launchProfile(userData);
};

const close = async ({ application, userData }: Launched) => {
  await application.close();
  await rm(userData, { force: true, recursive: true });
};

test("the shell boots and lands on the dashboard", async () => {
  const launched = await launch();

  try {
    const { page } = launched;

    await expect(page).toHaveTitle("探索者启动器");
    await expect(page.getByRole("link", { name: "版本管理" })).toBeVisible();
    await expect(page.getByText("ComfyUI 版本")).toBeVisible();
  } finally {
    await close(launched);
  }
});

test("the sidebar and browser history drive one router", async () => {
  const launched = await launch();

  try {
    const { page } = launched;
    const versions = page.getByRole("link", { name: "版本管理" });
    const nodes = page.getByRole("link", { name: "插件管理" });
    const active = (href: string) => page.locator(`a[data-href="${href}"]`);

    await versions.click();
    await expect(page).toHaveURL(/\/versions$/u);
    await expect(active("versions")).toHaveAttribute("aria-current", "page");

    await nodes.click();
    await expect(page).toHaveURL(/\/nodes$/u);
    await expect(active("nodes")).toHaveAttribute("aria-current", "page");

    await page.goBack();
    await expect(page).toHaveURL(/\/versions$/u);
    await expect(active("versions")).toHaveAttribute("aria-current", "page");
  } finally {
    await close(launched);
  }
});

test("a deep link is served by the app protocol", async () => {
  const launched = await launch();

  try {
    const { page } = launched;

    await page.goto("https://app.localhost/settings");

    await expect(page).toHaveURL(/\/settings$/u);
    await expect(page.locator('a[data-href="settings"]')).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(page.getByText("目录状态")).toBeVisible();
  } finally {
    await close(launched);
  }
});

test("the console splits runtime and launcher logs", async () => {
  const launched = await launch();

  try {
    const { page } = launched;

    await page.getByRole("link", { name: "控制台" }).click();
    await expect(page).toHaveURL(/\/logs$/u);
    await expect(page.getByRole("button", { name: "运行日志" })).toBeVisible();

    // 启动器日志承接主进程/环境探测；运行日志此时还没有 ComfyUI 进程输出
    await page.getByRole("button", { name: "启动器日志" }).click();
    await expect(page.getByText(/\[环境\]/u).first()).toBeVisible();

    await page.getByRole("button", { name: "运行日志" }).click();
    await expect(page.getByText("暂无日志")).toBeVisible();
  } finally {
    await close(launched);
  }
});

test("a model shortcut keeps its renamed title across restarts", async () => {
  const first = await launch({
    modelShortcuts: [{ path: "D:\\models\\checkpoints", name: "Checkpoints" }],
  });

  const { userData } = first;
  let second: Launched | null = null;

  try {
    await first.page.getByRole("link", { name: "模型管理" }).click();
    await expect(first.page).toHaveURL(/\/models$/u);

    const card = first.page.locator(".quickcard");

    await expect(card).toBeVisible();
    await card.locator(".quickcard__open").dblclick();

    const input = first.page.locator(".quickcard__rename");

    await expect(input).toBeVisible();
    await input.fill("常用 Checkpoints");
    await input.press("Enter");
    await expect(first.page.locator(".quickcard__name")).toHaveText(
      "常用 Checkpoints"
    );

    await first.application.close();

    // 真·重启：同一个 userData 再起一次，标题应来自落盘的 config.json
    second = await launchProfile(userData);
    await second.page.getByRole("link", { name: "模型管理" }).click();
    await expect(second.page.locator(".quickcard__name")).toHaveText(
      "常用 Checkpoints"
    );
  } finally {
    await first.application.close().catch(() => null);
    await second?.application.close().catch(() => null);
    await rm(userData, { force: true, recursive: true });
  }
});

test("the theme switch survives a reload", async () => {
  const launched = await launch();

  try {
    const { page } = launched;
    const html = page.locator("html");

    await expect(html).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "切换主题" }).click();
    await expect(html).toHaveAttribute("data-theme", "light");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(html).toHaveAttribute("data-theme", "light");
  } finally {
    await close(launched);
  }
});
