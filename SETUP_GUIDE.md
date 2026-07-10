# LuauX Full Setup Guide

This guide walks through deploying the entire LuauX platform from scratch.

---

## Architecture

```
┌─────────────────────┐        HTTP (REST API)        ┌──────────────────┐
│  Lovable Site        │◄──────────────────────────────►│  Bot Worker      │
│  (UI + Auth + Pay)   │                                │  (Your VPS)      │
│                      │  - /api/bots/worker/poll       │                  │
│  Managed Supabase    │  - /api/bots/worker/log        │  Runs MC bots    │
│  (DB + RLS)          │  - /api/bots/worker/update     │  Runs Discord    │
└─────────────────────┘                                │  spam            │
                                                        └──────────────────┘
```

- **Lovable site**: Hosted on Lovable Cloud (Cloudflare Workers edge runtime). Handles UI, Discord OAuth, payments, and all database access.
- **Bot worker**: Runs on your VPS. Polls the Lovable site for jobs via HTTP. Runs mineflayer MC bots and Discord HTTP API spam. **No Supabase credentials needed.**

---

## Step 1: Deploy the Lovable Site

### 1a. Push to GitHub

The repo is at `https://github.com/holyownsurmom/luauxbeaming`. If you need to push changes:

```bash
git add -A
git commit -m "description"
git push
```

Lovable auto-deploys on push to the connected branch.

### 1b. Set Environment Variables in Lovable

Go to [Lovable Dashboard](https://lovable.dev/projects) → Your project → **Settings** → **Environment Variables**.

Add these:

| Variable | Value | How to get it |
|---|---|---|
| `SESSION_SECRET` | `ea48972d125b46a0fb90d0f7aa4005a0093039550656dbb24e3c46fd33ca879a` | Pre-generated |
| `ADMIN_PASSWORD` | `7C9Y6Oopg4HpECdqhGjKfqADpvL0A2Nk` | Pre-generated |
| `WORKER_SECRET` | `f6d7da1bb74034fb43fd7ca45dface8e4cf49438cf29e39c0f7138abd5aeac78` | Pre-generated |
| `IPN_CALLBACK_URL` | `https://luauxbeaming.lovable.app/api/public/nowpayments/webhook` | Pre-filled |
| `DISCORD_CLIENT_ID` | Your Discord app client ID | Discord Developer Portal → OAuth2 |
| `DISCORD_CLIENT_SECRET` | Your Discord app client secret | Discord Developer Portal → OAuth2 |
| `DISCORD_BOT_TOKEN` | Your Discord bot token | Discord Developer Portal → Bot |
| `NOWPAYMENTS_API_KEY` | Your NowPayments API key | NowPayments Dashboard → API Keys |
| `NOWPAYMENTS_IPN_SECRET` | Your NowPayments IPN secret | NowPayments Dashboard → IPN |

> **Note**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` are auto-managed by Lovable Cloud. Do NOT set them manually.

### 1c. Update Discord OAuth2 Redirect URI

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your app → **OAuth2** → **Redirects**
3. Add:
   ```
   https://luauxbeaming.lovable.app/api/discord/callback
   ```
4. Save

### 1d. Create Database Tables

The bot_jobs and bot_logs tables must be created via Lovable's SQL editor (since Lovable manages its own Supabase):

1. Go to your Lovable project → **Cloud** → **Database** → **SQL Editor**
2. Paste this and click **Run**:

```sql
-- Bot jobs table: Lovable UI writes here, bot-worker picks up via REST API
CREATE TABLE IF NOT EXISTS public.bot_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('mc', 'discord')),
  config JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'stopping', 'stopped', 'completed', 'error')),
  worker_id TEXT,
  error TEXT,
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bot_jobs_status_idx ON public.bot_jobs(status) WHERE status IN ('pending', 'stopping');
CREATE INDEX IF NOT EXISTS bot_jobs_discord_idx ON public.bot_jobs(discord_id, created_at DESC);
GRANT ALL ON public.bot_jobs TO service_role;
ALTER TABLE public.bot_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.bot_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Bot logs table: bot-worker writes here via REST API, Lovable UI reads
CREATE TABLE IF NOT EXISTS public.bot_logs (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.bot_jobs(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error', 'chat', 'bot', 'system')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bot_logs_job_idx ON public.bot_logs(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bot_logs_user_idx ON public.bot_logs(discord_id, created_at DESC);
GRANT ALL ON public.bot_logs TO service_role;
ALTER TABLE public.bot_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.bot_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
```

---

## Step 2: Set Up the Bot Worker on Your VPS

### 2a. Prerequisites

- Node.js 22+ installed on your VPS
- RDP or SSH access to your VPS (IP: `45.82.232.130`)

### 2b. Copy bot-worker to VPS

The bot-worker folder is at `luauxbeaming-full/luauxbeaming-full/bot-worker/`. Copy the entire `bot-worker/` folder to your VPS.

### 2c. Install and configure

On the VPS, open a terminal:

```bash
cd C:\Users\Administrator\Desktop\bot-worker
npm install
```

Create `.env` with these exact values:

```
SITE_URL=https://luauxbeaming.lovable.app
WORKER_SECRET=f6d7da1bb74034fb43fd7ca45dface8e4cf49438cf29e39c0f7138abd5aeac78
WORKER_ID=worker-1
POLL_INTERVAL_MS=3000
```

### 2d. Start the worker

```bash
npm run dev
```

You should see:
```
[worker] worker-1 started, polling every 3000ms
```

Leave this terminal open. The worker polls every 3 seconds for new jobs.

### 2e. (Optional) Run as a background service

For production, run the worker as a Windows service or use `pm2`:

```bash
npm install -g pm2
cd C:\Users\Administrator\Desktop\bot-worker
pm2 start "npx tsx src/index.ts" --name bot-worker
pm2 save
pm2 startup
```

---

## Step 3: Test

1. Go to `https://luauxbeaming.lovable.app`
2. Click **Login with Discord**
3. Go to the **Settings** tab → **Admin** sub-tab
4. Enter password: `7C9Y6Oopg4HpECdqhGjKfqADpvL0A2Nk`
5. You should see "ADMIN · all features unlocked" badge

### Test MC Auto-Message

1. Go to **MC Auto-Message**
2. Enter a server IP and port
3. Click **Ping Server** (should show player count)
4. Add a Minecraft account (label + SSID token)
5. Select messages and interval
6. Click **Launch**
7. You should see live console output within 3-5 seconds

### Test Discord Auto-Spam

1. Go to **Discord Auto-Spam**
2. Get your Discord user token:
   - Open Discord in a browser
   - Press F12 → Network tab
   - Click any channel
   - Find a request to `discord.com/api/v9/channels/...`
   - Copy the `Authorization` header value (starts with a long string, NOT "Bot ...")
3. Enter the token, channel ID, and messages
4. Click **Start Spamming**
5. Watch the live console

---

## Step 4: Admin Access

Admin is password-based (not database role). Anyone with the admin password sees an "ADMIN" badge and bypasses all payment gates.

- **Login**: Settings → Admin tab → enter password
- **Logout**: Settings → Admin tab → click Logout
- **Password**: `7C9Y6Oopg4HpECdqhGjKfqADpvL0A2Nk`

To change the password: update `ADMIN_PASSWORD` in Lovable env vars.

---

## How It Works

### MC Auto-Message Flow
1. User configures bot in the UI and clicks Launch
2. API route writes a `bot_jobs` row (status: pending) to Supabase
3. Bot-worker polls `/api/bots/worker/poll` every 3 seconds
4. Worker claims the job, marks it as running
5. Worker spawns a mineflayer bot with the user's SSID token
6. Bot connects to the Minecraft server and sends messages on interval
7. Worker posts logs to `/api/bots/worker/log` (batched, every 2s)
8. Frontend polls `/api/bots/stream` (SSE) every 2 seconds for live logs
9. When the user clicks Stop, API sets status to "stopping"
10. Worker detects the stop signal on next poll and aborts the bot

### Discord Auto-Spam Flow
1. User provides their Discord user token and channel ID
2. API route writes a `bot_jobs` row (status: pending)
3. Bot-worker picks up the job via REST API
4. Worker sends messages directly via Discord HTTP API (no bot token, no Gateway)
5. Humanization: random delays between messages, optional delete-after-send
6. Rate limit handling: detects 429 responses and waits appropriately
7. Worker posts logs via REST API for live console display

### Payment Flow
1. User selects a plan and pays with crypto (LTC, SOL, USDT, USDC)
2. NOWPayments creates an invoice and shows a wallet address
3. User sends crypto to the address
4. NOWPayments sends webhook to `/api/public/nowpayments/webhook`
5. After 2+ confirmations, the webhook activates the user's plan
6. For hours-only packs: sets active_plan_id + expiry (so MC bots can run)
7. For full plans: stacks expiry + adds bot hours
8. For plugin plans: generates a license key and DMs it to the user

---

## Troubleshooting

### "No active plan" on MC Auto-Message
- You need to purchase a plan first, or log in as admin

### "No active Discord Spam license"
- You need to purchase the Discord Spam plugin, or log in as admin

### Bot doesn't start / no console output
1. Check the bot-worker terminal — is it running? Any errors?
2. Check the Lovable deploy — did it succeed?
3. Check that `WORKER_SECRET` matches in both Lovable env vars and bot-worker `.env`
4. Open browser DevTools → Network → check if `/api/bots/worker/poll` returns 200

### Discord login goes to localhost
- Update the OAuth redirect URI in Discord Developer Portal (Step 1c)

### Logs not showing in real-time
- The SSE stream polls every 2 seconds — slight delay is normal
- Check bot-worker terminal for any connection errors

### Bot worker shows "poll failed: 401"
- `WORKER_SECRET` doesn't match between Lovable env vars and bot-worker `.env`

### Bot worker shows "poll failed: 404"
- The Lovable site hasn't deployed the worker API endpoints yet
- Push the latest code to GitHub and wait for Lovable to rebuild

### mineflayer won't connect
- Make sure your SSID token is valid (not expired)
- Try a different server to rule out server-side issues
- Check the bot console logs for specific error messages

---

## File Structure

```
luauxbeaming/
├── src/
│   ├── routes/
│   │   ├── api/
│   │   │   ├── admin/          # Admin login/logout (password-based)
│   │   │   ├── bots/
│   │   │   │   ├── mc/         # MC bot start/stop/status/ping
│   │   │   │   ├── discord/    # Discord spam start/stop/status
│   │   │   │   ├── worker/     # REST API bridge for bot-worker
│   │   │   │   │   ├── poll.ts     # Worker fetches pending jobs
│   │   │   │   │   ├── log.ts      # Worker posts log entries
│   │   │   │   │   └── update.ts   # Worker updates job status
│   │   │   │   ├── logs.ts     # Read bot logs
│   │   │   │   ├── stream.ts   # SSE log stream
│   │   │   │   └── all-status.ts
│   │   │   ├── discord.*.ts    # Discord OAuth flow
│   │   │   ├── me.ts           # Current user + admin status
│   │   │   └── public/         # NOWPayments webhook
│   │   ├── dashboard.*.tsx     # Dashboard pages
│   │   └── dashboard.tsx       # Dashboard layout + nav
│   ├── lib/
│   │   ├── api-helpers.ts      # Session helpers (admin, auth, etc.)
│   │   ├── session.ts          # Shared session config + types
│   │   ├── luaux.functions.ts  # Server functions (DB queries)
│   │   └── luaux-server.server.ts
│   └── components/
│       └── bot-console.tsx     # Shared terminal log component
├── bot-worker/
│   ├── src/
│   │   ├── index.ts            # Main poll loop
│   │   ├── api.ts              # HTTP client for Lovable REST API
│   │   ├── mc.ts               # mineflayer runtime
│   │   └── discord.ts          # Discord HTTP API spammer
│   ├── .env                    # SITE_URL + WORKER_SECRET
│   └── package.json
└── supabase/
    └── migrations/             # SQL schema (reference only)
```

---

## Environment Variables Reference

### Lovable Cloud (set in Lovable Dashboard → Settings → Env Vars)

| Variable | Purpose | Required |
|---|---|---|
| `SESSION_SECRET` | Encrypts session cookies | Yes |
| `ADMIN_PASSWORD` | Password for admin access | Yes |
| `WORKER_SECRET` | Auth token for bot-worker REST API | Yes |
| `IPN_CALLBACK_URL` | NOWPayments webhook URL | Yes |
| `DISCORD_CLIENT_ID` | Discord OAuth app ID | Yes |
| `DISCORD_CLIENT_SECRET` | Discord OAuth app secret | Yes |
| `DISCORD_BOT_TOKEN` | Discord bot for guild auto-join + DMs | Yes |
| `NOWPAYMENTS_API_KEY` | NowPayments API key | Yes |
| `NOWPAYMENTS_IPN_SECRET` | NowPayments webhook signature verification | Yes |
| `SUPABASE_URL` | Auto-managed by Lovable | Auto |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-managed by Lovable | Auto |
| `SUPABASE_ANON_KEY` | Auto-managed by Lovable | Auto |

### Bot Worker (set in `bot-worker/.env` on VPS)

| Variable | Purpose | Required |
|---|---|---|
| `SITE_URL` | Your Lovable site URL | Yes |
| `WORKER_SECRET` | Must match Lovable's `WORKER_SECRET` | Yes |
| `WORKER_ID` | Unique ID for this worker instance | Yes |
| `POLL_INTERVAL_MS` | How often to poll for jobs (default: 3000) | No |
