import path from "node:path";

import { defineConfig } from "vite-plus";

const preloadDir = path.join(import.meta.dirname, "src/preload");

export default defineConfig({
  build: {
    lib: {
      // 托盘菜单是独立的上下文隔离窗口，必须有自己的 preload 入口；
      // 缺了它主界面照常启动，但点托盘图标会静默无反应。
      entry: {
        index: path.join(preloadDir, "index.ts"),
        "tray-menu": path.join(preloadDir, "tray-menu.ts"),
      },
      fileName: (_format, entryName) => `${entryName}.cjs`,
      formats: ["cjs"],
    },
    outDir: "dist/preload",
    rolldownOptions: { external: ["electron"] },
    ssr: true,
    target: "node22",
  },
  publicDir: false,
  // A sandboxed preload cannot `require()` npm packages, so it bundles everything but `electron`.
  ssr: { noExternal: true },
});
