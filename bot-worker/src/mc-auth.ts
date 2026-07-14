/**
 * Minecraft premium auth (SSID) helpers for mineflayer.
 * SSID = Minecraft Services access_token (not Xbox refresh token).
 * When SSID expires, user must paste a new one — no silent MS refresh in this product.
 */

export type McProfile = {
  name: string;
  id: string;
  skins?: Array<{ id?: string; state?: string; url?: string }>;
  capes?: Array<{ id?: string; state?: string; alias?: string }>;
};

export type PremiumSession = {
  accessToken: string;
  name: string;
  id: string;
  idUndashed: string;
  idDashed: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profileKeys: any | null;
  source: "ssid" | "microsoft";
  certsExpiresOn?: number | null;
  certsRefreshAfter?: number | null;
};

export type AuthLog = (level: string, message: string, immediate?: boolean) => Promise<void>;

export function normalizeAccessToken(raw: string): string {
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

export function formatUuidDashed(raw: string): string {
  const undashed = (raw || "").replace(/-/g, "").toLowerCase();
  if (undashed.length !== 32) return raw;
  return `${undashed.slice(0, 8)}-${undashed.slice(8, 12)}-${undashed.slice(12, 16)}-${undashed.slice(16, 20)}-${undashed.slice(20)}`;
}

export function formatUuidUndashed(raw: string): string {
  return (raw || "").replace(/-/g, "").toLowerCase();
}

export function looksLikeJwtOrToken(token: string): boolean {
  if (!token || token.length < 20) return false;
  if (token.includes(".") && token.split(".").length >= 2) return true;
  return token.length >= 40;
}

export type ProfileFetchResult =
  | { ok: true; profile: McProfile }
  | { ok: false; code: "expired" | "http" | "network" | "no_profile"; httpStatus?: number };

export async function fetchMinecraftProfileDetailed(
  accessToken: string,
): Promise<ProfileFetchResult> {
  const token = normalizeAccessToken(accessToken);
  if (!token) return { ok: false, code: "expired" };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://api.minecraftservices.com/minecraft/profile", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, code: "expired", httpStatus: res.status };
      }
      if (!res.ok) {
        if (res.status >= 500 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        return { ok: false, code: "http", httpStatus: res.status };
      }
      const data = (await res.json()) as McProfile & { name?: string; id?: string };
      if (!data?.name || !data?.id) {
        return { ok: false, code: "no_profile", httpStatus: res.status };
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
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      return { ok: false, code: "network" };
    }
  }
  return { ok: false, code: "network" };
}

export async function fetchMinecraftProfile(accessToken: string): Promise<McProfile | null> {
  const r = await fetchMinecraftProfileDetailed(accessToken);
  return r.ok ? r.profile : null;
}

/** Chat-signing keypair (1.19+) — required on many modern SMPs / ViaVersion */
export async function fetchMinecraftCertificates(
  accessToken: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  try {
    const token = normalizeAccessToken(accessToken);
    if (!token) return null;
    const res = await fetch("https://api.minecraftservices.com/player/certificates", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const cert = await res.json();
    if (!cert?.keyPair?.publicKey || !cert?.keyPair?.privateKey) return null;

    const crypto = await import("crypto");
    const toDer = (pem: string) => {
      const b64 = pem
        .replace(/-----BEGIN [A-Z ]+-----/g, "")
        .replace(/-----END [A-Z ]+-----/g, "")
        .replace(/\s+/g, "");
      return Buffer.from(b64, "base64");
    };
    const publicDER = toDer(cert.keyPair.publicKey);
    const privateDER = toDer(cert.keyPair.privateKey);
    const expiresOn = cert.expiresAt ? new Date(cert.expiresAt) : null;
    const refreshAfter = cert.refreshedAfter
      ? new Date(cert.refreshedAfter)
      : expiresOn;
    return {
      publicPEM: cert.keyPair.publicKey,
      privatePEM: cert.keyPair.privateKey,
      publicDER,
      privateDER,
      signature: Buffer.from(cert.publicKeySignature || "", "base64"),
      signatureV2: Buffer.from(
        cert.publicKeySignatureV2 || cert.publicKeySignature || "",
        "base64",
      ),
      expiresOn,
      refreshAfter,
      public: crypto.createPublicKey({ key: publicDER, format: "der", type: "spki" }),
      private: crypto.createPrivateKey({ key: privateDER, format: "der", type: "pkcs8" }),
    };
  } catch {
    return null;
  }
}

export function certsNeedRefresh(
  session: PremiumSession | null,
  skewMs = 5 * 60_000,
): boolean {
  if (!session?.profileKeys) return true;
  const now = Date.now();
  const refreshAfter =
    session.certsRefreshAfter ??
    (session.profileKeys.refreshAfter instanceof Date
      ? session.profileKeys.refreshAfter.getTime()
      : null);
  const expiresOn =
    session.certsExpiresOn ??
    (session.profileKeys.expiresOn instanceof Date
      ? session.profileKeys.expiresOn.getTime()
      : null);
  if (refreshAfter && now >= refreshAfter - skewMs) return true;
  if (expiresOn && now >= expiresOn - skewMs) return true;
  return false;
}

export type ValidateSsidResult =
  | { ok: true; profile: McProfile; token: string }
  | {
      ok: false;
      error: string;
      code: "empty" | "short" | "invalid" | "no_profile" | "network" | "http";
    };

export async function validateSsidToken(raw: string): Promise<ValidateSsidResult> {
  const token = normalizeAccessToken(raw);
  if (!token) return { ok: false, error: "SSID token is empty", code: "empty" };
  if (!looksLikeJwtOrToken(token)) {
    return {
      ok: false,
      error: "SSID looks invalid — paste the full Minecraft services access_token",
      code: "short",
    };
  }
  const result = await fetchMinecraftProfileDetailed(token);
  if (result.ok) return { ok: true, profile: result.profile, token };
  if (result.code === "expired") {
    return {
      ok: false,
      error: "SSID rejected by Minecraft (expired or invalid). Get a fresh token.",
      code: "invalid",
    };
  }
  if (result.code === "no_profile") {
    return {
      ok: false,
      error: "Token accepted but no Minecraft Java profile on this account",
      code: "no_profile",
    };
  }
  if (result.code === "network") {
    return {
      ok: false,
      error: "Could not reach Minecraft services to validate SSID",
      code: "network",
    };
  }
  return {
    ok: false,
    error: `Minecraft services error HTTP ${result.httpStatus ?? "unknown"}`,
    code: "http",
  };
}

/**
 * Build a full premium session from SSID (validate + certificates).
 */
export async function resolveSsidSession(
  rawSsid: string,
  log: AuthLog,
): Promise<{ session: PremiumSession } | { error: string; code?: string }> {
  const validated = await validateSsidToken(rawSsid);
  if (!validated.ok) {
    await log("error", validated.error, true);
    return { error: validated.error, code: validated.code };
  }

  const { token, profile } = validated;
  const idUndashed = formatUuidUndashed(profile.id);
  const idDashed = formatUuidDashed(profile.id);

  await log("info", `SSID OK — ${profile.name} (${idDashed})`, true);
  await log("info", "Loading chat-signing certificates (SSID)...", true);
  const profileKeys = await fetchMinecraftCertificates(token);
  let certsExpiresOn: number | null = null;
  let certsRefreshAfter: number | null = null;
  if (profileKeys) {
    certsExpiresOn =
      profileKeys.expiresOn instanceof Date ? profileKeys.expiresOn.getTime() : null;
    certsRefreshAfter =
      profileKeys.refreshAfter instanceof Date ? profileKeys.refreshAfter.getTime() : null;
    await log(
      "info",
      certsExpiresOn
        ? `Chat certificates loaded (expires ${new Date(certsExpiresOn).toISOString()})`
        : "Chat certificates loaded",
      true,
    );
  } else {
    await log(
      "warn",
      "Chat certificates unavailable — modern servers may kick with Invalid sequence",
      true,
    );
  }

  return {
    session: {
      accessToken: token,
      name: profile.name,
      id: profile.id,
      idUndashed,
      idDashed,
      profileKeys,
      source: "ssid",
      certsExpiresOn,
      certsRefreshAfter,
    },
  };
}

/**
 * mineflayer custom auth injector for premium (SSID or MS token).
 */
export function createPremiumAuthInjector(session: PremiumSession) {
  const { accessToken, name, idUndashed, idDashed, profileKeys } = session;
  return (
    client: {
      session: unknown;
      username: string;
      uuid?: string;
      profileKeys?: unknown;
      emit: (event: string, data: unknown) => void;
    },
    options: {
      accessToken?: string;
      haveCredentials?: boolean;
      connect: (client: unknown) => void;
    },
  ) => {
    const sess = {
      accessToken,
      clientToken: null as null,
      selectedProfile: { name, id: idUndashed },
      availableProfiles: [{ name, id: idUndashed }],
    };
    client.session = sess;
    client.username = name;
    client.uuid = idDashed;
    options.accessToken = accessToken;
    options.haveCredentials = true;
    if (profileKeys) {
      client.profileKeys = profileKeys;
    }
    client.emit("session", sess);
    options.connect(client);
  };
}

export function accountLockKey(session: PremiumSession | null, fallback: string): string {
  const raw = session?.idUndashed || session?.name || fallback;
  return raw.toString().replace(/-/g, "").toLowerCase();
}
