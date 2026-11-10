import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * 对比度守卫。
 *
 * 读 tokens.css，解析两套主题的语义令牌，按 WCAG 计算关键配对的对比度：
 * 正文/小字 4.5:1，非文字（焦点环、滚动条）3:1。
 * 只用实色令牌配对 —— color-mix 的结果无法静态解析，相关配对不在检查范围。
 */
const tokensPath = fileURLToPath(
  new URL("../apps/web/src/launcher/styles/tokens.css", import.meta.url)
);

type Tokens = Map<string, string>;

type Rgb = readonly [number, number, number];

const base: Tokens = new Map();
const dark: Tokens = new Map();
const light: Tokens = new Map();

const blockPattern = /(?<selector>[^{}]+)\{(?<body>[^{}]*)\}/gu;
const declarationPattern = /(?<name>--[\w-]+)\s*:\s*(?<value>[^;]+);/gu;
const referencePattern = /^var\((?<name>--[\w-]+)\)$/u;
const hexPattern = /^[0-9a-f]{6}$/iu;

const scopeOf = (selector: string): Tokens | null => {
  if (selector.includes("data-theme='dark'")) {
    return dark;
  }

  if (selector.includes("data-theme='light'")) {
    return light;
  }

  if (selector.includes(":root")) {
    return base;
  }

  return null;
};

const parseBlocks = (css: string) => {
  for (const block of css.matchAll(blockPattern)) {
    const scope = scopeOf(block.groups?.selector ?? "");
    const body = block.groups?.body ?? "";

    if (scope === null) {
      continue;
    }

    for (const declaration of body.matchAll(declarationPattern)) {
      const name = declaration.groups?.name;
      const value = declaration.groups?.value;

      if (name !== undefined && value !== undefined) {
        scope.set(name, value.trim());
      }
    }
  }
};

const resolveToken = (
  name: string,
  scope: Tokens,
  depth = 0
): string | null => {
  const raw = scope.get(name) ?? base.get(name);

  if (raw === undefined || depth > 8) {
    return null;
  }

  const reference = referencePattern.exec(raw);
  const referenced = reference?.groups?.name;

  return referenced === undefined
    ? raw
    : resolveToken(referenced, scope, depth + 1);
};

const toRgb = (value: string): Rgb | null => {
  const hex = value.trim().replace(/^#/u, "");

  const complete =
    hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : hex.slice(0, 6);

  if (!hexPattern.test(complete)) {
    return null;
  }

  return [
    Number.parseInt(complete.slice(0, 2), 16),
    Number.parseInt(complete.slice(2, 4), 16),
    Number.parseInt(complete.slice(4, 6), 16),
  ];
};

const linearize = (channel: number) => {
  const value = channel / 255;

  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const luminance = ([red, green, blue]: Rgb) =>
  0.2126 * linearize(red) +
  0.7152 * linearize(green) +
  0.0722 * linearize(blue);

const contrast = (foreground: Rgb, background: Rgb) => {
  const first = luminance(foreground);
  const second = luminance(background);
  const [high, low] = first > second ? [first, second] : [second, first];

  return (high + 0.05) / (low + 0.05);
};

type Check = readonly [
  label: string,
  note: string,
  foreground: string,
  background: string,
  threshold: number,
];

const checks: readonly Check[] = [
  ["主按钮文字 / 填充", "button label", "--accent-fg", "--accent-strong", 4.5],
  [
    "主按钮文字 / 填充 hover",
    "button label hover",
    "--accent-fg",
    "--accent-strong-hover",
    4.5,
  ],
  [
    "停止按钮文字 / 填充",
    "stop button label",
    "--accent-fg",
    "--danger-solid",
    4.5,
  ],
  ["品牌标识文字", "brand text", "--accent-line", "--bg-app", 4.5],
  ["页标题", "page title", "--fg", "--bg-canvas", 4.5],
  ["正文", "body text", "--fg", "--bg-surface", 4.5],
  ["微波标签", "micro label", "--fg-muted", "--bg-surface", 4.5],
  ["次要文字 / 应用底", "muted on app bg", "--fg-muted", "--bg-app", 4.5],
  ["读数提示", "readout hint", "--fg-muted", "--bg-surface", 4.5],
  ["表格正文", "table body", "--fg", "--bg-surface", 4.5],
  ["表头 / 行悬浮底", "table head on hover", "--fg-muted", "--bg-hover", 4.5],
  ["标签-正常", "tag ok", "--ok-text", "--bg-surface", 4.5],
  ["标签-警告", "tag warn", "--warn-text", "--bg-surface", 4.5],
  ["标签-错误", "tag error", "--danger-text", "--bg-surface", 4.5],
  ["标签-强调", "tag accent", "--accent-line", "--bg-surface", 4.5],
  ["行内错误文字", "terminal stderr", "--danger-text", "--bg-terminal", 4.5],
  ["日志时间戳", "terminal timestamp", "--fg-muted", "--bg-terminal", 4.5],
  ["输入占位符", "placeholder", "--fg-muted", "--bg-input", 4.5],
  ["焦点环（非文字）", "focus ring", "--accent-line", "--bg-canvas", 3],
  [
    "滚动条滑块（非文字）",
    "scrollbar thumb",
    "--scrollbar-thumb",
    "--bg-surface",
    3,
  ],
];

const write = (line: string) => process.stdout.write(`${line}\n`);

parseBlocks(await readFile(tokensPath, "utf-8"));

let failures = 0;

for (const [theme, scope] of [
  ["暗色", dark],
  ["亮色", light],
] as const) {
  write(`\n── ${theme}主题 ──`);

  for (const [label, note, foreground, background, threshold] of checks) {
    const foregroundRgb = toRgb(resolveToken(foreground, scope) ?? "");
    const backgroundRgb = toRgb(resolveToken(background, scope) ?? "");

    if (foregroundRgb === null || backgroundRgb === null) {
      write(
        `  ?  ${label.padEnd(20)} 无法静态解析 (${foreground}, ${background})`
      );
      continue;
    }

    const ratio = contrast(foregroundRgb, backgroundRgb);
    const passed = ratio >= threshold;

    if (!passed) {
      failures += 1;
    }

    write(
      `  ${passed ? "✓" : "✗"}  ${label.padEnd(20)} ${ratio.toFixed(2)}:1  (需 ${threshold}:1)  ${note}`
    );
  }
}

write(
  failures === 0
    ? "\n[check-contrast] 全部通过\n"
    : `\n[check-contrast] ${failures} 项不达标\n`
);

if (failures > 0) {
  process.exitCode = 1;
}
