/**
 * Optional Microsoft refresh_token → Minecraft Services access_token.
 * When no refresh_token is stored, callers keep using pasted SSID only.
 *
 * Uses the public Minecraft Nintendo Switch client id (same family as prismarine-auth).
 * Never required — full backwards compatibility with SSID-only accounts.
 */

import {
  formatUuidDashed,
  normalizeMcAccessToken,
  validateMinecraftSsid,
  type McSsidProfile,
} from "./mc-ssid.server";

const MSA_CLIENT_ID = "00000000441cc96b";
const MSA_SCOPE = "service::user.auth.xboxlive.com::MBI_SSL";

export type McRefreshOk = {
  ok: true;
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number | null;
  profile: McSsidProfile;
  uuidDashed: string;
};

export type McRefreshErr = {
  ok: false;
  error: string;
  code: "empty" | "msa" | "xbox" | "xsts" | "minecraft" | "profile" | "network" | "invalid";
  stage: string;
};

/** In-process mutex so concurrent refreshes for the same account serialize */
const refreshLocks = new Map<string, Promise<McRefreshOk | McRefreshErr>>();

export function normalizeRefreshToken(raw: string): string {
  let t = (raw || "").trim().replace(/\s+/g, "");
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

export function looksLikeRefreshToken(token: string): boolean {
  if (!token || token.length < 20) return false;
  // MSA refresh tokens are long opaque strings (often M.C… or similar)
  return token.length >= 40;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

/**
 * MSA refresh_token → Live access_token
 */
async function refreshMsaToken(
  refreshToken: string,
): Promise<
  | { ok: true; accessToken: string; refreshToken: string; expiresIn: number }
  | { ok: false; error: string; status?: number }
> {
  const body = new URLSearchParams({
    client_id: MSA_CLIENT_ID,
    scope: MSA_SCOPE,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  let lastErr = "MSA refresh failed";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetchJson("https://login.live.com/oauth20_token.srf", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const data = (r.json || {}) as Record<string, unknown>;
      if (!r.ok) {
        lastErr =
          typeof data.error_description === "string"
            ? data.error_description
            : `MSA HTTP ${r.status}`;
        // invalid_grant is permanent
        if (r.status === 400 || data.error === "invalid_grant") {
          return { ok: false, error: lastErr, status: r.status };
        }
        await sleep(400 * Math.pow(2, attempt));
        continue;
      }
      const accessToken = String(data.access_token || "");
      const newRefresh = String(data.refresh_token || refreshToken);
      const expiresIn = Number(data.expires_in) || 3600;
      if (!accessToken) return { ok: false, error: "MSA returned no access_token" };
      return { ok: true, accessToken, refreshToken: newRefresh, expiresIn };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await sleep(400 * Math.pow(2, attempt));
    }
  }
  return { ok: false, error: lastErr };
}

async function xboxAuthenticate(msaAccessToken: string): Promise<
  | { ok: true; token: string; uhs: string }
  | { ok: false; error: string }
> {
  try {
    const r = await fetchJson("https://user.auth.xboxlive.com/user/authenticate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-xbl-contract-version": "1",
      },
      body: JSON.stringify({
        Properties: {
          AuthMethod: "RPS",
          SiteName: "user.auth.xboxlive.com",
          RpsTicket: msaAccessToken,
        },
        RelyingParty: "http://auth.xboxlive.com",
        TokenType: "JWT",
      }),
    });
    const data = (r.json || {}) as {
      Token?: string;
      DisplayClaims?: { xui?: Array<{ uhs?: string }> };
    };
    if (!r.ok || !data.Token) {
      return { ok: false, error: `Xbox user auth failed (HTTP ${r.status})` };
    }
    const uhs = data.DisplayClaims?.xui?.[0]?.uhs;
    if (!uhs) return { ok: false, error: "Xbox user auth missing uhs" };
    return { ok: true, token: data.Token, uhs };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Xbox network error" };
  }
}

async function xstsAuthorize(userToken: string): Promise<
  | { ok: true; token: string; uhs: string }
  | { ok: false; error: string }
> {
  try {
    const r = await fetchJson("https://xsts.auth.xboxlive.com/xsts/authorize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-xbl-contract-version": "1",
      },
      body: JSON.stringify({
        Properties: {
          SandboxId: "RETAIL",
          UserTokens: [userToken],
        },
        RelyingParty: "rp://api.minecraftservices.com/",
        TokenType: "JWT",
      }),
    });
    const data = (r.json || {}) as {
      Token?: string;
      DisplayClaims?: { xui?: Array<{ uhs?: string }> };
      XErr?: number;
    };
    if (!r.ok || !data.Token) {
      const xerr = data.XErr ? ` XErr=${data.XErr}` : "";
      return { ok: false, error: `XSTS authorize failed (HTTP ${r.status})${xerr}` };
    }
    const uhs = data.DisplayClaims?.xui?.[0]?.uhs;
    if (!uhs) return { ok: false, error: "XSTS missing uhs" };
    return { ok: true, token: data.Token, uhs };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "XSTS network error" };
  }
}

async function loginWithXbox(
  uhs: string,
  xstsToken: string,
): Promise<{ ok: true; accessToken: string; expiresIn: number | null } | { ok: false; error: string }> {
  try {
    const r = await fetchJson(
      "https://api.minecraftservices.com/authentication/login_with_xbox",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          identityToken: `XBL3.0 x=${uhs};${xstsToken}`,
          ensureLegacyEnabled: true,
        }),
      },
    );
    const data = (r.json || {}) as { access_token?: string; expires_in?: number };
    if (!r.ok || !data.access_token) {
      return { ok: false, error: `Minecraft login_with_xbox failed (HTTP ${r.status})` };
    }
    return {
      ok: true,
      accessToken: data.access_token,
      expiresIn: typeof data.expires_in === "number" ? data.expires_in : null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Minecraft network error" };
  }
}

/**
 * Full optional refresh: MSA refresh_token → MC access_token + profile.
 */
export async function refreshMinecraftWithMsa(
  rawRefreshToken: string,
): Promise<McRefreshOk | McRefreshErr> {
  const refreshToken = normalizeRefreshToken(rawRefreshToken);
  if (!refreshToken) {
    return { ok: false, error: "Refresh token empty", code: "empty", stage: "normalize" };
  }
  if (!looksLikeRefreshToken(refreshToken)) {
    return {
      ok: false,
      error: "Refresh token looks invalid",
      code: "invalid",
      stage: "normalize",
    };
  }

  const msa = await refreshMsaToken(refreshToken);
  if (!msa.ok) {
    return {
      ok: false,
      error: `Microsoft refresh failed: ${msa.error}. Paste a new access_token or refresh_token.`,
      code: "msa",
      stage: "msa",
    };
  }

  const xbox = await xboxAuthenticate(msa.accessToken);
  if (!xbox.ok) {
    return { ok: false, error: xbox.error, code: "xbox", stage: "xbox" };
  }

  const xsts = await xstsAuthorize(xbox.token);
  if (!xsts.ok) {
    return { ok: false, error: xsts.error, code: "xsts", stage: "xsts" };
  }

  const mc = await loginWithXbox(xsts.uhs, xsts.token);
  if (!mc.ok) {
    return { ok: false, error: mc.error, code: "minecraft", stage: "minecraft" };
  }

  const profile = await validateMinecraftSsid(mc.accessToken);
  if (!profile.ok) {
    return {
      ok: false,
      error: profile.error,
      code: "profile",
      stage: "profile",
    };
  }

  return {
    ok: true,
    accessToken: normalizeMcAccessToken(mc.accessToken),
    refreshToken: msa.refreshToken || refreshToken,
    expiresInSec: mc.expiresIn ?? msa.expiresIn,
    profile: profile.profile,
    uuidDashed: profile.uuidDashed || formatUuidDashed(profile.profile.id),
  };
}

/**
 * Serialize refresh attempts per account key (race protection).
 */
export async function refreshMinecraftWithMsaLocked(
  lockKey: string,
  rawRefreshToken: string,
): Promise<McRefreshOk | McRefreshErr> {
  const existing = refreshLocks.get(lockKey);
  if (existing) return existing;

  const p = refreshMinecraftWithMsa(rawRefreshToken).finally(() => {
    refreshLocks.delete(lockKey);
  });
  refreshLocks.set(lockKey, p);
  return p;
}

/**
 * Ensure a usable MC access token.
 * 1) Validate current SSID if present
 * 2) If invalid/expired and refresh_token provided → auto-refresh
 * 3) If no refresh_token → return validation error (existing behavior)
 */
export async function ensureFreshMcAccessToken(opts: {
  accountId?: string;
  ssid?: string | null;
  refreshToken?: string | null;
}): Promise<
  | {
      ok: true;
      token: string;
      profile: McSsidProfile;
      uuidDashed: string;
      refreshed: boolean;
      refreshToken?: string | null;
      expiresInSec?: number | null;
    }
  | { ok: false; error: string; code: string; needsManual: boolean }
> {
  const ssid = opts.ssid ? normalizeMcAccessToken(opts.ssid) : "";
  const rt = opts.refreshToken ? normalizeRefreshToken(opts.refreshToken) : "";

  if (ssid) {
    const check = await validateMinecraftSsid(ssid);
    if (check.ok) {
      return {
        ok: true,
        token: check.token,
        profile: check.profile,
        uuidDashed: check.uuidDashed,
        refreshed: false,
      };
    }
    // Network blip — don't burn refresh yet if not auth failure
    if (check.code === "network" || check.code === "http") {
      if (!rt) {
        return { ok: false, error: check.error, code: check.code, needsManual: false };
      }
      // fall through to try refresh
    } else if (!rt) {
      return {
        ok: false,
        error: check.error,
        code: check.code || "expired",
        needsManual: true,
      };
    }
  } else if (!rt) {
    return {
      ok: false,
      error: "No SSID stored — paste a Minecraft access_token",
      code: "no_ssid",
      needsManual: true,
    };
  }

  if (!rt) {
    return {
      ok: false,
      error: "SSID expired and no refresh token on file",
      code: "token_expired",
      needsManual: true,
    };
  }

  const lockKey = opts.accountId || rt.slice(0, 24);
  const refreshed = await refreshMinecraftWithMsaLocked(lockKey, rt);
  if (!refreshed.ok) {
    return {
      ok: false,
      error: refreshed.error,
      code: refreshed.code,
      needsManual: refreshed.code === "msa" || refreshed.code === "invalid",
    };
  }

  return {
    ok: true,
    token: refreshed.accessToken,
    profile: refreshed.profile,
    uuidDashed: refreshed.uuidDashed,
    refreshed: true,
    refreshToken: refreshed.refreshToken,
    expiresInSec: refreshed.expiresInSec,
  };
}
