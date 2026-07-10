import { db } from "./supabase.js";

export type DiscordJobConfig = {
  token: string;
  guildId: string;
  channelId: string;
  messages: string[];
  interval: number;
  deleteAfterSend: boolean;
  humanize: boolean;
  minDelay: number;
  maxDelay: number;
};

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDiscordBot(
  jobId: string,
  discordId: string,
  config: DiscordJobConfig,
  abortSignal: AbortSignal
): Promise<void> {
  const log = async (level: string, message: string) => {
    await db.from("bot_logs").insert({
      job_id: jobId,
      discord_id: discordId,
      level,
      message,
    });
  };

  const setStatus = async (status: string, error?: string) => {
    const update: Record<string, unknown> = { status };
    if (error) update.error = error;
    if (status === "running") update.started_at = new Date().toISOString();
    if (status === "stopped" || status === "error") update.stopped_at = new Date().toISOString();
    await db.from("bot_jobs").update(update).eq("id", jobId);
  };

  await log("system", "Initializing Discord user-token client...");
  await setStatus("running");

  let stopped = false;

  abortSignal.addEventListener("abort", async () => {
    stopped = true;
    await log("system", "Stop signal received, shutting down...");
  });

  // Verify token by fetching @me
  let me: { id: string; username: string } | null = null;
  try {
    const meRes = await fetch("https://discord.com/api/v9/users/@me", {
      headers: { Authorization: config.token },
    });
    if (!meRes.ok) {
      const t = await meRes.text();
      await log("error", `Token invalid (${meRes.status}): ${t}`);
      await setStatus("error", "Invalid token");
      return;
    }
    me = await meRes.json();
    await log("info", `Logged in as ${me!.username} (${me!.id})`);
  } catch (e) {
    await log("error", `Token check failed: ${e instanceof Error ? e.message : String(e)}`);
    await setStatus("error", "Token check failed");
    return;
  }

  // Verify channel access
  try {
    const chRes = await fetch(`https://discord.com/api/v9/channels/${config.channelId}`, {
      headers: { Authorization: config.token },
    });
    if (!chRes.ok) {
      const t = await chRes.text();
      await log("error", `Cannot access channel (${chRes.status}): ${t}`);
      await setStatus("error", "Channel not accessible");
      return;
    }
    const ch = await chRes.json();
    await log("info", `Target: #${ch.name || config.channelId}`);
  } catch (e) {
    await log("error", `Channel fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    await setStatus("error", "Channel check failed");
    return;
  }

  await log("system", `Spamming ${config.messages.length} message(s) every ~${config.interval}s`);

  let msgIndex = 0;
  let sentCount = 0;
  let failCount = 0;

  const sendNext = async () => {
    if (stopped) return;

    const msg = config.messages[msgIndex % config.messages.length];
    msgIndex++;

    try {
      const res = await fetch(`https://discord.com/api/v9/channels/${config.channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: config.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: msg }),
      });

      if (res.ok) {
        sentCount++;
        await log("bot", `> ${msg}`);

        if (config.deleteAfterSend) {
          const sent = await res.json();
          if (sent?.id) {
            setTimeout(async () => {
              try {
                await fetch(`https://discord.com/api/v9/channels/${config.channelId}/messages/${sent.id}`, {
                  method: "DELETE",
                  headers: { Authorization: config.token },
                });
              } catch {}
            }, randomBetween(1000, 3000));
          }
        }
      } else {
        failCount++;
        const body = await res.text();
        await log("error", `Send failed (${res.status}): ${body}`);

        if (res.status === 429) {
          let retryAfter = 10000 + randomBetween(0, 5000);
          try {
            const parsed = JSON.parse(body);
            if (parsed.retry_after) retryAfter = Math.ceil(parsed.retry_after * 1000) + 1000;
          } catch {}
          await log("warn", `Rate limited, waiting ${retryAfter}ms`);
          await sleep(retryAfter);
        }

        if (failCount > 20) {
          await log("error", "Too many failures, stopping");
          await setStatus("error", "Too many send failures");
          stopped = true;
          return;
        }
      }
    } catch (e) {
      failCount++;
      await log("error", `Send error: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (stopped) return;

    const runtime = config.humanize
      ? randomBetween(config.minDelay * 1000, config.maxDelay * 1000)
      : config.interval * 1000;

    await log("info", `Next message in ${(runtime / 1000).toFixed(1)}s`);

    const timer = setTimeout(sendNext, runtime);
    abortSignal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  };

  sendNext();

  const runtimeMinutes = setInterval(() => {
    if (!stopped) {
      log("info", `Runtime: ${Math.floor(process.uptime() / 60)}m | Sent: ${sentCount} | Failed: ${failCount}`);
    }
  }, 300000);

  abortSignal.addEventListener("abort", () => clearInterval(runtimeMinutes), { once: true });

  await setStatus("running");

  return new Promise((resolve) => {
    const checkAbort = setInterval(() => {
      if (abortSignal.aborted || stopped) {
        clearInterval(checkAbort);
        resolve();
      }
    }, 1000);
  });
}
