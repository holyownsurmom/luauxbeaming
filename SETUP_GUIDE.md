# LuauX Setup Guide

## Step 1: Run the Database Migration

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **SQL Editor** (left sidebar)
4. Paste the entire contents of `supabase/migrations/20260710000000_bot_worker.sql` and click **Run**

This creates:
- `bot_jobs` table (where the UI queues bots)
- `bot_logs` table (where bots write their output)
- `role` column on `profiles` (for admin access)

## Step 2: Make Yourself Admin

Still in the SQL Editor, run:
```sql
UPDATE profiles SET role = 'admin' WHERE discord_id = 'YOUR_DISCORD_ID';
```

To find your Discord ID: enable Developer Mode in Discord settings, then right-click your username and "Copy User ID".

Admin users bypass all payment requirements — no plan purchase needed to use MC Auto-Message or Discord Auto-Spam.

## Step 3: Set Environment Variables in Lovable

1. Go to your [Lovable Dashboard](https://lovable.dev/projects)
2. Select your project
3. Go to **Settings** (gear icon) → **Environment Variables**
4. Add these (you may already have some):

| Variable | Where to find it |
|---|---|
| `SESSION_SECRET` | Any random string, e.g. `openssl rand -hex 32` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role key |
| `DISCORD_CLIENT_ID` | Discord Developer Portal → Your App → General Information |
| `DISCORD_CLIENT_SECRET` | Discord Developer Portal → Your App → General Information |
| `DISCORD_BOT_TOKEN` | Discord Developer Portal → Bot → Token |
| `NOWPAYMENTS_API_KEY` | NowPayments Dashboard → API Keys |
| `NOWPAYMENTS_IPN_SECRET` | NowPayments Dashboard → IPN Secret |

5. Click **Save** — Lovable will auto-rebuild

## Step 4: Update Discord OAuth Redirect URI

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your LuauX app
3. Go to **OAuth2** → **Redirects**
4. Update the redirect URI to:
```
https://luauxbeaming.lovable.app/api/discord/callback
```
5. Click **Save Changes**

## Step 5: Deploy the Bot Worker

The bot worker is a separate Node.js process that runs the actual Minecraft/Discord bots. It cannot run inside Lovable — it needs a real server.

### Option A: Railway (Recommended)

1. Create a new GitHub repo and push the `bot-worker/` folder to it
2. Go to [Railway](https://railway.app) and sign up
3. Click **New Project** → **Deploy from GitHub Repo**
4. Select your `bot-worker` repo
5. Go to the **Variables** tab and add:
   - `SUPABASE_URL` = `https://your-project.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = your service role key
   - `WORKER_ID` = `worker-1`
6. Railway will build and start running automatically
7. Keep it running 24/7 — costs ~$5/month

### Option B: Your Own PC (Testing Only)

1. Install [Node.js 22+](https://nodejs.org)
2. Open a terminal and run:
```bash
cd bot-worker
npm install
cp .env.example .env
```
3. Edit `.env` with your Supabase credentials
4. Run: `npm run dev`
5. Leave the terminal open — the bot worker must stay running

### Option C: VPS (Hetzner, DigitalOcean, etc.)

1. SSH into your server
2. Clone the repo
3. Run:
```bash
cd bot-worker
npm install
npm run build
```
4. Set up as a systemd service (see `bot-worker/README.md` for full instructions)

## Step 6: Test It

1. Go to `https://luauxbeaming.lovable.app`
2. Log in with Discord
3. Go to **MC Auto-Message**
   - Enter a server IP and port
   - Click **Ping Server** to verify it's online
   - Add a Minecraft account (paste your SSID)
   - Click **Launch**
   - You should see live console output
4. Go to **Discord Auto-Spam**
   - If you're admin, you'll see the control panel directly
   - If not admin, you need to purchase a license key first
   - Enter a bot token, channel ID, and messages
   - Click **Start Spamming**
   - Watch the live console

## Troubleshooting

**"No active plan" on MC Auto-Message**
- You need to purchase a plan first at Purchase, or set yourself as admin

**"No active Discord Spam license"**
- You need to purchase the Discord Spam plugin for $10, or set yourself as admin

**Bot doesn't start / no console output**
- Make sure the bot worker is running (check Railway logs)
- Make sure you ran the SQL migration
- Make sure `SUPABASE_SERVICE_ROLE_KEY` is set in both Lovable AND the bot worker

**Discord login redirect goes to localhost**
- Update the OAuth redirect URI in Discord Developer Portal (Step 4)

**Logs not showing in real-time**
- The SSE stream polls every 2 seconds — slight delay is normal
- Make sure the bot worker is writing logs (check Railway logs)

## Admin Access

Admin users see an "ADMIN" badge on the MC Auto-Message and Discord Auto-Spam pages. Admins bypass:
- Active plan requirement
- Bot hours limit
- License key requirement
- All payment gates

To make someone else an admin:
```sql
UPDATE profiles SET role = 'admin' WHERE discord_id = 'THEIR_DISCORD_ID';
```

To remove admin access:
```sql
UPDATE profiles SET role = 'user' WHERE discord_id = 'THEIR_DISCORD_ID';
```
