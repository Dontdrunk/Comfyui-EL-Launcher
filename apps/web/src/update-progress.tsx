import "@explorer-launcher/ui/globals.css";
import "#src/launcher/styles/tokens.css";
import "#src/launcher/styles/global.css";
import { createRoot } from "react-dom/client";

import { UpdateProgressPage } from "#src/components/update-progress.tsx";

// 独立的小窗口：只有更新进度，不挂应用外壳与路由
document.documentElement.classList.add("dark");

const container = document.querySelector("#root");

if (!container) {
  throw new Error("Missing #root element");
}

const settings = await window.launcher.getSettings();

document.documentElement.dataset.theme = settings.theme;

document.documentElement.classList.toggle("dark", settings.theme !== "light");

document.documentElement.classList.toggle("light", settings.theme === "light");

createRoot(container).render(<UpdateProgressPage />);
