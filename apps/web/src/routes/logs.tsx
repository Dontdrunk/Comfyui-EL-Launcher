import { createFileRoute } from "@tanstack/react-router";

import Logs from "#src/launcher/pages/Logs.tsx";

export const Route = createFileRoute("/logs")({
  component: Logs,
});
