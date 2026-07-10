# LuauX Bot Worker

Runs Minecraft and Discord bots on a real Node.js host (Railway, Fly.io, or VPS).

The Lovable site (UI, auth, payments) writes job rows to Supabase. This worker picks them up, runs the actual bots, and writes logs back.

## Setup

1. Copy `.env.example` to `.env` and fill in your Supabase credentials
2. `npm install`
3. `npm run dev` (development) or `npm run build && npm start` (production)

## Deploy to Railway

1. Push this `bot-worker/` directory to a GitHub repo (or use a subfolder)
2. Create a new Railway project
3. Set environment variables in Railway dashboard:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `WORKER_ID` (e.g. `worker-1`)
   - `POLL_INTERVAL_MS` (default `3000`)
4. Railway will auto-deploy from your repo

## Deploy to Fly.io

```bash
fly launch
fly deploy
```

## Deploy to a VPS

```bash
# Install Node 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and build
git clone <repo>
cd bot-worker
npm install
npm run build

# Run with systemd
sudo tee /etc/systemd/system/luaux-bot.service <<EOF
[Unit]
Description=LuauX Bot Worker
After=network.target

[Service]
ExecStart=/usr/bin/node dist/index.js
WorkingDirectory=/path/to/bot-worker
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=SUPABASE_URL=https://your-project.supabase.co
Environment=SUPABASE_SERVICE_ROLE_KEY=your-key
Environment=WORKER_ID=worker-1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable luaux-bot
sudo systemctl start luaux-bot
```

## How it works

1. Polls `bot_jobs` table every 3 seconds for `status = 'pending'`
2. Claims the job (sets `status = 'running'`, `worker_id`)
3. Runs the actual bot (mineflayer or discord.js)
4. Writes logs to `bot_logs` table
5. When job is stopped (UI sets `status = 'stopping'`), the worker detects it and shuts down the bot

## Multiple workers

You can run multiple workers. Each worker has a unique `WORKER_ID`. The poll query is lock-free — the first worker to claim a job wins. For production, you might want to add `FOR UPDATE SKIP LOCKED` to the claim query.
