import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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

/**
 * 造一个「结构上有效」的便携版目录。
 * 目录校验不过时应用会统一显示配置引导页，页面内容根本不会渲染，
 * 所以除了专门测引导页的用例，其余用例都要先把它铺好。
 */
const makePortableRoot = async (root: string): Promise<void> => {
  await mkdir(path.join(root, "python_embeded"), { recursive: true });
  await mkdir(path.join(root, "ComfyUI", "custom_nodes"), { recursive: true });
  await writeFile(path.join(root, "python_embeded", "python.exe"), "", "utf-8");
  await writeFile(path.join(root, "ComfyUI", "main.py"), "", "utf-8");
};

/**
 * 造一个「本地装着旧版本、远端已经发了新版本」的 git 插件。
 * 插件按 installFromGit 的方式浅克隆，所以第一次打开版本面板会补全历史；
 * 远端是本地裸仓库，联网检查与 fetch 都不依赖外网。
 */
const makePluginWithNewerRelease = async (comfyRoot: string) => {
  const remote = path.join(comfyRoot, "plugin-remote.git");
  const work = path.join(comfyRoot, "plugin-work");

  const pluginDir = path.join(
    comfyRoot,
    "ComfyUI",
    "custom_nodes",
    "PluginGit"
  );

  const commit = (message: string): void => {
    execFileSync("git", ["add", "."], { cwd: work, stdio: "ignore" });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=e2e",
        "-c",
        "user.email=e2e@example.com",
        "commit",
        "-q",
        "-m",
        message,
      ],
      { cwd: work, stdio: "ignore" }
    );
  };

  const push = (): void => {
    execFileSync(
      "git",
      ["push", "-q", "origin", "HEAD:refs/heads/master", "--tags"],
      { cwd: work, stdio: "ignore" }
    );
  };

  await mkdir(work, { recursive: true });
  execFileSync("git", ["init", "-q", "--bare", remote], { stdio: "ignore" });
  // 裸仓库的 HEAD 指到要推的分支，否则 clone 出来的工作区是空的
  execFileSync(
    "git",
    ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/master"],
    { stdio: "ignore" }
  );
  execFileSync("git", ["init", "-q"], { cwd: work, stdio: "ignore" });
  await writeFile(path.join(work, "README.md"), "old\n", "utf-8");
  commit("old version");
  execFileSync("git", ["tag", "v1.0.0"], { cwd: work, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", remote], {
    cwd: work,
    stdio: "ignore",
  });
  push();
  execFileSync(
    "git",
    [
      "clone",
      "-q",
      "--depth=1",
      `file:///${remote.replaceAll("\\", "/")}`,
      pluginDir,
    ],
    { stdio: "ignore" }
  );

  /** 远端发布下一个版本（已安装的那份代码不动） */
  const publishNewerRelease = async (): Promise<void> => {
    await writeFile(path.join(work, "README.md"), "new\n", "utf-8");
    commit("new version with fix");
    push();
  };

  return { publishNewerRelease };
};

/** 全新安装：连 config.json 都没有，默认设置必须处于「未配置根目录」 */
const launchFresh = async (): Promise<Launched> => {
  const userData = await mkdtemp(
    path.join(os.tmpdir(), "explorer-launcher-e2e-")
  );

  return await launchProfile(userData);
};

/** 新开一个临时配置目录；seed 用于模拟「上次运行留下的配置」 */
const launch = async (seed?: Partial<AppSettings>): Promise<Launched> => {
  const userData = await mkdtemp(
    path.join(os.tmpdir(), "explorer-launcher-e2e-")
  );

  const comfyRoot = path.join(userData, "comfy");

  await makePortableRoot(comfyRoot);
  await writeFile(
    path.join(userData, "config.json"),
    JSON.stringify({ comfyRoot, ...seed }),
    "utf-8"
  );

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

test("a fresh install starts unconfigured", async () => {
  const launched = await launchFresh();

  try {
    const { page } = launched;

    // 没有默认路径：全新安装必须先落到配置引导，而不是假装配好了
    await expect(page.getByText("请配置 ComfyUI 项目目录后使用")).toBeVisible();

    await page.getByRole("button", { name: "去设置" }).click();
    await expect(
      page.getByPlaceholder("点「浏览」选择 ComfyUI 便携版根目录")
    ).toHaveValue("");
  } finally {
    await close(launched);
  }
});

test("a missing ComfyUI root shows one setup screen on every page", async () => {
  const launched = await launch({ comfyRoot: "" });

  try {
    const { page } = launched;
    const setup = page.getByText("请配置 ComfyUI 项目目录后使用");

    await expect(setup).toBeVisible();

    // 换任何页面都是同一屏，而不是各页各写一套「未设置目录」
    await page.getByRole("link", { name: "插件管理" }).click();
    await expect(page).toHaveURL(/\/nodes$/u);
    await expect(setup).toBeVisible();

    // 设置页是配置的地方，不能被引导页挡住
    await page.getByRole("button", { name: "去设置" }).click();
    await expect(page).toHaveURL(/\/settings$/u);
    await expect(setup).toHaveCount(0);
    await expect(page.getByText("目录状态")).toBeVisible();

    // 未配置时设置页直接说清该选什么样的目录，不再报「目录不存在」
    await expect(
      page.getByText(
        "选择的目录需要包含 python_embeded 与 ComfyUI 两个子目录。"
      )
    ).toBeVisible();
    await expect(page.getByText("目录不存在")).toHaveCount(0);

    // 输入框里必须是空的：那行路径只是占位提示，不是已经配好的值
    await expect(
      page.getByPlaceholder("点「浏览」选择 ComfyUI 便携版根目录")
    ).toHaveValue("");
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

test("an uninstall that empties the plugin filter keeps the search box reachable", async () => {
  const comfyRoot = await mkdtemp(
    path.join(os.tmpdir(), "explorer-launcher-comfy-")
  );

  const customNodes = path.join(comfyRoot, "ComfyUI", "custom_nodes");

  await makePortableRoot(comfyRoot);
  await Promise.all(
    ["PluginAlpha", "PluginBeta", "PluginGamma"].map(
      async (dirName) =>
        await mkdir(path.join(customNodes, dirName), { recursive: true })
    )
  );

  const launched = await launch({ comfyRoot });

  try {
    const { page } = launched;

    await page.getByRole("link", { name: "插件管理" }).click();
    await expect(page).toHaveURL(/\/nodes$/u);

    const rows = page.locator("tbody tr");
    const search = page.locator(".table__search-input");

    await expect(rows).toHaveCount(3);
    await search.fill("PluginAlpha");
    await expect(rows).toHaveCount(1);

    await page.getByRole("button", { name: "卸载" }).click();

    // 卸载不再弹确认框：点下即删，结果只走顶部轻提示
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("已卸载插件 PluginAlpha")).toBeVisible();
    await expect
      .poll(async () => await readdir(customNodes))
      .toEqual(["PluginBeta", "PluginGamma"]);

    // 卸载刷新后筛选条件仍指向刚删掉的插件：搜索框必须还在，否则筛选永远清不掉
    await expect(page.getByText("没有匹配的插件")).toBeVisible();
    await expect(search).toHaveValue("PluginAlpha");

    await search.fill("");
    await expect(rows).toHaveCount(2);
  } finally {
    await close(launched);
    await rm(comfyRoot, { force: true, recursive: true });
  }
});

test("toggling a disabled plugin renames it back and reports through the toast only", async () => {
  const comfyRoot = await mkdtemp(
    path.join(os.tmpdir(), "explorer-launcher-comfy-")
  );

  const customNodes = path.join(comfyRoot, "ComfyUI", "custom_nodes");

  await makePortableRoot(comfyRoot);
  await mkdir(path.join(customNodes, "PluginAlpha.disabled"), {
    recursive: true,
  });

  const launched = await launch({ comfyRoot });

  try {
    const { page } = launched;

    await page.getByRole("link", { name: "插件管理" }).click();
    await expect(page).toHaveURL(/\/nodes$/u);

    const row = page.locator("tbody tr").filter({ hasText: "PluginAlpha" });

    await expect(row).toHaveCount(1);
    await expect(row.locator('input[type="checkbox"]')).not.toBeChecked();

    await row.locator(".switch__track").click();

    // 启用成功：复选框亮起，目录真的去掉了 .disabled 后缀
    await expect(row.locator('input[type="checkbox"]')).toBeChecked();
    await expect(page.getByText("已启用 PluginAlpha")).toBeVisible();
    await expect
      .poll(async () => await readdir(customNodes))
      .toEqual(["PluginAlpha"]);

    // 结果只走顶部轻提示，页面里不再留一条常驻的操作失败横幅
    await expect(page.locator(".notice")).toHaveCount(0);
  } finally {
    await close(launched);
    await rm(comfyRoot, { force: true, recursive: true });
  }
});

test("toggling a plugin keeps its update status", async () => {
  const comfyRoot = await mkdtemp(
    path.join(os.tmpdir(), "explorer-launcher-comfy-")
  );

  await makePortableRoot(comfyRoot);

  const pluginDir = path.join(
    comfyRoot,
    "ComfyUI",
    "custom_nodes",
    "PluginGit"
  );

  await mkdir(pluginDir, { recursive: true });

  const git = (args: string[]): void => {
    execFileSync("git", args, { cwd: pluginDir, stdio: "ignore" });
  };

  git(["init", "-q"]);
  git([
    "-c",
    "user.name=e2e",
    "-c",
    "user.email=e2e@example.com",
    "commit",
    "--allow-empty",
    "-q",
    "-m",
    "init",
  ]);
  git(["remote", "add", "origin", pluginDir]);

  const launched = await launch({ comfyRoot });

  try {
    const { page } = launched;

    await page.getByRole("link", { name: "插件管理" }).click();

    const row = page.locator("tbody tr").filter({ hasText: "PluginGit" });

    await expect(row.getByText("最新")).toBeVisible();

    await row.locator(".switch__track").click();
    await expect(row.locator('input[type="checkbox"]')).not.toBeChecked();

    // 开关只改目录名（.disabled 后缀），版本状态属于插件本身，不能跟着丢
    await expect(row.getByText("最新")).toBeVisible();
    await expect
      .poll(
        async () =>
          await readdir(path.join(comfyRoot, "ComfyUI", "custom_nodes"))
      )
      .toEqual(["PluginGit.disabled"]);

    // 窗口缩到最小宽度：更新时间与行动作都必须各自保持一行，不能被挤成两行
    await launched.application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(950, 720);
    });
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
            const tr = document.querySelector("tbody tr");

            if (!tr) {
              return null;
            }

            const date = tr.children.item(5);

            if (!(date instanceof HTMLElement)) {
              return null;
            }

            const actions = [
              ...tr.querySelectorAll(".table__actions > *"),
            ].flatMap((el) =>
              el instanceof HTMLElement ? [el.offsetTop] : []
            );

            return {
              dateClipped: date.scrollWidth > date.clientWidth,
              actionLines: new Set(actions).size,
              rowOneLine: tr.getBoundingClientRect().height < 60,
            };
          })
      )
      .toEqual({ dateClipped: false, actionLines: 1, rowOneLine: true });
  } finally {
    await close(launched);
    await rm(comfyRoot, { force: true, recursive: true });
  }
});

test("a hand-placed plugin reads as a local install and latest", async () => {
  const comfyRoot = await mkdtemp(
    path.join(os.tmpdir(), "explorer-launcher-comfy-")
  );

  await makePortableRoot(comfyRoot);
  await mkdir(path.join(comfyRoot, "ComfyUI", "custom_nodes", "PluginLocal"), {
    recursive: true,
  });

  const launched = await launch({ comfyRoot });

  try {
    const { page } = launched;

    await page.getByRole("link", { name: "插件管理" }).click();

    const row = page.locator("tbody tr").filter({ hasText: "PluginLocal" });

    await expect(row).toHaveCount(1);
    // 自己放进 custom_nodes 的目录：来源是「手动安装」，不是「非 git 目录」
    await expect(row.getByText("手动安装")).toBeVisible();
    // 没有远端就没有可比的版本，算「最新」，不能挂一条「未比对」当异常
    await expect(row.getByText("最新")).toBeVisible();
    await expect(row.getByText("未比对")).toHaveCount(0);
  } finally {
    await close(launched);
    await rm(comfyRoot, { force: true, recursive: true });
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

test("the window reopens at the size it was left at", async () => {
  const first = await launch();

  await first.application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1000, 740);
  });
  await first.application.close();

  // 同一个 userData 再启动一次：尺寸必须和上次退出时一致
  const second = await launchProfile(first.userData);

  try {
    const size = await second.application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getSize()
    );

    expect(size).toStrictEqual([1000, 740]);
  } finally {
    await close(second);
  }
});

test("the version list picks up a release published after the panel first opened", async () => {
  const comfyRoot = await mkdtemp(
    path.join(os.tmpdir(), "explorer-launcher-comfy-")
  );

  await makePortableRoot(comfyRoot);
  const { publishNewerRelease } = await makePluginWithNewerRelease(comfyRoot);

  const launched = await launch({ comfyRoot });

  try {
    const { page } = launched;

    await page.getByRole("link", { name: "插件管理" }).click();

    const row = page.locator("tbody tr").filter({ hasText: "PluginGit" });
    const modal = page.locator(".modal");

    // 第一次打开：浅克隆被补全历史，此时远端还只有旧版本
    await row.getByRole("button", { name: "切换版本" }).click();
    await expect(modal.getByText("old version")).toBeVisible();
    await modal
      .locator(".modal__foot")
      .getByRole("button", { name: "关闭" })
      .click();
    await expect(modal).toHaveCount(0);

    await publishNewerRelease();
    await page.getByTitle("重新读取插件目录，并联网检查更新").click();
    await expect(row.getByText("更新")).toBeVisible();

    /*
     * 再打开：远端之后发的版本必须出现在列表顶部。
     * 只补一次历史的话，这里永远只有旧版本 —— 角标说「更新」，
     * 列表里却没法切过去。
     */
    await row.getByRole("button", { name: "切换版本" }).click();
    await expect(
      modal.locator("tbody tr").first().getByText("new version with fix")
    ).toBeVisible();
    await expect(
      modal
        .locator("tbody tr")
        .filter({ hasText: "old version" })
        .getByText("当前版本")
    ).toBeVisible();
  } finally {
    await close(launched);
    await rm(comfyRoot, { force: true, recursive: true });
  }
});

test("switching to the newest version clears the update mark", async () => {
  const comfyRoot = await mkdtemp(
    path.join(os.tmpdir(), "explorer-launcher-comfy-")
  );

  await makePortableRoot(comfyRoot);
  const { publishNewerRelease } = await makePluginWithNewerRelease(comfyRoot);

  await publishNewerRelease();

  const launched = await launch({ comfyRoot });

  try {
    const { page } = launched;

    await page.getByRole("link", { name: "插件管理" }).click();

    const row = page.locator("tbody tr").filter({ hasText: "PluginGit" });

    await expect(row.getByText("更新")).toBeVisible();

    await row.getByRole("button", { name: "切换版本" }).click();

    const modal = page.locator(".modal");

    await modal
      .locator("tbody tr")
      .first()
      .getByRole("button", { name: "切换" })
      .click();

    // 切到远端尖端：列表里它成了当前版本，行上的「更新」必须回到「最新」
    await expect(
      modal.locator("tbody tr").first().getByText("当前版本")
    ).toBeVisible();
    await expect(row.getByText("最新")).toBeVisible();
    await expect(row.getByText("更新")).toHaveCount(0);
  } finally {
    await close(launched);
    await rm(comfyRoot, { force: true, recursive: true });
  }
});
