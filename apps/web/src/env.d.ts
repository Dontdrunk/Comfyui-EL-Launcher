import type { LauncherApi } from "@explorer-launcher/electron";

declare global {
  interface Window {
    launcher: LauncherApi;
  }
}
