import path from "node:path";

import { defineConfig } from "vite-plus";

export default defineConfig({
  build: {
    lib: {
      entry: path.join(import.meta.dirname, "src/main/index.ts"),
      fileName: () => "index.js",
      formats: ["es"],
    },
    outDir: "dist/main",
    rolldownOptions: { external: ["electron"] },
    ssr: true,
    target: "node22",
  },
  publicDir: false,
  // asar 里没有 node_modules：主进程必须自带全部依赖，只把 electron 留给运行时。
  // 少一个没打进去的 import，装完后第一次启动就是 ERR_MODULE_NOT_FOUND。
  ssr: { noExternal: true },
});
