/**
 * Per-account recovery mailboxes via Mailcow API.
 * Each secure job creates a real unique mailbox (own address + password + IMAP).
 */

import https from "node:https";
import { URL } from "node:url";

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

function mailTlsInsecure(): boolean {
  const v = (process.env.MAIL_TLS_INSECURE || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function mailcowConfigured(): boolean {
  return !!(mailcowBase() && mailcowKey() && mailcowDomain());
}

/** HTTPS POST/GET that can skip cert verify (Mailcow often uses self-signed until LE). */
function httpsJson(
  method: string,
  urlStr: string,
  headers: Record<string, string>,
  body?: string,
  timeoutMs = 30_000,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(urlStr);
    } catch (e) {
      reject(new Error(`Invalid Mailcow URL: ${urlStr}`));
      return;
    }
    const insecure = mailTlsInsecure();
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method,
        headers: {
          ...headers,
          ...(body ? { "Content-Length": Buffer.byteLength(body).toString() } : {}),
        },
        rejectUnauthorized: !insecure,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`Mailcow request timeout after ${timeoutMs}ms`));
    });
    req.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code || "";
      const msg = err.message || String(err);
      if (/self-signed|UNABLE_TO_VERIFY|CERT|DEPTH_ZERO/i.test(msg) || code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
        reject(
          new Error(
            `Mailcow TLS failed (${msg}). Set MAIL_TLS_INSECURE=1 until Let's Encrypt is issued for mail.luaux.wtf`,
          ),
        );
        return;
      }
      reject(new Error(`Mailcow fetch failed: ${code || msg}`));
    });
    if (body) req.write(body);
    req.end();
  });
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

  const body = JSON.stringify({
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
  });

  const url = `${base}/api/v1/add/mailbox`;
  let status: number;
  let text: string;
  try {
    const res = await httpsJson(
      "POST",
      url,
      {
        "X-API-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
    );
    status = res.status;
    text = res.text;
  } catch (e) {
    // Optional IP fallback only when MAILCOW_API_FALLBACK is set
    const ipFallback = (process.env.MAILCOW_API_FALLBACK || "").replace(/\/+$/, "");
    if (ipFallback && !base.includes(ipFallback.replace(/^https?:\/\//, ""))) {
      try {
        const res = await httpsJson(
          "POST",
          `${ipFallback}/api/v1/add/mailbox`,
          {
            "X-API-Key": key,
            "Content-Type": "application/json",
            Accept: "application/json",
            Host: "mail.luaux.wtf",
          },
          body,
        );
        status = res.status;
        text = res.text;
      } catch (e2) {
        throw e instanceof Error ? e : new Error(String(e2));
      }
    } else {
      throw e;
    }
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Mailcow add/mailbox non-json status=${status} body=${text.slice(0, 180)}`);
  }

  const items = Array.isArray(data) ? data : [data];
  const failed = items.some(
    (it) =>
      it &&
      typeof it === "object" &&
      String((it as { type?: string }).type || "").toLowerCase() === "danger",
  );
  if (status < 200 || status >= 300 || failed) {
    throw new Error(
      `Mailcow add/mailbox failed status=${status} body=${JSON.stringify(data).slice(0, 240)}`,
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
    tls: { rejectUnauthorized: mailTlsInsecure() ? false : true },
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
              // Strict MS patterns only — bare \d{6} matches Message-IDs / noise
              const match =
                source.match(/Security code:\s*(\d{4,8})/i) ||
                source.match(/security\s*code[:\s]+(\d{4,8})/i) ||
                source.match(/code is[:\s]+(\d{4,8})/i) ||
                source.match(/one[- ]time code[:\s]+(\d{4,8})/i) ||
                source.match(/verification code[:\s]+(\d{4,8})/i) ||
                source.match(/Your code is[:\s]+(\d{4,8})/i);
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
