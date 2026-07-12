/**
 * Server-side Minecraft SSID (access_token) helpers.
 * Used when adding/refreshing accounts and at bot launch.
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
};

export type SsidValidateErr = {
  ok: false;
  error: string;
  httpStatus?: number;
};

export async function validateMinecraftSsid(
  raw: string,
): Promise<SsidValidateOk | SsidValidateErr> {
  const token = normalizeMcAccessToken(raw);
  if (!token) return { ok: false, error: "Paste a Minecraft access token (SSID)" };
  if (!looksLikeMcToken(token)) {
    return {
      ok: false,
      error: "Token looks too short or incomplete — paste the full access_token",
    };
  }

  try {
    const res = await fetch("https://api.minecraftservices.com/minecraft/profile", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error: "SSID rejected (expired or invalid). Generate a fresh Minecraft access token.",
        httpStatus: res.status,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: `Minecraft services error HTTP ${res.status}`,
        httpStatus: res.status,
      };
    }

    const data = (await res.json()) as McSsidProfile & { name?: string; id?: string };
    if (!data?.name || !data?.id) {
      return {
        ok: false,
        error: "Token accepted but no Minecraft Java profile found on this account",
      };
    }

    return {
      ok: true,
      token,
      profile: {
        name: data.name,
        id: data.id,
        skins: data.skins,
        capes: data.capes,
      },
      uuidDashed: formatUuidDashed(data.id),
    };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? `Could not validate SSID: ${e.message}`
          : "Could not reach Minecraft services",
    };
  }
}
