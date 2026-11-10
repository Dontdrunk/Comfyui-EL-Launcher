import { createFileRoute } from "@tanstack/react-router";

import Settings from "#src/launcher/pages/Settings.tsx";

export const Route = createFileRoute("/settings")({
  component: Settings,
});
