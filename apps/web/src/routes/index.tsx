import { createFileRoute, redirect } from "@tanstack/react-router";

/** 应用常驻在一个壳里：根路径直接落到首页。 */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
