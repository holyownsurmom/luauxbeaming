/**
 * Server-side Minecraft SSID (access_token) helpers.
 * Production path: paste Minecraft Services JWT → validate profile → store → launch.
 * Optional MSA refresh_token (see mc-refresh.server.ts) can auto-renew expired SSIDs.
 * Without refresh_token, users re-paste when SSID expires (~24h) — unchanged behavior.
 */

export type McSsidProfile = {
  name: string;
  id: string;
  skins?: unknown[];
  capes?: unknown[];
};

export function normalizeMcAccessToken(raw: string): string {
  let t = (raw || "").trim();
  t = t.replace(/\s+/g, "");
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  if (/^bearer/i.test(t)) t = t.replace(/^bearer/i, "").trim();
  return t;
}

export function looksLikeMcToken(token: string): boolean {
  if (!token || token.length < 20) return false;
  // JWT-style (header.payload.sig) or long opaque Mojang tokens
  if (token.includes(".") && token.split(".").length >= 2) return true;
  return token.length >= 40;
}

export function formatUuidDashed(raw: string): string {
  const undashed = (raw || "").replace(/-/g, "").toLowerCase();
  if (undashed.length !== 32) return raw;
  return `${undashed.slice(0, 8)}-${undashed.slice(8, 12)}-${undashed.slice(12, 16)}-${undashed.slice(16, 20)}-${undashed.slice(20)}`;
}

export type SsidValidateOk = {
  ok: true;
  token: string;
  profile: McSsidProfile;
  uuidDashed: string;
  stage: "profile";
};

export type SsidValidateErr = {
  ok: false;
  error: string;
  httpStatus?: number;
  stage: "normalize" | "format" | "profile" | "network";
  code: "empty" | "short" | "expired" | "no_profile" | "http" | "network";
};

async function fetchProfileOnce(
  token: string,
  timeoutMs: number,
): Promise<
  | { ok: true; profile: McSsidProfile }
  | { ok: false; httpStatus?: number; network?: boolean; body?: string }
> {
  try {
    const res = await fetch("https://api.minecraftservices.com/minecraft/profile", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, httpStatus: res.status };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, httpStatus: res.status, body: body.slice(0, 200) };
    }
    const data = (await res.json()) as McSsidProfile & { name?: string; id?: string };
    if (!data?.name || !data?.id) {
      return { ok: false, httpStatus: res.status, body: "missing name/id" };
    }
    return {
      ok: true,
      profile: {
        name: data.name,
        id: data.id,
        skins: data.skins,
        capes: data.capes,
      },
    };
  } catch {
    return { ok: false, network: true };
  }
}

/**
 * Validate Minecraft Services access_token end-to-end.
 * Retries once on network/5xx; never retries on 401/403.
 */
export async function validateMinecraftSsid(
  raw: string,
): Promise<SsidValidateOk | SsidValidateErr> {
  const token = normalizeMcAccessToken(raw);
  if (!token) {
    return {
      ok: false,
      error: "Paste a Minecraft access token (SSID)",
      stage: "normalize",
      code: "empty",
    };
  }
  if (!looksLikeMcToken(token)) {
    return {
      ok: false,
      error: "Token looks too short or incomplete — paste the full access_token",
      stage: "format",
      code: "short",
    };
  }

  let last:
    | { ok: false; httpStatus?: number; network?: boolean; body?: string }
    | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await fetchProfileOnce(token, 12_000);
    if (result.ok) {
      return {
        ok: true,
        token,
        profile: result.profile,
        uuidDashed: formatUuidDashed(result.profile.id),
        stage: "profile",
      };
    }
    last = result;
    // Auth failures are definitive
    if (result.httpStatus === 401 || result.httpStatus === 403) break;
    // Retry network / 5xx once
    if (attempt === 0 && (result.network || (result.httpStatus && result.httpStatus >= 500))) {
      await new Promise((r) => setTimeout(r, 800 + attempt * 400));
      continue;
    }
    break;
  }

  if (last?.httpStatus === 401 || last?.httpStatus === 403) {
    return {
      ok: false,
      error:
        "SSID rejected (expired or invalid). Generate a fresh Minecraft access_token and use Refresh Token.",
      httpStatus: last.httpStatus,
      stage: "profile",
      code: "expired",
    };
  }
  if (last?.network) {
    return {
      ok: false,
      error: "Could not reach Minecraft services — check network and try again",
      stage: "network",
      code: "network",
    };
  }
  if (last?.body === "missing name/id") {
    return {
      ok: false,
      error: "Token accepted but no Minecraft Java profile found on this account",
      httpStatus: last.httpStatus,
      stage: "profile",
      code: "no_profile",
    };
  }
  return {
    ok: false,
    error: `Minecraft services error HTTP ${last?.httpStatus ?? "unknown"}`,
    httpStatus: last?.httpStatus,
    stage: "profile",
    code: "http",
  };
}
