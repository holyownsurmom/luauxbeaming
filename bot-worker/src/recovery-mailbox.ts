/**
 * Recovery mailbox helpers for secure flow.
 * Provider: Firstmail (unique mailbox per job) or catch-all domain.
 */

export type RecoveryMailbox = {
  email: string;
  password: string;
  imapPassword: string;
  imapHost: string;
  imapPort: number;
  provider: "firstmail" | "catchall";
};

function randLocal(prefix = "r"): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function catchallConfigured(): boolean {
  return !!(
    process.env.RECOVERY_MAIL_DOMAIN &&
    process.env.RECOVERY_IMAP_HOST &&
    process.env.RECOVERY_IMAP_USER &&
    process.env.RECOVERY_IMAP_PASS
  );
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
