# LuauX Full Setup Guide

Complete step-by-step guide to deploy the LuauX Minecraft bot management platform from scratch.

---

## Table of Contents

1. [What You're Building](#1-what-youre-building)
2. [Prerequisites](#2-prerequisites)
3. [Deploy the LuauX site](#3-deploy-the-hosting-site)
4. [Configure Vercel environment Variables](#4-configure-hosting-environment-variables)
5. [Configure Discord OAuth2](#5-configure-discord-oauth2)
6. [Run All Database Migrations](#6-run-all-database-migrations)
7. [Set Up the Bot Worker on Your VPS](#7-set-up-the-bot-worker-on-your-vps)
8. [Test Everything](#8-test-everything)
9. [Admin Access](#9-admin-access)
10. [How It Works](#10-how-it-works)
11. [Troubleshooting](#11-troubleshooting)
12. [File Structure](#12-file-structure)
13. [Environment Variables Reference](#13-environment-variables-reference)

---

## 1. What You're Building

A web platform where users:

- Log in with Discord
- Manage auto-message bots on Minecraft servers (via SSID / offline auth)
- Manage Discord auto-spam bots (user token, HTTP API)
- Pay with crypto (LTC, SOL, USDT, USDC) via NOWPayments
- View live terminal-style console output for all running bots

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”       HTTP (REST API)        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  LuauX site                â”‚â—„â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–ºâ”‚  Bot Worker            â”‚
â”‚  (UI + Auth + Payments)      â”‚                                â”‚  (Your VPS)            â”‚
â”‚                              â”‚  - POST /api/bots/worker/poll  â”‚                       â”‚
â”‚  Cloudflare edge runtime     â”‚  - POST /api/bots/worker/log   â”‚  Runs MC mineflayer   â”‚
â”‚  Managed Supabase (DB+RLS)   â”‚  - POST /api/bots/worker/updateâ”‚  Runs Discord HTTP    â”‚
â”‚  Discord OAuth2              â”‚                                â”‚  spam bots             â”‚
â”‚  NOWPayments crypto gateway  â”‚                                â”‚  No Supabase creds    â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                                â”‚  needed on worker      â”‚
                                                                â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Key design**: The bot worker has NO access to the database. It communicates with the LuauX site exclusively via HTTP REST API endpoints. The LuauX site acts as the bridge between the worker and Supabase.

---

## 2. Prerequisites

### For the LuauX site (hosted)

- [Vercel](https://vercel.com) account (free tier works)
- GitHub repository connected to hosting

### For the bot worker (your VPS)

- Windows VPS with RDP access (or Linux with SSH)
- Node.js 22+ installed
- Git installed
- At least 1 GB free RAM

### Accounts you need

- [Discord Developer Portal](https://discord.com/developers/applications) account
- [NOWPayments](https://nowpayments.io) account (merchant)
- [Supabase](https://supabase.com) (managed by hosting â€” don't create one manually)

---

## 3. Deploy the LuauX site

### 3a. Push the code to GitHub

The repository must be connected to your Vercel project.

```bash
cd luauxbeaming
git add -A
git commit -m "initial deploy"
git push origin main
```

hosting auto-deploys on every push to the connected branch.

### 3b. Wait for the first deploy

Go to [Vercel Dashboard](https://hosting.dev/projects) â†’ your project. Watch the build logs. The first deploy takes 2-3 minutes. When it's done you'll see a live URL like `https://luaux.wtf`.

---

## 4. Configure Vercel environment Variables

Go to your Vercel project â†’ **Settings** (gear icon) â†’ **Environment Variables**.

Add every variable in this table. **Do not skip any.**

| Variable                 | Value                                                              | Notes                                                                              |
| ------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `SESSION_SECRET`         | `YOUR_SESSION_SECRET` | Encrypts session cookies. Never change after first deploy.                         |
| `ADMIN_PASSWORD`         | `YOUR_ADMIN_PASSWORD`                                 | Password to unlock admin mode in the dashboard.                                    |
| `WORKER_SECRET`          | `YOUR_WORKER_SECRET` | Shared secret between site and bot worker. Must match exactly.                     |
| `IPN_CALLBACK_URL`       | `https://luaux.wtf/api/public/nowpayments/webhook`  | NOWPayments sends payment confirmations here.                                      |
| `DISCORD_CLIENT_ID`      | Your Discord app client ID                                         | From Discord Developer Portal â†’ OAuth2 â†’ Client Information                        |
| `DISCORD_CLIENT_SECRET`  | Your Discord app client secret                                     | From Discord Developer Portal â†’ OAuth2 â†’ Client Information                        |
| `DISCORD_BOT_TOKEN`      | Your Discord bot token                                             | From Discord Developer Portal â†’ Bot â†’ Token. Used for auto-joining guilds and DMs. |
| `NOWPAYMENTS_API_KEY`    | Your NOWPayments API key                                           | From NOWPayments Dashboard â†’ Merchant â†’ API Keys                                   |
| `NOWPAYMENTS_IPN_SECRET` | Your NOWPayments IPN secret                                        | From NOWPayments Dashboard â†’ Merchant â†’ IPN. Used to verify webhook signatures.    |

> **DO NOT set** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or `SUPABASE_ANON_KEY`. hosting manages these automatically. Setting them manually will break things.

After adding all variables, click **Save** and hosting will trigger a redeploy.

---

## 5. Configure Discord OAuth2

### 5a. Create a Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** â†’ name it (e.g. "LuauX") â†’ **Create**
3. Go to **OAuth2** in the left sidebar
4. Copy the **Client ID** and **Client Secret** (generate one if needed)
5. Paste these into the Vercel environment variables as `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`

### 5b. Set the Redirect URI

In the same OAuth2 page:

1. Under **Redirects**, click **Add Redirect**
2. Enter:
   ```
   https://luaux.wtf/api/discord/callback
   ```
3. Click **Save Changes**

### 5c. Create a Discord Bot (for auto-join + DMs)

1. In the Developer Portal, go to **Bot** in the left sidebar
2. Under **Token**, click **Reset Token** and copy it
3. Paste it into the Vercel env var `DISCORD_BOT_TOKEN`
4. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (required)
   - **Server Members Intent** (recommended)
5. Click **Save Changes**

### 5d. Invite the bot to your server

1. Go to **OAuth2** â†’ **URL Generator**
2. Under **Scopes**, check `bot`
3. Under **Bot Permissions**, check:
   - Send Messages
   - Read Message History
   - Embed Links
   - Use Slash Commands
4. Copy the generated URL and open it in a browser
5. Select your Discord server and authorize

---

## 6. Run All Database Migrations

The hosting-managed Supabase starts empty. You must create all tables manually using the SQL Editor.

### 6a. Open the SQL Editor

1. Go to your Vercel project â†’ **Cloud** tab â†’ **Database** â†’ **SQL Editor**
2. You'll see an empty editor. Paste SQL here and click **Run**.

### 6b. Run this SQL (all tables in one block)

Paste the ENTIRE block below and click **Run**. This creates every table the platform needs:

```sql
-- ============================================================
-- TABLE: plans
-- The catalog of plans and plugins available for purchase
-- ============================================================
CREATE TABLE IF NOT EXISTS public.plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_usd NUMERIC(10,2) NOT NULL,
  max_bots INTEGER NOT NULL,
  bot_hours INTEGER NOT NULL,
  duration_days INTEGER NOT NULL,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'plan',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read plans" ON public.plans FOR SELECT USING (true);

INSERT INTO public.plans (id, name, price_usd, max_bots, bot_hours, duration_days, features, sort_order, kind) VALUES
  ('basic', 'Basic', 15.00, 1, 50, 30, '["1 concurrent bot","50 bot hours","Live console","Auto-reconnect"]'::jsonb, 1, 'plan'),
  ('pro',   'Pro',   35.00, 3, 200, 30, '["3 concurrent bots","200 bot hours","Discord webhooks","Priority queue","All plugins"]'::jsonb, 2, 'plan'),
  ('elite', 'Elite', 79.00, 10, 720, 30, '["10 concurrent bots","720 bot hours","24/7 uptime","White-glove support","All plugins + beta"]'::jsonb, 3, 'plan')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, price_usd = EXCLUDED.price_usd, max_bots = EXCLUDED.max_bots,
  bot_hours = EXCLUDED.bot_hours, duration_days = EXCLUDED.duration_days,
  features = EXCLUDED.features, sort_order = EXCLUDED.sort_order, kind = EXCLUDED.kind;

INSERT INTO public.plans (id, name, price_usd, max_bots, bot_hours, duration_days, features, sort_order, kind) VALUES
  ('verification', 'Verification Bot', 10.00, 0, 0, 30, '["Auto-generated monthly license key","Delivered via Discord DM","Renew anytime"]'::jsonb, 100, 'plugin'),
  ('discord-spam', 'Discord Spam', 10.00, 0, 0, 36500, '["Unlimited tokens with rotation","Custom message pool & interval","Auto-delete sent messages","Replace mode & failure limit","Live console"]'::jsonb, 20, 'plugin'),
  ('discord-autoreply', 'Discord Auto-Reply', 10.00, 0, 0, 36500, '["DM mode & Friend mode","Humanized reply delay & typing","Multi-token rotation","Live console"]'::jsonb, 21, 'plugin')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, price_usd = EXCLUDED.price_usd, features = EXCLUDED.features,
  duration_days = EXCLUDED.duration_days, kind = EXCLUDED.kind, sort_order = EXCLUDED.sort_order;

-- ============================================================
-- TABLE: profiles
-- User profiles keyed by Discord user ID
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  discord_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  global_name TEXT,
  avatar_url TEXT,
  active_plan_id TEXT REFERENCES public.plans(id),
  plan_expires_at TIMESTAMPTZ,
  bot_hours_remaining NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ============================================================
-- TABLE: payments
-- NOWPayments invoices and transaction tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL REFERENCES public.profiles(discord_id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES public.plans(id),
  np_payment_id TEXT UNIQUE,
  np_order_id TEXT UNIQUE NOT NULL,
  pay_currency TEXT NOT NULL,
  pay_amount NUMERIC(20,8),
  pay_address TEXT,
  price_amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  confirmations INTEGER NOT NULL DEFAULT 0,
  required_confirmations INTEGER NOT NULL DEFAULT 2,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_discord_idx ON public.payments(discord_id, created_at DESC);
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER payments_touch BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ============================================================
-- TABLE: mc_accounts
-- Minecraft accounts with SSID/offline auth credentials
-- ============================================================
CREATE TABLE IF NOT EXISTS public.mc_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL REFERENCES public.profiles(discord_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('microsoft','ssid','offline')),
  username TEXT,
  ssid TEXT,
  uuid TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mc_accounts_discord_idx ON public.mc_accounts(discord_id);
GRANT ALL ON public.mc_accounts TO service_role;
ALTER TABLE public.mc_accounts ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: verification_keys
-- License keys for plugin access (verification bot, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.verification_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  plugin_id TEXT NOT NULL DEFAULT 'verification',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered BOOLEAN NOT NULL DEFAULT false,
  source_payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS verification_keys_discord_idx ON public.verification_keys(discord_id, expires_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.verification_keys TO authenticated;
GRANT ALL ON public.verification_keys TO service_role;
ALTER TABLE public.verification_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.verification_keys
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- TABLE: bot_jobs
-- hosting UI writes pending jobs, bot-worker claims and runs them
-- ============================================================
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
CREATE TRIGGER bot_jobs_touch BEFORE UPDATE ON public.bot_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT ALL ON public.bot_jobs TO service_role;
ALTER TABLE public.bot_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.bot_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- TABLE: bot_logs
-- Bot-worker writes log entries, hosting UI reads them
-- ============================================================
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

### 6c. Verify it worked

Run this to confirm all tables exist:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

You should see: `bot_jobs`, `bot_logs`, `mc_accounts`, `payments`, `plans`, `profiles`, `verification_keys`

---

## 7. Set Up the Bot Worker on Your VPS

The bot worker is a standalone Node.js application. It runs on your VPS and polls the LuauX site for jobs.

### 7a. Copy bot-worker to the VPS

Copy the entire `bot-worker/` folder from the repository to your VPS. For example:

```
C:\Users\Administrator\Desktop\luaux-bot-worker\
```

The folder should contain:

```
bot-worker/
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ index.ts       # Main entry point â€” poll loop + graceful shutdown
â”‚   â”œâ”€â”€ api.ts         # HTTP client for the hosting REST API
â”‚   â”œâ”€â”€ mc.ts          # Mineflayer MC bot logic
â”‚   â””â”€â”€ discord.ts     # Discord HTTP API spam logic
â”œâ”€â”€ package.json
â”œâ”€â”€ tsconfig.json
â”œâ”€â”€ .env               # â† You create this
â”œâ”€â”€ .env.example       # Reference template
â””â”€â”€ .gitignore
```

### 7b. Install Node.js 22+

On the VPS, open a browser and go to https://nodejs.org. Download the **LTS** version (22+) and run the installer. Accept all defaults.

Verify it's installed by opening a terminal:

```bash
node --version
# Should show v22.x.x or higher
```

### 7c. Install dependencies

Open a terminal (PowerShell or Command Prompt) on the VPS:

```bash
cd C:\Users\Administrator\Desktop\luaux-bot-worker
npm install
```

This installs `mineflayer`, `dotenv`, and dev tools. It takes about 30 seconds.

### 7d. Create the `.env` file

Create a file called `.env` (no extension, just `.env`) in the `bot-worker/` folder with these exact contents:

```
SITE_URL=https://luaux.wtf
WORKER_SECRET=YOUR_WORKER_SECRET
WORKER_ID=worker-1
POLL_INTERVAL_MS=3000
```

> **CRITICAL**: The `WORKER_SECRET` here must **exactly match** the `WORKER_SECRET` you set in Vercel environment variables in Step 4. If even one character is different, all requests will fail with 401 Unauthorized.

### 7e. Test the worker

In the same terminal:

```bash
npm run dev
```

You should see:

```
[worker] worker-1 started, polling every 3000ms
[worker] poll ok: 0 pending jobs
```

Leave this terminal open. The worker is now running and polling the LuauX site every 3 seconds for new jobs.

**If you see errors**, check the [Troubleshooting](#11-troubleshooting) section.

### 7f. Run as a background service (production)

For production use, the worker should run in the background and auto-restart on crash.

**Option A: pm2 (recommended)**

```bash
npm install -g pm2
cd C:\Users\Administrator\Desktop\luaux-bot-worker
pm2 start "npx tsx src/index.ts" --name luaux-worker
pm2 save
pm2 startup
```

To view logs:

```bash
pm2 logs luaux-worker
```

To restart after code updates:

```bash
pm2 restart luaux-worker
```

**Option B: Windows Task Scheduler**

1. Open Task Scheduler
2. Create Basic Task â†’ name it "LuauX Bot Worker"
3. Trigger: "At log on"
4. Action: "Start a program"
   - Program: `C:\Program Files\nodejs\node.exe`
   - Arguments: `C:\Users\Administrator\Desktop\luaux-bot-worker\src\index.ts`
   - Start in: `C:\Users\Administrator\Desktop\luaux-bot-worker`
5. Finish

---

## 8. Test Everything

### 8a. Test the LuauX site

1. Open `https://luaux.wtf` in your browser
2. Click **Login with Discord**
3. Authorize the app on Discord
4. You should see the dashboard

### 8b. Test MC Auto-Message

1. Go to the **MC Auto-Message** page in the dashboard
2. Click the **Settings** tab â†’ **Admin** sub-tab
3. Enter the admin password: `YOUR_ADMIN_PASSWORD`
4. You should see "ADMIN" badge appear
5. Go back to **MC Auto-Message**
6. Add a Minecraft account:
   - **Label**: any name (e.g. "Test Bot")
   - **Auth Type**: pick based on your server:
     - `offline` â€” for cracked/offline-mode servers (no credentials needed, just a username)
     - `ssid` â€” for premium servers (requires SSID token + username + UUID)
   - **Username**: your Minecraft username
   - For SSID auth: also fill in **SSID token** and **UUID**
7. Enter the **Server Configuration**:
   - **Server IP**: the Minecraft server address (e.g. `play.example.com`)
   - **Server Port**: `25565` (default)
   - **Messages**: type messages, one per line
   - **Interval**: seconds between messages (default: 5)
8. Click **Ping Server** â€” should show player count and MOTD
9. Click **Launch** on the account
10. You should see live console output within 3-5 seconds
11. Click **Stop** to shut down the bot

#### Finding your SSID token and UUID (for premium servers)

Your SSID token is the Minecraft session access token. The UUID is your player's unique identifier.

**Method 1: Namemc.com**

1. Go to https://namemc.com/profile/YourUsername
2. Your UUID is displayed on the profile page (with dashes, e.g. `12345678-abcd-1234-abcd-123456789abc`)
3. Enter it in the UUID field â€” dashes are automatically removed

**Method 2: Mojang API**

1. Go to https://api.mojang.com/users/profiles/minecraft/YourUsername
2. The `id` field is your UUID (without dashes)

**For the SSID token**: This is the session access token from Microsoft authentication. You can obtain it using tools like [MinecraftToken](https://github.com/MinecraftToken/MinecraftToken) or similar tools that authenticate via Microsoft OAuth and return the session data.

### 8c. Test Discord Auto-Spam

1. Go to the **Discord Auto-Spam** page
2. Get your Discord **user token** (NOT a bot token):
   - Open Discord in a web browser (e.g. discord.com/app)
   - Press **F12** to open DevTools
   - Go to the **Network** tab
   - Click on any channel to trigger a request
   - Find a request to `discord.com/api/v9/channels/...`
   - Click on it â†’ **Headers** tab â†’ find the `Authorization` header
   - Copy the value (it's a long string, does NOT start with "Bot")
3. Enter the token, channel ID, and messages
4. Click **Start Spamming**
5. Watch the live console output

### 8d. Test payments (optional)

1. Go to the **Plans** or **Purchase** page
2. Select a plan
3. NOWPayments should generate a crypto invoice
4. You can test with a small amount (e.g. $1 worth of LTC)
5. The webhook should confirm payment and activate the plan

---

## 9. Admin Access

Admin is password-based, not a database role. Anyone who enters the correct password in the Settings tab gets admin privileges.

### How it works

- Session flag `isAdmin` is set when you enter the correct password
- Admin bypasses all payment gates (MC bots, Discord spam, plugins)
- Admin sees an "ADMIN" badge in the dashboard
- Admin can manage MC accounts without bot-hour limits

### Login

1. Go to **Settings** tab in the dashboard
2. Click the **Admin** sub-tab
3. Enter the admin password
4. Click **Login**
5. The page reloads â€” you should see "ADMIN" badge

### Logout

1. Settings â†’ Admin â†’ click **Logout**

### Change the password

1. Go to Vercel Dashboard â†’ Settings â†’ Environment Variables
2. Update `ADMIN_PASSWORD` to a new value
3. Save â€” hosting will redeploy

---

## 10. How It Works

### MC Auto-Message Flow

```
User clicks "Launch"
       â”‚
       â–¼
POST /api/bots/mc/start  â†’  bot_jobs row (status: pending, config: JSONB)
       â”‚
       â–¼
Bot-worker polls POST /api/bots/worker/poll  every 3 seconds
       â”‚
       â–¼
Worker claims the job  â†’  bot_jobs row (status: running, worker_id: "worker-1")
       â”‚
       â–¼
Worker runs mineflayer bot with the user's config (SSID, server, messages, interval)
       â”‚
       â–¼
Bot connects to Minecraft server, sends messages on interval
       â”‚
       â–¼
Worker posts logs to POST /api/bots/worker/log  (batched every 2 seconds)
       â”‚
       â–¼
Frontend reads logs via SSE endpoint (polls every 2 seconds)
       â”‚
       â–¼
User clicks "Stop"  â†’  API sets status to "stopping"
       â”‚
       â–¼
Worker detects stop signal on next poll, aborts the bot
       â”‚
       â–¼
Worker sets status to "completed"  â†’  job done
```

### Discord Auto-Spam Flow

```
User enters token + channel + messages, clicks "Start"
       â”‚
       â–¼
POST /api/bots/discord/start  â†’  bot_jobs row (status: pending)
       â”‚
       â–¼
Bot-worker picks up the job
       â”‚
       â–¼
Worker sends messages via Discord HTTP API (POST discord.com/api/v9/channels/{id}/messages)
       â”‚
       â”œâ”€â”€ Random delays between messages (humanization)
       â”œâ”€â”€ Auto-delete sent messages (optional)
       â”œâ”€â”€ Handles rate limits (429 responses)
       â””â”€â”€ No Gateway connection â€” pure HTTP
```

### Payment Flow

```
User clicks "Buy" on a plan
       â”‚
       â–¼
POST /api/public/nowpayments/create  â†’  NOWPayments creates invoice
       â”‚
       â–¼
User sees crypto wallet address + amount
       â”‚
       â–¼
User sends crypto (LTC, SOL, USDT, USDC)
       â”‚
       â–¼
NOWPayments sends webhook to POST /api/public/nowpayments/webhook
       â”‚
       â”œâ”€â”€ Verifies IPN signature (HMAC-SHA512)
       â”œâ”€â”€ Checks confirmations (waits for 2+)
       â”‚
       â–¼
On payment confirmed:
  â”œâ”€â”€ Plan purchases  â†’  sets active_plan_id + plan_expires_at + bot_hours
  â”œâ”€â”€ Plugin purchases â†’  generates license key + DMs it to user
  â””â”€â”€ Hours-only packs â†’  adds bot hours + sets plan expiry
```

---

## 11. Troubleshooting

### "No active plan" on MC Auto-Message

- You need to purchase a plan first, or log in as admin (admin bypasses this)

### "No active Discord Spam license"

- You need to purchase the Discord Spam plugin ($10), or log in as admin

### Bot doesn't start / no console output

1. Check the bot-worker terminal â€” is it running? Any errors?
2. Check the hosting deploy â€” did it succeed?
3. Check that `WORKER_SECRET` matches exactly in both Vercel env vars AND bot-worker `.env`
4. Open browser DevTools â†’ Network â†’ check if `/api/bots/worker/poll` returns 200

### Discord login goes to localhost

- Update the OAuth2 redirect URI in Discord Developer Portal (Step 5b)

### Logs not showing in real-time

- The SSE stream polls every 2 seconds â€” a slight delay is normal
- Check bot-worker terminal for any connection errors

### Bot worker shows "poll failed: 401"

- `WORKER_SECRET` doesn't match between Vercel env vars and bot-worker `.env`
- Copy-paste the exact same value into both places

### Bot worker shows "poll failed: 404"

- The LuauX site hasn't deployed the worker API endpoints yet
- Push the latest code to GitHub and wait for hosting to rebuild (check deploy logs)

### mineflayer won't connect to server

- **Offline server**: Make sure the server allows cracked/offline-mode clients
- **Premium server**: SSID token must be valid (not expired), and UUID must be correct
- Check the bot console logs for specific error messages
- Try a different server to rule out server-side issues
- Test with `Ping Server` first to confirm the server is reachable

### mineflayer connects but messages aren't sending

- Some servers have anti-spam plugins that block repeated messages
- Increase the interval (e.g. from 5s to 10s or 15s)
- Use more varied message content

### Discord spam isn't sending

- Your user token may be invalid or expired â€” get a fresh one from DevTools
- The channel ID must be correct (right-click channel â†’ Copy ID with Developer Mode enabled)
- Discord may be rate-limiting â€” check the console for 429 errors
- **Warning**: Using user tokens (self-botting) violates Discord TOS and can result in account ban

### VPS RDP won't connect

- Check your VPS provider's firewall rules
- Ensure RDP (port 3389) is allowed inbound
- Try restarting the VPS from the provider's control panel

---

## 12. File Structure

```
luauxbeaming/
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ routes/
â”‚   â”‚   â”œâ”€â”€ api/
â”‚   â”‚   â”‚   â”œâ”€â”€ admin/
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ login.ts              # Admin password â†’ session.isAdmin
â”‚   â”‚   â”‚   â”‚   â””â”€â”€ logout.ts             # Clears isAdmin from session
â”‚   â”‚   â”‚   â”œâ”€â”€ bots/
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ mc/
â”‚   â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ start.ts          # Creates bot_jobs row (type: mc)
â”‚   â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ stop.ts           # Sets job status to "stopping"
â”‚   â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ status.ts         # Returns current bot status
â”‚   â”‚   â”‚   â”‚   â”‚   â””â”€â”€ ping.ts           # Pings MC server via api.mcsrvstat.us
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ discord/
â”‚   â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ start.ts          # Creates bot_jobs row (type: discord)
â”‚   â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ stop.ts           # Sets job status to "stopping"
â”‚   â”‚   â”‚   â”‚   â”‚   â””â”€â”€ status.ts         # Returns current bot status
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ worker/
â”‚   â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ poll.ts           # Worker claims pending/stopping jobs
â”‚   â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ log.ts            # Worker posts batched log entries
â”‚   â”‚   â”‚   â”‚   â”‚   â””â”€â”€ update.ts         # Worker updates job status
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ logs.ts              # Read bot logs for display
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ stream.ts            # SSE endpoint for live log streaming
â”‚   â”‚   â”‚   â”‚   â””â”€â”€ all-status.ts        # Returns all active bot statuses
â”‚   â”‚   â”‚   â”œâ”€â”€ discord.login.ts          # Redirects to Discord OAuth2
â”‚   â”‚   â”‚   â”œâ”€â”€ discord.callback.ts       # Handles OAuth2 callback
â”‚   â”‚   â”‚   â”œâ”€â”€ discord.logout.ts         # Clears Discord session
â”‚   â”‚   â”‚   â”œâ”€â”€ me.ts                     # Returns current user + isAdmin flag
â”‚   â”‚   â”‚   â””â”€â”€ public/
â”‚   â”‚   â”‚       â””â”€â”€ nowpayments/
â”‚   â”‚   â”‚           â””â”€â”€ webhook.ts        # NOWPayments IPN callback
â”‚   â”‚   â”œâ”€â”€ dashboard.tsx                 # Dashboard layout + sidebar nav
â”‚   â”‚   â”œâ”€â”€ dashboard.index.tsx           # Main dashboard / home
â”‚   â”‚   â”œâ”€â”€ dashboard.bots.tsx            # MC Auto-Message page
â”‚   â”‚   â”œâ”€â”€ dashboard.discord-spam.tsx    # Discord Auto-Spam page
â”‚   â”‚   â”œâ”€â”€ dashboard.discord-bot.tsx     # Discord Bot Launcher page
â”‚   â”‚   â”œâ”€â”€ dashboard.discord-auto-reply.tsx  # Discord Auto-Reply (placeholder)
â”‚   â”‚   â”œâ”€â”€ dashboard.verification-bot.tsx    # Verification Bot page
â”‚   â”‚   â”œâ”€â”€ dashboard.billing.tsx         # Plans / purchase page
â”‚   â”‚   â”œâ”€â”€ dashboard.settings.tsx        # Settings + admin panel
â”‚   â”‚   â”œâ”€â”€ dashboard.logs.tsx            # Historical logs viewer
â”‚   â”‚   â””â”€â”€ dashboard.support.tsx         # Support page
â”‚   â”œâ”€â”€ lib/
â”‚   â”‚   â”œâ”€â”€ api-helpers.ts               # Session helpers (getSessionUser, requireUser, etc.)
â”‚   â”‚   â”œâ”€â”€ luaux.functions.ts            # Server functions (DB queries, plan checks)
â”‚   â”‚   â””â”€â”€ luaux-server.server.ts        # Server-side Supabase client + session utilities
â”‚   â””â”€â”€ components/
â”‚       â”œâ”€â”€ bot-console.tsx               # Shared terminal log display component
â”‚       â””â”€â”€ plugin-page.tsx              # Shared plugin launcher UI
â”œâ”€â”€ bot-worker/
â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â”œâ”€â”€ index.ts                      # Main poll loop + graceful shutdown
â”‚   â”‚   â”œâ”€â”€ api.ts                        # HTTP client (poll, log, update, fetchWithRetry)
â”‚   â”‚   â”œâ”€â”€ mc.ts                         # Mineflayer bot (SSID auth, 30s timeout)
â”‚   â”‚   â””â”€â”€ discord.ts                    # Discord HTTP API spam (rate limit, abort)
â”‚   â”œâ”€â”€ .env                              # SITE_URL + WORKER_SECRET (NOT in git)
â”‚   â”œâ”€â”€ .env.example                      # Template
â”‚   â”œâ”€â”€ .gitignore                        # Excludes .env and node_modules
â”‚   â”œâ”€â”€ package.json                      # deps: mineflayer, dotenv
â”‚   â””â”€â”€ tsconfig.json
â”œâ”€â”€ supabase/
â”‚   â””â”€â”€ migrations/                       # SQL migration files (reference only)
â”‚       â”œâ”€â”€ 20260709122619_...sql         # plans, profiles, payments, mc_accounts
â”‚       â”œâ”€â”€ 20260709124925_...sql         # verification_keys + plugin plans
â”‚       â”œâ”€â”€ 20260709130412_...sql         # discord-spam + discord-autoreply plans
â”‚       â”œâ”€â”€ 20260709132431_...sql         # Misc schema updates
â”‚       â”œâ”€â”€ 20260710000000_bot_worker.sql # bot_jobs + bot_logs tables
â”‚       â”œâ”€â”€ 20260710080907_...sql         # Additional indexes
â”‚       â”œâ”€â”€ 20260710093154_...sql         # RLS policy updates
â”‚       â”œâ”€â”€ 20260711000000_add_completed_status.sql  # Adds 'completed' to status CHECK
â”‚       â””â”€â”€ 20260711000001_add_mc_accounts_uuid.sql  # Adds uuid column to mc_accounts
â”œâ”€â”€ vite.config.ts                        # Build config (mineflayer/discord externalized)
â”œâ”€â”€ package.json
â”œâ”€â”€ tsconfig.json
â”œâ”€â”€ components.json                       # shadcn/ui config
â”œâ”€â”€ eslint.config.js
â”œâ”€â”€ bun.lock
â””â”€â”€ SETUP_GUIDE.md                        # This file
```

---

## 13. Environment Variables Reference

### Vercel (set in Vercel Dashboard â†’ Settings â†’ Env Vars)

| Variable                    | Purpose                                | Required       |
| --------------------------- | -------------------------------------- | -------------- |
| `SESSION_SECRET`            | Encrypts session cookies               | **Yes**        |
| `ADMIN_PASSWORD`            | Password to unlock admin mode          | **Yes**        |
| `WORKER_SECRET`             | Auth token for bot-worker REST API     | **Yes**        |
| `IPN_CALLBACK_URL`          | NOWPayments webhook URL                | **Yes**        |
| `DISCORD_CLIENT_ID`         | Discord OAuth2 app ID                  | **Yes**        |
| `DISCORD_CLIENT_SECRET`     | Discord OAuth2 app secret              | **Yes**        |
| `DISCORD_BOT_TOKEN`         | Discord bot token (auto-join + DMs)    | **Yes**        |
| `NOWPAYMENTS_API_KEY`       | NOWPayments API key                    | **Yes**        |
| `NOWPAYMENTS_IPN_SECRET`    | NOWPayments IPN signature verification | **Yes**        |
| `SUPABASE_URL`              | Auto-managed by hosting                | **Do NOT set** |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-managed by hosting                | **Do NOT set** |
| `SUPABASE_ANON_KEY`         | Auto-managed by hosting                | **Do NOT set** |

### Bot Worker (set in `bot-worker/.env` on VPS)

| Variable           | Purpose                                                         | Required |
| ------------------ | --------------------------------------------------------------- | -------- |
| `SITE_URL`         | Your LuauX site URL (e.g. `https://luaux.wtf`) | **Yes**  |
| `WORKER_SECRET`    | Must match Vercel `WORKER_SECRET` exactly                    | **Yes**  |
| `WORKER_ID`        | Unique ID for this worker instance (e.g. `worker-1`)            | **Yes**  |
| `POLL_INTERVAL_MS` | How often to poll for jobs (default: `3000`)                    | No       |

---

## Quick Reference: Key Credentials

| Credential     | Value                                                              | Where it's used                            |
| -------------- | ------------------------------------------------------------------ | ------------------------------------------ |
| Admin password | `YOUR_ADMIN_PASSWORD`                                 | Dashboard Settings â†’ Admin tab             |
| Worker secret  | `YOUR_WORKER_SECRET` | Vercel env vars + bot-worker `.env`       |
| Session secret | `YOUR_SESSION_SECRET` | Vercel env vars only                      |
| Site URL       | `https://luaux.wtf`                                 | bot-worker `.env` + Discord OAuth redirect |


