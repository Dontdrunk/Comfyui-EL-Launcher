import { createFileRoute } from "@tanstack/react-router";

import Nodes from "#src/launcher/pages/Nodes.tsx";

export const Route = createFileRoute("/nodes")({
  component: Nodes,
});
