import { createFileRoute } from "@tanstack/react-router";
import { authWorker, workerDb } from "@/lib/worker-auth.server";

const db = workerDb;

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
