import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react({ compiler: true }),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      // 主界面 + 自更新进度窗口：后者是独立的小窗口，不挂路由与外壳
      input: {
        main: "index.html",
        update: "update.html",
      },
    },
  },
});
