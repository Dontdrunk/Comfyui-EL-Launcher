import "@explorer-launcher/ui/globals.css";
// 启动器自带的三层样式：变量 → 基础 → 外壳复刻层（必须最后引入，用同名类覆盖基础层）
import "#src/launcher/styles/tokens.css";
import "#src/launcher/styles/global.css";
import "#src/launcher/styles/crazy.css";
import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";

import { createAppRouter } from "#src/router.tsx";

// EP 的暗色变量挂在 html.dark 上；本项目主题用 data-theme，两个都挂上
document.documentElement.classList.add("dark");

const router = createAppRouter();
const container = document.querySelector("#root");

if (!container) {
  throw new Error("Missing #root element");
}

// 刻意不使用 StrictMode：严格模式会重复执行副作用，
// 导致 IPC 订阅与运行时探测被执行两次，干扰日志与探测耗时。
createRoot(container).render(<RouterProvider router={router} />);
