import { createFileRoute } from "@tanstack/react-router";

import Models from "#src/launcher/pages/Models.tsx";

export const Route = createFileRoute("/models")({
  component: Models,
});
