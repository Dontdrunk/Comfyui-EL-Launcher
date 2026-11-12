import oxfmt from "ultracite/oxfmt";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import shadcn from "ultracite/oxlint/shadcn";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";
import { defineConfig } from "vite-plus";

const generatedFiles = ["**/routeTree.gen.ts"];

const vendoredFiles = [
  "packages/ui/src/components/**",
  "packages/ui/src/hooks/**",
];

export default defineConfig({
  fmt: {
    ...oxfmt,
    ignorePatterns: [...(oxfmt.ignorePatterns ?? []), ...generatedFiles],
    proseWrap: "preserve",
    sortImports: {
      customGroups: [
        {
          elementNamePattern: ["@explorer-launcher/**"],
          groupName: "workspace",
        },
      ],
      groups: [
        "builtin",
        "external",
        "workspace",
        ["internal", "subpath"],
        ["parent", "sibling", "index"],
        "style",
        "unknown",
      ],
    },
  },
  lint: {
    extends: [core, react, tanstack, shadcn, vitest, antiSlop],
    ignorePatterns: [
      ...(core.ignorePatterns ?? []),
      ...generatedFiles,
      ...vendoredFiles,
    ],
    jsPlugins: [
      // Knip reads this string. A spread of `shadcn.jsPlugins` is invisible to it.
      { name: "shadcn", specifier: "@shadcn/lint" },
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
    ],
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        // A loader throws `notFound()` and `beforeLoad` throws `redirect()`. Both are objects rather than an `Error`.
        files: ["apps/web/src/routes/**"],
        rules: {
          "typescript/only-throw-error": [
            "error",
            {
              allow: [
                {
                  from: "package",
                  name: "NotFoundError",
                  package: "@tanstack/router-core",
                },
                {
                  from: "package",
                  name: "Redirect",
                  package: "@tanstack/router-core",
                },
              ],
            },
          ],
        },
      },
      {
        // 停服确认弹窗复用迁移过来的全局按钮类（.btn / .btn--danger），
        // 它们来自 launcher/styles/global.css，不是 Tailwind 生成的工具类。
        files: ["apps/web/src/components/service-stop-guard.tsx"],
        rules: {
          "shadcn/no-unknown-classes": "off",
        },
      },
      {
        // 模型页快捷卡片复用仪表台的样式类（.btn / .section-title），
        // 以及同目录 model-shortcuts.css 里的自有类，均不是 Tailwind 工具类。
        // 事件里的异步动作沿用 launcher 的 void 写法显式忽略 Promise。
        files: ["apps/web/src/components/model-shortcuts.tsx"],
        rules: {
          "shadcn/no-unknown-classes": "off",
          "eslint/no-void": "off",
        },
      },
      {
        // 自更新弹窗沿用仪表台的类名体系，.update / .update__* 定义在
        // 同目录 self-update-dialog.css，不是 Tailwind 生成的工具类。
        files: ["apps/web/src/components/self-update-dialog.tsx"],
        rules: {
          "shadcn/no-unknown-classes": "off",
        },
      },
      {
        // 进度窗口是独立页面，.upd / .upd__* 定义在同目录 update-progress.css；
        // 进度条宽度是唯一的内联样式，按真实百分比给。
        files: ["apps/web/src/components/update-progress.tsx"],
        rules: {
          "shadcn/no-unknown-classes": "off",
          "shadcn/no-inline-styles": "off",
        },
      },
      {
        // 旧项目原样迁入的代码：格式化和类型检查照跑，风格类规则先豁免。
        // 这是搬运而不是重写——1.7 万行一次性改成 ultracite 风格不现实，
        // 但真正会出 BUG 的规则（hook 依赖、eqeqeq、未使用变量、类型错误）保持开启。
        // 新代码不要放进这些目录；后续按模块逐个「毕业」出豁免区。
        files: [
          "apps/web/src/launcher/**",
          "apps/desktop/src/main/lib/**",
          "apps/desktop/src/main/services/**",
          "apps/desktop/src/main/index.ts",
          "apps/desktop/src/main/window.ts",
          "apps/desktop/src/main/ipc*.ts",
          "apps/desktop/src/main/tray*.ts",
          "apps/desktop/src/preload/**",
          "packages/electron/src/**",
        ],
        rules: {
          "anti-slop/no-array-filter-map": "off",
          "anti-slop/no-chained-type-assertions": "off",
          "anti-slop/no-known-value-widening": "off",
          "anti-slop/no-runtime-typeof": "off",
          "anti-slop/no-shape-in-symbol-names": "off",
          "anti-slop/no-unknown-parameters": "off",
          "anti-slop/no-unsafe-dictionary-type": "off",
          "anti-slop/require-readable-spacing": "off",
          "anti-slop/require-safety-comment-for-type-assertion": "off",
          "eslint/class-methods-use-this": "off",
          "eslint/complexity": "off",
          "eslint/curly": "off",
          "eslint/func-style": "off",
          "eslint/no-alert": "off",
          "eslint/no-await-in-loop": "off",
          "eslint/no-bitwise": "off",
          "eslint/no-control-regex": "off",
          "eslint/no-negated-condition": "off",
          "eslint/no-nested-ternary": "off",
          "eslint/no-plusplus": "off",
          "eslint/no-promise-executor-return": "off",
          "eslint/no-use-before-define": "off",
          "eslint/no-void": "off",
          "eslint/prefer-destructuring": "off",
          "eslint/prefer-named-capture-group": "off",
          "eslint/prefer-template": "off",
          "eslint/require-await": "off",
          "eslint/require-unicode-regexp": "off",
          "jsdoc/require-param-description": "off",
          "jsdoc/require-returns-description": "off",
          "node/callback-return": "off",
          "promise/always-return": "off",
          "promise/avoid-new": "off",
          "promise/param-names": "off",
          "promise/prefer-await-to-callbacks": "off",
          "react/function-component-definition": "off",
          "react/immutability": "off",
          "react/jsx-no-useless-fragment": "off",
          "react/refs": "off",
          "react/set-state-in-effect": "off",
          "react/todo": "off",
          "shadcn/no-inline-styles": "off",
          "shadcn/no-unknown-classes": "off",
          "typescript/consistent-return": "off",
          "typescript/method-signature-style": "off",
          "typescript/no-base-to-string": "off",
          "typescript/no-confusing-void-expression": "off",
          "typescript/no-misused-spread": "off",
          "typescript/no-redundant-type-constituents": "off",
          "typescript/no-unnecessary-type-assertion": "off",
          "typescript/no-unnecessary-type-conversion": "off",
          "typescript/no-unnecessary-type-parameters": "off",
          "typescript/no-unsafe-argument": "off",
          "typescript/no-unsafe-assignment": "off",
          "typescript/no-unsafe-call": "off",
          "typescript/no-unsafe-member-access": "off",
          "typescript/no-unsafe-return": "off",
          "typescript/no-unsafe-type-assertion": "off",
          "typescript/prefer-nullish-coalescing": "off",
          "typescript/return-await": "off",
          "typescript/strict-boolean-expressions": "off",
          "typescript/strict-void-return": "off",
          "typescript/use-unknown-in-catch-callback-variable": "off",
          "unicorn/catch-error-name": "off",
          "unicorn/consistent-function-scoping": "off",
          "unicorn/filename-case": "off",
          "unicorn/import-style": "off",
          "unicorn/no-array-for-each": "off",
          "unicorn/no-array-reverse": "off",
          "unicorn/no-array-sort": "off",
          "unicorn/no-await-expression-member": "off",
          "unicorn/no-negated-condition": "off",
          "unicorn/no-useless-collection-argument": "off",
          "unicorn/no-useless-promise-resolve-reject": "off",
          "unicorn/no-useless-undefined": "off",
          "unicorn/numeric-separators-style": "off",
          "unicorn/prefer-array-find": "off",
          "unicorn/prefer-export-from": "off",
          "unicorn/prefer-logical-operator-over-ternary": "off",
          "unicorn/prefer-math-trunc": "off",
          "unicorn/prefer-native-coercion-functions": "off",
          "unicorn/prefer-spread": "off",
          "unicorn/prefer-type-error": "off",
          "jsx-a11y/label-has-associated-control": "off",
          "jsx-a11y/control-has-associated-label": "off",
          "jsx-a11y/prefer-tag-over-role": "off",
          "jsx-a11y/no-static-element-interactions": "off",
          "eslint/no-empty-function": "off",
          "vitest/consistent-test-it": "off",
          "vitest/require-top-level-describe": "off",
          "vite-plus/prefer-vite-plus-imports": "off",
        },
      },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
  },
  staged: {
    "*": "vp check --fix",
  },
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          include: [
            "apps/desktop/src/**/*.test.ts",
            "packages/*/src/**/*.test.ts",
          ],
          name: "unit",
        },
      },
    ],
  },
});
