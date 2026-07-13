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

        const checks = {
          site_url: !!envStr("SITE_URL"),
          session_secret: !!envStr("SESSION_SECRET"),
          worker_secret: !!envStr("WORKER_SECRET"),
          supabase: !!(url && key),
          discord_bot: !!envStr("DISCORD_BOT_TOKEN"),
          discord_public_key: !!envStr("DISCORD_PUBLIC_KEY"),
        };
        const envOk = checks.site_url && checks.session_secret && checks.worker_secret && checks.supabase;
        const ok = db === "ok" && envOk;

        return Response.json(
          {
            ok,
            ts: new Date().toISOString(),
            ms: Date.now() - started,
            db,
            site: envStr("SITE_URL") || null,
            env: checks,
          },
          { status: ok ? 200 : 503 },
        );
      },
    },
  },
});
