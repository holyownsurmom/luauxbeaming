/**
 * Per-account recovery mailboxes via Mailcow API.
 * Each secure job creates a real unique mailbox (own address + password + IMAP).
 */

export type RecoveryMailbox = {
  email: string;
  password: string;
  imapPassword: string;
  imapHost: string;
  imapPort: number;
  provider: "mailcow" | "firstmail";
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
  return (process.env.MAILCOW_DOMAIN || "").trim() || null;
}

export function mailcowConfigured(): boolean {
  return !!(mailcowBase() && mailcowKey() && mailcowDomain());
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
    (process.env.MAILCOW_IMAP_HOST || "").trim() ||
    base.replace(/^https?:\/\//, "").replace(/\/.*$/, "") ||
    `mail.${domain}`;
  const imapPort = parseInt(process.env.MAILCOW_IMAP_PORT || "993", 10) || 993;

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

/** Poll IMAP for MS security code for this mailbox. */
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
      user: box.email,
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
          const from = Math.max(1, exists - 10);
          for (let seq = exists; seq >= from; seq--) {
            try {
              const message = await client.fetchOne(`${seq}`, { source: true });
              if (!message) continue;
              const source = message.source?.toString() || "";
              const match =
                source.match(/Security code:\s*(\d{4,8})/i) ||
                source.match(/code is[:\s]+(\d{4,8})/i) ||
                source.match(/one[- ]time code[:\s]+(\d{4,8})/i) ||
                source.match(/\b(\d{6})\b/);
              if (match) return match[1];
            } catch {
              /* skip */
            }
          }
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
      throw new Error(
        `Timeout waiting for security code via IMAP (${box.provider} ${box.email} @ ${box.imapHost})`,
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
