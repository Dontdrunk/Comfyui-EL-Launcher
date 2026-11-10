import { createFileRoute } from "@tanstack/react-router";

import Versions from "#src/launcher/pages/Versions.tsx";

export const Route = createFileRoute("/versions")({
  component: Versions,
});
