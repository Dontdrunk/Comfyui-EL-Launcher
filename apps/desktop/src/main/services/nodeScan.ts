import { constants } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { gitSoft } from "./git";

/* ══════════════════════════════════════════════════════════
 * custom_nodes 扫描底座
 *
 * M2（备份清单）与 M3（插件管理）共用。
 * 只做「读」操作，不修改任何文件。
 * ══════════════════════════════════════════════════════════ */

/** ComfyUI 原生禁用机制：目录名以 .disabled 结尾 */
const DISABLED_SUFFIX = ".disabled";

export interface NodeDirEntry {
  /** 目录实际名（可能带 .disabled 后缀） */
  dirName: string;
  /** 去掉 .disabled 后的逻辑名 */
  baseName: string;
  path: string;
  enabled: boolean;
}

export interface NodeGitInfo {
  isGit: boolean;
  remote: string | null;
  commit: string | null;
  shortCommit: string | null;
  commitDate: string | null;
  subject: string | null;
  branch: string | null;
  detached: boolean;
  dirty: boolean;
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);

    return true;
  } catch {
    return false;
  }
}

/** 列出 custom_nodes 下的插件目录（跳过隐藏文件与 pycache） */
export async function listNodeDirs(
  customNodesDir: string
): Promise<NodeDirEntry[]> {
  let entries: { name: string; isDirectory: () => boolean }[];

  try {
    entries = await readdir(customNodesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: NodeDirEntry[] = [];

  for (const e of entries) {
    if (!e.isDirectory()) {
      continue;
    }
    if (e.name.startsWith(".") || e.name === "__pycache__") {
      continue;
    }

    const enabled = !e.name.endsWith(DISABLED_SUFFIX);
    out.push({
      dirName: e.name,
      baseName: enabled ? e.name : e.name.slice(0, -DISABLED_SUFFIX.length),
      path: join(customNodesDir, e.name),
      enabled,
    });
  }

  return out.sort((a, b) => a.baseName.localeCompare(b.baseName));
}

/**
 * 插件在「启用 / 禁用」之后的目录路径。
 * ComfyUI 用目录名后缀表达禁用，所以启用要去掉后缀、禁用要加后缀。
 * 不能拿当前目录路径直接当目标：禁用中的目录自带 .disabled，启用时会原地撞上它自己。
 */
export function nodeDirForEnabled(
  customNodesDir: string,
  baseName: string,
  enabled: boolean
): string {
  return join(
    customNodesDir,
    enabled ? baseName : `${baseName}${DISABLED_SUFFIX}`
  );
}

/** 读取插件目录的 git 信息（非 git 目录返回 isGit:false） */
export async function readNodeGitInfo(dir: string): Promise<NodeGitInfo> {
  const blank: NodeGitInfo = {
    isGit: false,
    remote: null,
    commit: null,
    shortCommit: null,
    commitDate: null,
    subject: null,
    branch: null,
    detached: false,
    dirty: false,
  };

  if (!(await pathExists(join(dir, ".git")))) {
    return blank;
  }

  const [remote, commit, branch, logLine, porcelain] = await Promise.all([
    gitSoft(dir, ["remote", "get-url", "origin"]),
    gitSoft(dir, ["rev-parse", "HEAD"]),
    gitSoft(dir, ["symbolic-ref", "--short", "-q", "HEAD"]),
    gitSoft(dir, ["log", "-1", "--format=%cI%n%s"]),
    gitSoft(dir, ["status", "--porcelain"]),
  ]);

  const [date, subject] = (logLine ?? "").split("\n");

  return {
    isGit: true,
    remote,
    commit,
    shortCommit: commit ? commit.slice(0, 8) : null,
    commitDate: date ?? null,
    subject: subject ?? null,
    branch,
    detached: !branch,
    dirty: Boolean(porcelain),
  };
}

/** 读取插件声明的名称/版本（pyproject.toml → node_config？） */
export interface NodeManifest {
  displayName: string | null;
  version: string | null;
  description: string | null;
  registryId: string | null;
}

/**
 * 从插件目录推断元信息。
 * 优先 pyproject.toml（新版 ComfyUI Registry 规范），
 * 退化到 ComfyUI 节点里常见的 `NODE_CLASS_MAPPINGS` 之上的注释不可靠，故不做猜测。
 */
export async function readNodeManifest(dir: string): Promise<NodeManifest> {
  const blank: NodeManifest = {
    displayName: null,
    version: null,
    description: null,
    registryId: null,
  };

  const pyproject = join(dir, "pyproject.toml");

  if (await pathExists(pyproject)) {
    try {
      const text = await readFile(pyproject, "utf-8");
      const section = /\[project\][\s\S]*?(?=\n\[|$)/.exec(text)?.[0] ?? "";

      const pick = (key: string): string | null => {
        const m = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`, "m").exec(
          section
        );

        return m ? m[1] : null;
      };

      const projectName = pick("name");
      const displayName = projectName ?? null;
      const version = pick("version");
      const description = pick("description");

      // [tool.comfy] 段里通常带 registry 元数据
      const toolComfy =
        /\[tool\.comfy\][\s\S]*?(?=\n\[|$)/.exec(text)?.[0] ?? "";

      const comfyName = /^\s*DisplayName\s*=\s*["']([^"']*)["']/m.exec(
        toolComfy
      )?.[1];

      const comfyId = /^\s*id\s*=\s*["']([^"']*)["']/m.exec(toolComfy)?.[1];

      return {
        displayName: comfyName ?? displayName,
        version,
        description,
        registryId: comfyId ?? projectName,
      };
    } catch {
      return blank;
    }
  }

  return blank;
}

/** 读取 requirements.txt 中的声明行（注释与 pip 选项行已剔除） */
export async function readRequirements(dir: string): Promise<string[]> {
  const file = join(dir, "requirements.txt");

  if (!(await pathExists(file))) {
    return [];
  }
  try {
    return parseRequirements(await readFile(file, "utf-8"));
  } catch {
    return [];
  }
}

export function parseRequirements(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("-"));
}

/**
 * 直接引用：pip 按地址去 clone 仓库或读本地目录，不拿包名查索引。
 * 例：`git+https://github.com/facebookresearch/sam2`（Impact Pack 的 SAM 2 就是这么装的）。
 */
const DIRECT_REF = /^(?:(?:git|hg|svn|bzr)\+|https?:\/\/|file:|\.{1,2}[\\/])/i;

export function isDirectRequirement(raw: string): boolean {
  return DIRECT_REF.test(raw.trim());
}

type RequirementKind = "package" | "source";

export interface RequirementEntry {
  /** package：按包名走索引；source：直接引用仓库或本地目录 */
  kind: RequirementKind;
  /** 包名（小写、去 extras）；source 为空串 */
  name: string;
  /** 版本约束（`>=1.0`、`==2.1,!=2.2`）；不写约束或 source 时为空串 */
  spec: string;
  /** 交给 `pip install` 的完整规格 */
  install: string;
  /** 原始声明行 */
  raw: string;
}

/**
 * 直接引用的归一化地址：去掉 `git+` 之类的前缀、`#egg=` 片段与 `@修订号`。
 * pip 记进 direct_url.json 的 url 就是这一份，装没装靠它比对。
 */
function directUrlOf(ref: string): string | null {
  const bare = ref
    .trim()
    .split("#")[0]
    .trim()
    .replace(/^(?:git|hg|svn|bzr)\+/i, "");
  // `@` 后面是分支/标签/提交，不是地址的一部分
  const repo = bare.replace(/@[^/@]+$/, "");

  return /^(?:https?|ssh|git|file):\/\//i.test(repo) ? repo : null;
}

/** 地址比对前统一大小写、`.git` 后缀与结尾斜杠 */
function normalizeSourceUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

/** 直接引用的展示名：地址最后两段（`facebookresearch/sam2`） */
export function sourceLabel(ref: string): string {
  const path = ref
    .trim()
    .split("#")[0]
    .replace(/^(?:git|hg|svn|bzr)\+/i, "")
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\.git$/i, "")
    .replace(/[\\/]+$/, "");
  const parts = path.split(/[\\/]/).filter((p) => p.length > 0);

  return parts.slice(-2).join("/") || ref.trim();
}

/** 包名与仓库名比对用：只留字母数字（`SAM-2` 与 `sam2` 视为同一个） */
function lettersOf(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

/** 解析一条依赖声明：包依赖拆成 名称/约束/完整规格，直接引用整行交给 pip */
export function parseRequirement(raw: string): RequirementEntry {
  const line = raw.trim();

  if (isDirectRequirement(line)) {
    // 地址里没有空白，`;` 只可能引入环境标记
    const install = line.split(";")[0].trim();

    return {
      kind: "source",
      name: "",
      spec: "",
      install,
      raw: line,
    };
  }

  const cleaned = line.split("#")[0].split(";")[0].trim();
  const m = /^([A-Za-z0-9._-]+)(\s*\[[^\]]*\])?(.*)$/.exec(cleaned);

  return {
    kind: "package",
    name: (m?.[1] ?? cleaned).toLowerCase().replaceAll("_", "-"),
    spec: (m?.[3] ?? "").trim(),
    install: cleaned,
    raw: line,
  };
}

export function toRequirementEntries(lines: string[]): RequirementEntry[] {
  return lines.map(parseRequirement);
}

/** 已安装的发行信息：归一化包名 → 版本，direct_url.json 地址 → 版本 */
export interface InstalledDists {
  versions: Record<string, string>;
  directUrls: Record<string, string>;
}

/**
 * 直接引用装没装、装的是哪个版本。
 * 先比对 direct_url.json 的地址；对不上再按包名比对 —— 手动 `pip install .` 装源码包时
 * 记的是本地路径，和声明里的 git 地址不同，但发行包名与仓库名一致。
 * 相对路径这类没有地址的直接引用只能走包名那一趟。
 */
export function installedSourceVersion(
  ref: string,
  dists: InstalledDists
): string | null {
  const url = directUrlOf(ref) ?? ref.trim();
  const want = normalizeSourceUrl(url);

  for (const [recorded, version] of Object.entries(dists.directUrls)) {
    if (normalizeSourceUrl(recorded) === want) {
      return version;
    }
  }

  const repo = lettersOf(sourceLabel(url).split("/").at(-1) ?? "");

  if (repo) {
    for (const [name, version] of Object.entries(dists.versions)) {
      if (lettersOf(name) === repo) {
        return version;
      }
    }
  }

  return null;
}
