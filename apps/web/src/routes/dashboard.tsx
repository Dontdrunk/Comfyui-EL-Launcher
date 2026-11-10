import { createFileRoute } from "@tanstack/react-router";

import Dashboard from "#src/launcher/pages/Dashboard.tsx";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});
