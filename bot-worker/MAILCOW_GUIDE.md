# LuauX Mailcow recovery mailboxes

Each secured Microsoft account gets its **own real mailbox** on your domain (own address, password, and IMAP). The Windows bot-worker creates the mailbox through the Mailcow API, then reads Microsoft’s security code from that inbox.

**LuauX target**

| Setting | Value |
|---------|--------|
| Mailbox domain | `luaux.wtf` (addresses like `rxxxxx@luaux.wtf`) |
| Mail hostname | `mail.luaux.wtf` |
| API | `https://mail.luaux.wtf` |
| Bot-worker | Windows VPS (separate from Mailcow) |
| Mailcow host | Linux VPS (Debian/Ubuntu + Docker) |

---

## Requirements

- Linux VPS with public IPv4, ~2–4 GB RAM
- **Port 25 inbound open** (ask the host; many block it)
- Ports **443** (API/UI) and **993** (IMAP)
- Domain `luaux.wtf` (you own it)
- Docker + Docker Compose on the Linux box

Mailcow is **Linux-only**. Do not install it on the Windows bot-worker machine.

---

## 1. Install Mailcow (Linux)

```bash
cd /opt
git clone https://github.com/mailcow/mailcow-dockerized
cd mailcow-dockerized
./generate_config.sh
# set MAILCOW_HOSTNAME=mail.luaux.wtf
docker compose pull
docker compose up -d
```

Open the UI at `https://mail.luaux.wtf` after DNS points there. Default admin credentials are shown during `generate_config.sh`.

---

## 2. DNS

Replace `MAIL_SERVER_IP` with the Linux VPS IP.

| Type | Name | Value |
|------|------|--------|
| A | `mail` | `MAIL_SERVER_IP` (DNS only / grey cloud if using Cloudflare) |
| MX | `@` (`luaux.wtf`) | `mail.luaux.wtf` priority 10 |

SPF (TXT on `luaux.wtf`) — merge if you already have SPF:

```text
v=spf1 mx a:mail.luaux.wtf ip4:MAIL_SERVER_IP -all
```

Add **DKIM** from Mailcow UI after the domain is added.  
Optional DMARC TXT on `_dmarc.luaux.wtf`.  
Set **PTR/rDNS** for `MAIL_SERVER_IP` → `mail.luaux.wtf` at the VPS host.

If the website is on Vercel, keep site A/CNAME records for `@` / web as well. Mail and web share the same domain DNS zone.

---

## 3. Mailcow UI setup

1. **Configuration → Mail Setup → Domains** → add `luaux.wtf`
2. Create a test mailbox (e.g. `test@luaux.wtf`) and log in with IMAP:
   - Host: `mail.luaux.wtf`
   - Port: `993`
   - SSL/TLS
3. **API**: enable API, create a **read-write** key, optionally restrict to the bot-worker IP

API create endpoint used by the worker:

```http
POST https://mail.luaux.wtf/api/v1/add/mailbox
Header: X-API-Key: YOUR_KEY
```

---

## 4. Windows bot-worker `.env`

```env
MAILCOW_API_URL=https://mail.luaux.wtf
MAILCOW_API_KEY=paste-api-key-here
MAILCOW_DOMAIN=luaux.wtf
MAILCOW_IMAP_HOST=mail.luaux.wtf
MAILCOW_IMAP_PORT=993
```

If IMAP TLS fails on a self-signed cert temporarily:

```env
MAIL_TLS_INSECURE=1
```

Restart a **single** pm2 process after editing:

```powershell
cd C:\luaux
pm2 kill
git fetch origin
git reset --hard origin/main
cd bot-worker
npm run build
pm2 start node --name "bot-worker" -- dist/index.js
pm2 save
```

---

## 5. What success looks like

```text
[secure] Got recovery code
[secure] Creating unique recovery mailbox (mailcow=true firstmail=false)...
[secure] Mailbox ready provider=mailcow email=r........@luaux.wtf imap=mail.luaux.wtf
[secure] Running recovery flow (waiting for mailbox OTP)...
[secure] Account secured successfully!
```

Each concurrent job gets a different mailbox. IMAP logs into **that** mailbox only, so codes cannot be mixed across jobs.

Credentials after success go to the **admin webhook** and the owner **Secured Accounts** dashboard tab — not Discord DMs.

---

## 6. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `mailcow=false` | Missing `MAILCOW_*` in worker `.env` or worker not restarted |
| `add/mailbox failed` | API key permissions, domain not added, wrong URL |
| IMAP timeout | MX/DNS wrong, port 25 blocked, domain reputation, wrong IMAP host |
| TLS error | `MAIL_TLS_INSECURE=1` temporarily |
| Dual workers | `pm2 kill` then start one process only |

Mailcow logs on Linux:

```bash
cd /opt/mailcow-dockerized
docker compose logs --tail=200 postfix-mailcow
docker compose logs --tail=200 dovecot-mailcow
```

---

## Related files

| File | Role |
|------|------|
| `bot-worker/src/recovery-mailbox.ts` | Create Mailcow mailbox + IMAP read |
| `bot-worker/src/secure.ts` | Secure pipeline |
| `bot-worker/.env.example` | Env template |

Production site: `https://luaux.wtf`. Worker polls the site with `WORKER_SECRET` (must match Vercel).
