import { createFileRoute } from "@tanstack/react-router";

import Packages from "#src/launcher/pages/Packages.tsx";

export const Route = createFileRoute("/packages")({
  component: Packages,
});
