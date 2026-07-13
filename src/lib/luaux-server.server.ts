import { useSession } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

export type LuauxSessionUser = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
};

type SessionData = { oauth_state?: string; user?: LuauxSessionUser; isAdmin?: boolean; vpnBlocked?: boolean };

/** Strip accidental quotes from env values (common when pasting into Vercel/CLI) */
export function envStr(name: string, fallback = ""): string {
  const raw = process.env[name] ?? fallback;
  let v = String(raw).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

export function siteOrigin(request?: Request): string {
  const site = envStr("SITE_URL").replace(/\/$/, "");
  if (site) return site;
  if (request) {
    const xfHost = request.headers.get("x-forwarded-host");
    const xfProto = request.headers.get("x-forwarded-proto") || "https";
    if (xfHost) return `${xfProto}://${xfHost}`.replace(/\/$/, "");
    try {
      return new URL(request.url).origin.replace(/\/$/, "");
    } catch {
      /* ignore */
    }
  }
  return "";
}

/** Session lifetime: 90 days so signed-in users stay logged in across visits */
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 90;

export const sessionConfig = () => {
  const secret = envStr("SESSION_SECRET");
  if (!secret) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      throw new Error("SESSION_SECRET is required in production");
    }
  }
  return {
    password: secret || "dev-only-session-secret-change-me-32b",
    name: "luaux_session",
    maxAge: SESSION_MAX_AGE_SEC,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
      maxAge: SESSION_MAX_AGE_SEC,
    },
  };
};

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

export async function isAdminSession(): Promise<boolean> {
  const data = await getSessionData();
  if (data.isAdmin !== true) return false;
  const user = data.user;
  if (!user?.id) return false;
  // Must re-validate against admins table — never trust cookie alone
  try {
    const { data: row } = await admin()
      .from("admins")
      .select("discord_id")
      .eq("discord_id", user.id)
      .maybeSingle();
    return !!row;
  } catch {
    return false;
  }
}

/** Strip secrets from bot job config before sending to browser */
export function redactJobConfig(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== "object") return {};
  const c = { ...(config as Record<string, unknown>) };
  const secretKeys = [
    "ssid",
    "token",
    "botToken",
    "bot_token",
    "accessToken",
    "password",
    "flowToken",
    "code",
  ];
  for (const k of secretKeys) {
    if (k in c && c[k]) c[k] = "[redacted]";
  }
  return c;
}

export function admin() {
  return createClient(envStr("SUPABASE_URL"), envStr("SUPABASE_SERVICE_ROLE_KEY"), {
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

export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
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
