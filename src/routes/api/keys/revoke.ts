import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized, forbidden } from "@/lib/api-helpers";
import { isAdminSession } from "@/lib/luaux-server.server";

export const Route = createFileRoute("/api/keys/revoke")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return unauthorized();
        const isAdm = await isAdminSession();
        if (!isAdm) return forbidden("Admin only");

        let body: { key_id?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (!body.key_id) {
          return Response.json({ error: "key_id required" }, { status: 400 });
        }

        const db = admin();

        // Set expires_at to now to effectively revoke the key
        const { error } = await db
          .from("verification_keys")
          .update({ expires_at: new Date().toISOString() })
          .eq("id", body.key_id);

        if (error) {
          return Response.json({ error: error.message }, { status: 500 });
        }

        return Response.json({ ok: true });
      },
    },
  },
});
