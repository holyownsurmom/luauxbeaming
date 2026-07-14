import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { envStr } from "@/lib/luaux-server.server";

/** Public health check for uptime / worker dependency. No auth. No secrets in response. */
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
        } else {
          db = "error";
        }

        // Do not expose which secrets are configured (recon aid)
        const envOk =
          !!envStr("SITE_URL") &&
          !!envStr("SESSION_SECRET") &&
          !!envStr("WORKER_SECRET") &&
          !!(url && key);
        const ok = db === "ok" && envOk;

        return Response.json(
          {
            ok,
            ts: new Date().toISOString(),
            ms: Date.now() - started,
            db,
          },
          { status: ok ? 200 : 503 },
        );
      },
    },
  },
});
