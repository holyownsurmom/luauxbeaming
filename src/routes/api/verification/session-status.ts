import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function authWorker(request: Request): boolean {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return false;
  const token = request.headers.get("x-worker-secret") || "";
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const ALLOWED = new Set(["failed", "otp_sent", "secured"]);

/** Worker updates verification_sessions when secure jobs fail/timeout so UI is not stuck. */
export const Route = createFileRoute("/api/verification/session-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authWorker(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let body: { session_id?: string; status?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const sessionId = body.session_id?.trim();
        const status = body.status?.trim();
        if (!sessionId || !status || !ALLOWED.has(status)) {
          return Response.json({ error: "session_id and valid status required" }, { status: 400 });
        }

        const { error } = await db()
          .from("verification_sessions")
          .update({ status })
          .eq("id", sessionId);

        if (error) {
          console.error("[session-status] update failed:", error.message);
          return Response.json({ error: error.message }, { status: 500 });
        }

        return Response.json({ ok: true });
      },
    },
  },
});
