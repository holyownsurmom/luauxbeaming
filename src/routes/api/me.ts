import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, isAdminSession } from "@/lib/luaux-server.server";

export const Route = createFileRoute("/api/me")({
  server: {
    handlers: {
      GET: async () => {
        const user = await getSessionUser();
        const isAdmin = user ? await isAdminSession() : false;
        return Response.json({
          user: user ?? null,
          isAdmin,
        });
      },
    },
  },
});
