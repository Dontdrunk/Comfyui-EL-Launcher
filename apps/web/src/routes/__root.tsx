import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";

import App from "#src/launcher/App.tsx";
import { onHostNavigate } from "#src/launcher/store.ts";

interface RouterContext {
  queryClient: QueryClient;
}

const RootLayout = () => {
  const navigate = useNavigate();

  // 主进程（托盘菜单）发起的跳转：只把意图翻译成一次路由导航
  useEffect(
    () =>
      onHostNavigate((page) => {
        void navigate({ to: `/${page}` });
      }),
    [navigate]
  );

  return (
    <>
      <HeadContent />
      <App>
        <Outlet />
      </App>
    </>
  );
};

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [{ title: "探索者启动器" }],
  }),
  component: RootLayout,
});
