import { useSession } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { sessionConfig, type SessionData, type SessionUser } from "./session";

export type LuauxSessionUser = SessionUser;

export async function getSessionUser(): Promise<LuauxSessionUser | null> {
  const session = await useSession<SessionData>(sessionConfig());
  return session.data.user ?? null;
}

export async function getSessionData(): Promise<SessionData> {
  const session = await useSession<SessionData>(sessionConfig());
  return session.data;
}

export async function requireUser(): Promise<LuauxSessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export function admin() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function ensureProfile(user: LuauxSessionUser) {
  const db = admin();
  const { error } = await db.from("profiles").upsert(
    {
      discord_id: user.id,
      username: user.username,
      global_name: user.global_name,
      avatar_url: user.avatar,
    },
    { onConflict: "discord_id" },
  );
  if (error) {
    console.error("[ensureProfile] upsert failed:", error.message, error.details, error.hint);
  }
}