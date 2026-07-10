import { useSession } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";

export function admin() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type SessionUser = { id: string; username: string; global_name: string | null; avatar: string | null };

type SessionData = {
  user?: SessionUser;
  isAdmin?: boolean;
};

const cfg = () => ({
  password: process.env.SESSION_SECRET!,
  name: "luaux_session",
  maxAge: 60 * 60 * 24 * 30,
});

export async function getSessionData(): Promise<SessionData> {
  const session = await useSession<SessionData>(cfg());
  return session.data;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const data = await getSessionData();
  return data.user ?? null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export async function isAdminSession(): Promise<boolean> {
  const data = await getSessionData();
  return data.isAdmin === true;
}

export async function requireAdmin(): Promise<SessionUser & { isAdmin: true }> {
  const user = await requireUser();
  const admin = await isAdminSession();
  if (!admin) throw new Error("Forbidden");
  return { ...user, isAdmin: true } as const;
}

export function notFound(msg: string) {
  return Response.json({ error: msg }, { status: 404 });
}

export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden(msg: string) {
  return Response.json({ error: msg }, { status: 403 });
}
