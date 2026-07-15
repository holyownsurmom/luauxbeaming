/**
 * Per-account recovery mailbox providers.
 * Preferred: Mailcow API creates a real unique mailbox per secure job.
 * Fallback: Firstmail API (if key valid).
 * Fallback: catch-all domain (unique address, shared IMAP inbox).
 */

export type RecoveryMailbox = {
  email: string;
  password: string;
  /** IMAP auth password (often same as mailbox password) */
  imapPassword: string;
  imapHost: string;
  imapPort: number;
  provider: "mailcow" | "firstmail" | "catchall";
};

function randLocal(prefix = "r"): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function strongPassword(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6).toUpperCase() +
    "9!"
  );
}

function mailcowBase(): string | null {
  const raw = (process.env.MAILCOW_API_URL || process.env.MAILCOW_URL || "").trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function mailcowKey(): string | null {
  return (process.env.MAILCOW_API_KEY || "").trim() || null;
}

function mailcowDomain(): string | null {
  return (process.env.MAILCOW_DOMAIN || process.env.RECOVERY_MAIL_DOMAIN || "").trim() || null;
}

export function mailcowConfigured(): boolean {
  return !!(mailcowBase() && mailcowKey() && mailcowDomain());
}

export function catchallConfigured(): boolean {
  return !!(
    process.env.RECOVERY_MAIL_DOMAIN &&
    process.env.RECOVERY_IMAP_HOST &&
    process.env.RECOVERY_IMAP_USER &&
    process.env.RECOVERY_IMAP_PASS
  );
}

/** Create a unique mailbox on Mailcow for this secure job. */
export async function createMailcowMailbox(): Promise<RecoveryMailbox> {
  const base = mailcowBase();
  const key = mailcowKey();
  const domain = mailcowDomain();
  if (!base || !key || !domain) {
    throw new Error("Mailcow not configured (MAILCOW_API_URL, MAILCOW_API_KEY, MAILCOW_DOMAIN)");
  }

  const local = randLocal("r");
  const password = strongPassword();
  const email = `${local}@${domain}`;
  const imapHost =
    (process.env.MAILCOW_IMAP_HOST || process.env.RECOVERY_IMAP_HOST || "").trim() ||
    base.replace(/^https?:\/\//, "").replace(/\/.*$/, "") ||
    `mail.${domain}`;
  const imapPort = parseInt(process.env.MAILCOW_IMAP_PORT || process.env.RECOVERY_IMAP_PORT || "993", 10) || 993;

  const body = {
    local_part: local,
    domain,
    name: local,
    quota: String(process.env.MAILCOW_QUOTA_MB || "64"),
    password,
    password2: password,
    active: "1",
    force_pw_update: "0",
    tls_enforce_in: "0",
    tls_enforce_out: "0",
  };

  const url = `${base}/api/v1/add/mailbox`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Mailcow add/mailbox non-json status=${res.status} body=${text.slice(0, 180)}`);
  }

  // Mailcow returns array of { type, msg } objects
  const items = Array.isArray(data) ? data : [data];
  const failed = items.some(
    (it) =>
      it &&
      typeof it === "object" &&
      String((it as { type?: string }).type || "").toLowerCase() === "danger",
  );
  if (!res.ok || failed) {
    throw new Error(
      `Mailcow add/mailbox failed status=${res.status} body=${JSON.stringify(data).slice(0, 240)}`,
    );
  }

  // Brief settle so IMAP is ready
  await new Promise((r) => setTimeout(r, 1500));

  return {
    email,
    password,
    imapPassword: password,
    imapHost,
    imapPort,
    provider: "mailcow",
  };
}

/** Unique address on catch-all domain; all mail lands in one IMAP inbox. */
export function createCatchallAddress(): RecoveryMailbox {
  const domain = (process.env.RECOVERY_MAIL_DOMAIN || "").trim();
  const imapHost = (process.env.RECOVERY_IMAP_HOST || "").trim();
  const imapUser = (process.env.RECOVERY_IMAP_USER || "").trim();
  const imapPass = (process.env.RECOVERY_IMAP_PASS || "").trim();
  const imapPort = parseInt(process.env.RECOVERY_IMAP_PORT || "993", 10) || 993;
  if (!domain || !imapHost || !imapUser || !imapPass) {
    throw new Error("Catch-all not configured (RECOVERY_MAIL_DOMAIN + RECOVERY_IMAP_*)");
  }
  const local = randLocal("r");
  return {
    email: `${local}@${domain}`,
    password: imapPass,
    imapPassword: imapPass,
    imapHost,
    imapPort,
    provider: "catchall",
  };
}

/** Poll IMAP for MS security code. */
export async function readSecurityCodeFromImap(
  box: RecoveryMailbox,
  signal?: AbortSignal,
  timeoutMs = 60_000,
): Promise<string> {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: box.imapHost,
    port: box.imapPort,
    secure: true,
    auth: {
      user: box.provider === "catchall" ? (process.env.RECOVERY_IMAP_USER || box.email) : box.email,
      pass: box.imapPassword,
    },
    logger: false,
    tls: { rejectUnauthorized: process.env.MAIL_TLS_INSECURE === "1" ? false : true },
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const start = Date.now();
      const seen = new Set<number>();
      while (Date.now() - start < timeoutMs) {
        if (signal?.aborted) throw new Error("Aborted while waiting for security code");
        try {
          await client.mailboxOpen("INBOX");
        } catch {
          /* already open */
        }
        const mb = client.mailbox;
        const exists = mb && typeof mb === "object" ? mb.exists : 0;
        if (exists > 0) {
          // Scan last few messages (catch-all may have noise)
          const from = Math.max(1, exists - 8);
          for (let seq = exists; seq >= from; seq--) {
            if (seen.has(seq)) continue;
            try {
              const message = await client.fetchOne(`${seq}`, {
                source: true,
                envelope: true,
              });
              if (!message) continue;
              const source = message.source?.toString() || "";
              const to =
                message.envelope?.to?.map((a) => a.address || "").join(",") || "";
              // For catch-all, prefer messages addressed to our unique local
              if (
                box.provider === "catchall" &&
                to &&
                !to.toLowerCase().includes(box.email.toLowerCase()) &&
                !source.toLowerCase().includes(box.email.toLowerCase())
              ) {
                // still allow MS codes without perfect To match
              }
              const match =
                source.match(/Security code:\s*(\d{4,8})/i) ||
                source.match(/code is[:\s]+(\d{4,8})/i) ||
                source.match(/\b(\d{6})\b/);
              if (match) {
                seen.add(seq);
                return match[1];
              }
              seen.add(seq);
            } catch {
              /* skip msg */
            }
          }
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
      throw new Error(
        `Timeout waiting for security code via IMAP (${box.provider} ${box.imapHost})`,
      );
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}
