import { createFileRoute } from "@tanstack/react-router";
import { authWorker, workerDb } from "@/lib/worker-auth.server";

const db = workerDb;

export const Route = createFileRoute("/api/bots/worker/otp-result")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authWorker(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

        let body: {
          session_id?: string;
          ok?: boolean;
          security_email?: string;
          proof_id?: string;
          error?: string;
        };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (!body.session_id) {
          return Response.json({ error: "session_id required" }, { status: 400 });
        }

        const client = db();

        if (body.ok) {
          const { data, error } = await client
            .from("verification_sessions")
            .update({
              status: "otp_sent",
              error_message: null,
              security_email: body.security_email || undefined,
              flow_token: body.proof_id || undefined,
            })
            .eq("id", body.session_id)
            .in("status", ["securing", "pending"])
            .select("id")
            .maybeSingle();

          if (error) {
            console.error("[otp-result] success update failed:", error.message);
            return Response.json({ error: error.message }, { status: 500 });
          }
          return Response.json({ ok: true, updated: !!data });
        }

        const { data, error } = await client
          .from("verification_sessions")
          .update({
            status: "failed",
            error_message: (body.error || "OTP send failed").slice(0, 500),
          })
          .eq("id", body.session_id)
          .in("status", ["securing", "pending"])
          .select("id")
          .maybeSingle();

        if (error) {
          console.error("[otp-result] fail update failed:", error.message);
          return Response.json({ error: error.message }, { status: 500 });
        }
        return Response.json({ ok: true, updated: !!data });
      },
    },
  },
});
