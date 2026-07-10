import { createFileRoute } from "@tanstack/react-router";
import { pingMcServer } from "@/lib/bot-runtime/mc";

export const Route = createFileRoute("/api/bots/mc/ping")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const host = url.searchParams.get("host");
        const port = parseInt(url.searchParams.get("port") || "25565", 10);

        if (!host) return Response.json({ error: "host required" }, { status: 400 });

        const result = await pingMcServer(host, port);
        return Response.json(result);
      },
    },
  },
});
