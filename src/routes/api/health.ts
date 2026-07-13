import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { envStr } from "@/lib/luaux-server.server";

/** Public health check for uptime / worker dependency. No auth. */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const started = Date.now();
        let db: "ok" | "error" | "skipped" = "skipped";
        const url = envStr("SUPABASE_URL");
        const key = envStr("SUPABASE_SERVICE_ROLE_KEY");
        if (url && key) {
          try {
            const client = createClient(url, key, {
              auth: { persistSession: false, autoRefreshToken: false },
            });
            const { error } = await client.from("plans").select("id").limit(1);
            db = error ? "error" : "ok";
          } catch {
            db = "error";
          }
        }
        const ok = db !== "error";
        return Response.json(
          {
            ok,
            ts: new Date().toISOString(),
            ms: Date.now() - started,
            db,
            site: envStr("SITE_URL") || null,
          },
          { status: ok ? 200 : 503 },
        );
      },
    },
  },
});
