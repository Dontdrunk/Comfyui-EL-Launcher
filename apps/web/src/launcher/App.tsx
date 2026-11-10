import { useEffect } from "react";
import type { ReactNode } from "react";

import { Logo } from "./components/Brand";
import { Sidebar } from "./components/Sidebar";
import { StatusRail } from "./components/StatusRail";
import { TitleBar } from "./components/TitleBar";
import { Toasts } from "./components/Toasts";
import { Notice } from "./components/ui";
import { useApp } from "./store";

/** 引导中：一行状态 + 发丝进度线，不做开机动画 */
function Splash(): React.JSX.Element {
  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        placeItems: "center",
        background: "var(--bg-canvas)",
        color: "var(--fg-muted)",
      }}
    >
      <div style={{ width: 220, textAlign: "center" }}>
        <div
          style={{
            color: "var(--brand)",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <Logo size={32} />
        </div>
        <div style={{ marginTop: 12, fontSize: "var(--fs-sm)" }}>
          正在读取配置…
        </div>
        <div
          className="progress progress--indeterminate"
          style={{ marginTop: 10 }}
        >
          <div className="progress__bar" />
        </div>
      </div>
    </div>
  );
}

/**
 * 应用外壳：标题栏 / 侧栏 / 状态条 / 轻提示。
 * 页面内容由路由 `<Outlet />` 注入，外壳不再自己记录当前页面。
 */
export default function App({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const booted = useApp((s) => s.booted);
  const bootError = useApp((s) => s.bootError);

  useEffect(() => {
    void useApp.getState().boot();
  }, []);

  if (!booted) {
    return <Splash />;
  }

  return (
    <div className="app">
      <TitleBar />
      <div className="app__body">
        <Sidebar />
        <main className="app__main">
          <div className="app__page">
            {bootError && (
              <div style={{ marginBottom: "var(--sp-4)" }}>
                <Notice tone="error" title="启动异常">
                  {bootError}
                </Notice>
              </div>
            )}
            {children}
          </div>
        </main>
      </div>
      <StatusRail />
      <Toasts />
    </div>
  );
}
