import { createStart, createMiddleware } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { sessionConfig } from "@/lib/luaux-server.server";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

const EXEMPT_PREFIXES = [
  "/",
  "/vpn-blocked",
  "/account-banned",
  "/api/discord/",
  "/api/bots/",
  "/api/me",
];

function isExemptPath(pathname: string): boolean {
  if (EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return true;
  if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map|webp|avif)$/.test(pathname)) return true;
  return false;
}

const vpnMiddleware = createMiddleware().server(async ({ next, request }) => {
  const url = new URL(request.url);
  if (!isExemptPath(url.pathname)) {
    try {
      const session = await useSession<{
        user?: { id: string };
        isAdmin?: boolean;
        vpnBlocked?: boolean;
      }>(sessionConfig());
      if (session.data.vpnBlocked === true) {
        return new Response(null, {
          status: 302,
          headers: { Location: "/vpn-blocked" },
        });
      }
    } catch {
      /* session read failed — let request through */
    }
  }
  return next();
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, vpnMiddleware],
}));
