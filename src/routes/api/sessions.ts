import { createFileRoute } from "@tanstack/react-router";
import { getSessionData, getSessionUser, sessionConfig } from "@/lib/luaux-server.server";
import { useSession } from "@tanstack/react-start/server";

type SessionData = {
  oauth_state?: string;
  user?: { id: string; username: string; global_name: string | null; avatar: string | null };
  isAdmin?: boolean;
  vpnBlocked?: boolean;
  sessionStartedAt?: number;
  sessionLabel?: string;
};

export const Route = createFileRoute("/api/sessions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }
        const data = (await getSessionData()) as SessionData | null;
        const ua = request.headers.get("user-agent") || "Unknown browser";
        const browser = /Edg\//.test(ua)
          ? "Edge"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Firefox\//.test(ua)
              ? "Firefox"
              : /Safari\//.test(ua)
                ? "Safari"
                : "Browser";
        const os = /Windows/.test(ua)
          ? "Windows"
          : /Mac OS/.test(ua)
            ? "macOS"
            : /Android/.test(ua)
              ? "Android"
              : /iPhone|iPad/.test(ua)
                ? "iOS"
                : /Linux/.test(ua)
                  ? "Linux"
                  : "Unknown OS";

        return Response.json({
          ok: true,
          sessions: [
            {
              id: "current",
              current: true,
              label: data?.sessionLabel || `${browser} on ${os}`,
              browser,
              os,
              userId: user.id,
              username: user.global_name || user.username,
              isAdmin: !!data?.isAdmin,
              startedAt: data?.sessionStartedAt || null,
              maxAgeDays: 90,
            },
          ],
        });
      },
      /** Logout everywhere — clears the signed-in session cookie */
      DELETE: async () => {
        const user = await getSessionUser();
        if (!user) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }
        const session = await useSession<SessionData>(sessionConfig());
        await session.clear();
        return Response.json({ ok: true });
      },
    },
  },
});
