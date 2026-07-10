import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";

const cfg = () => ({
  password: process.env.SESSION_SECRET!,
  name: "luaux_session",
  maxAge: 60 * 60 * 24 * 30,
});

type StoredUser = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
};

export const Route = createFileRoute("/api/me")({
  server: {
    handlers: {
      GET: async () => {
        const session = await useSession<{ user?: StoredUser }>(cfg());
        return Response.json({ user: session.data.user ?? null });
      },
    },
  },
});