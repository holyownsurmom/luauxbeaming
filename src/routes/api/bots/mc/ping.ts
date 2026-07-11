import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, unauthorized } from "@/lib/api-helpers";

const PRIVATE_IP_RE =
  /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|localhost|::1|169\.254\.|metadata\.google)/i;

export const Route = createFileRoute("/api/bots/mc/ping")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        const url = new URL(request.url);
        const host = url.searchParams.get("host");
        const port = parseInt(url.searchParams.get("port") || "25565", 10);

        if (!host) return Response.json({ error: "host required" }, { status: 400 });
        if (host.length > 255) return Response.json({ error: "host too long" }, { status: 400 });
        if (PRIVATE_IP_RE.test(host)) {
          return Response.json({ error: "private/reserved hosts not allowed" }, { status: 403 });
        }

        const result = await pingMcServer(host, port);
        return Response.json(result);
      },
    },
  },
});

async function pingMcServer(host: string, port = 25565): Promise<{
  online: boolean;
  version?: string;
  players?: { online: number; max: number };
  motd?: string;
  latency?: number;
}> {
  const start = Date.now();
  try {
    const res = await fetch(`https://api.mcsrvstat.us/2/${host}:${port}`, {
      signal: AbortSignal.timeout(8000),
    });
    const latency = Date.now() - start;

    if (!res.ok) return { online: false };
    const data = await res.json();

    if (!data || data.online !== true) return { online: false };

    return {
      online: true,
      version: data.version || undefined,
      players: data.players
        ? { online: data.players.online ?? 0, max: data.players.max ?? 0 }
        : undefined,
      motd: typeof data.motd === "string"
        ? data.motd
        : data.motd?.clean || data.motd?.html || undefined,
      latency,
    };
  } catch {
    return { online: false };
  }
}
