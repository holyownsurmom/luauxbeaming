/**
 * Minecraft premium auth (SSID + Microsoft) helpers for mineflayer.
 * SSID = Minecraft Services access_token from login_with_xbox / launcher.
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
  /** undashed uuid for session profile */
  idUndashed: string;
  /** dashed uuid for client.uuid */
  idDashed: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profileKeys: any | null;
  source: "ssid" | "microsoft";
};

export type AuthLog = (level: string, message: string, immediate?: boolean) => Promise<void>;

export function normalizeAccessToken(raw: string): string {
  let t = (raw || "").trim();
  // Collapse accidental whitespace/newlines from paste
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
  // Mojang/MC tokens are often JWTs (3 base64 segments) or long opaque strings
  if (token.includes(".") && token.split(".").length >= 2) return true;
  return token.length >= 40;
}

export async function fetchMinecraftProfile(
  accessToken: string,
): Promise<McProfile | null> {
  try {
    const token = normalizeAccessToken(accessToken);
    if (!token) return null;
    const res = await fetch("https://api.minecraftservices.com/minecraft/profile", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as McProfile & { name?: string; id?: string };
    if (!data?.name || !data?.id) return null;
    return {
      name: data.name,
      id: data.id,
      skins: data.skins,
      capes: data.capes,
    };
  } catch {
    return null;
  }
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
      expiresOn: new Date(cert.expiresAt),
      refreshAfter: new Date(cert.refreshedAfter || cert.expiresAt),
      public: crypto.createPublicKey({ key: publicDER, format: "der", type: "spki" }),
      private: crypto.createPrivateKey({ key: privateDER, format: "der", type: "pkcs8" }),
    };
  } catch {
    return null;
  }
}

export type ValidateSsidResult =
  | { ok: true; profile: McProfile; token: string }
  | { ok: false; error: string; code: "empty" | "short" | "invalid" | "no_profile" | "network" };

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
  try {
    const profile = await fetchMinecraftProfile(token);
    if (!profile) {
      return {
        ok: false,
        error: "SSID rejected by Minecraft (expired or invalid). Get a fresh token.",
        code: "invalid",
      };
    }
    return { ok: true, profile, token };
  } catch {
    return {
      ok: false,
      error: "Could not reach Minecraft services to validate SSID",
      code: "network",
    };
  }
}

/**
 * Build a full premium session from SSID once per job.
 * Reuses the same token + profileKeys on every reconnect.
 */
export async function resolveSsidSession(
  rawSsid: string,
  log: AuthLog,
): Promise<{ session: PremiumSession } | { error: string }> {
  const validated = await validateSsidToken(rawSsid);
  if (!validated.ok) {
    await log("error", validated.error);
    return { error: validated.error };
  }

  const { token, profile } = validated;
  const idUndashed = formatUuidUndashed(profile.id);
  const idDashed = formatUuidDashed(profile.id);

  await log("info", `SSID OK — ${profile.name} (${idDashed})`);
  await log("info", "Loading chat-signing certificates (SSID)...");
  const profileKeys = await fetchMinecraftCertificates(token);
  if (profileKeys) {
    await log("info", "Chat certificates loaded");
  } else {
    await log(
      "warn",
      "Chat certificates unavailable — modern servers may kick with Invalid sequence",
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
    },
  };
}

/**
 * mineflayer custom auth injector for premium (SSID or MS token).
 * Sets session, uuid, profileKeys, then calls options.connect.
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
