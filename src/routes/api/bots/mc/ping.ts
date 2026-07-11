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

async function pingMcServer(
  host: string,
  port = 25565,
): Promise<{
  online: boolean;
  version?: string;
  players?: { online: number; max: number };
  motd?: string;
  latency?: number;
  software?: string;
  plugins?: { name: string; version: string }[];
  error?: string;
}> {
  const start = Date.now();
  try {
    const address = port === 25565 ? host : `${host}:${port}`;
    const res = await fetch(`https://api.mcsrvstat.us/3/${address}`, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "LuauX-Bot-Manager/1.0" },
    });
    const latency = Date.now() - start;

    if (!res.ok) return { online: false, error: `HTTP ${res.status}` };
    const data = await res.json();

    if (!data || data.online !== true) return { online: false, error: data?.debug ? "Offline" : "No response" };

    let motd: string | undefined;
    if (typeof data.motd === "string") {
      motd = data.motd;
    } else if (data.motd?.clean) {
      motd = Array.isArray(data.motd.clean) ? data.motd.clean.join("\n") : data.motd.clean;
    } else if (data.motd?.raw) {
      motd = Array.isArray(data.motd.raw) ? data.motd.raw.join("\n") : data.motd.raw;
    }

    return {
      online: true,
      version: data.version || undefined,
      players: data.players
        ? { online: data.players.online ?? 0, max: data.players.max ?? 0 }
        : undefined,
      motd,
      latency,
      software: data.software || undefined,
      plugins: Array.isArray(data.plugins) ? data.plugins : undefined,
    };
  } catch (e) {
    return { online: false, error: e instanceof Error ? e.message : String(e) };
  }
}
