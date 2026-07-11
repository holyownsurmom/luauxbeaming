import { createLogger, updateJob } from "./api.js";

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
  const log = createLogger(jobId, discordId);

  if (!config.token) {
    await log("error", "Missing token");
    await updateJob(jobId, "error", "Missing token");
    return;
  }
  if (!config.channelId) {
    await log("error", "Missing channelId");
    await updateJob(jobId, "error", "Missing channelId");
    return;
  }
  if (!config.messages?.length) {
    await log("error", "No messages configured");
    await updateJob(jobId, "error", "No messages configured");
    return;
  }
  if (config.humanize && config.minDelay >= config.maxDelay) {
    config.maxDelay = config.minDelay + 1;
  }
  if (config.minDelay < 1) config.minDelay = 1;

  const startedAt = Date.now();
  await log("system", "Initializing Discord user-token client...");
  await updateJob(jobId, "running");

  let stopped = false;

  abortSignal.addEventListener("abort", () => {
    stopped = true;
    log("system", "Stop signal received, shutting down...").catch(() => {});
  });

  let me: { id: string; username: string } | null = null;
  try {
    const meRes = await fetch("https://discord.com/api/v9/users/@me", {
      headers: { Authorization: config.token },
    });
    if (!meRes.ok) {
      const t = await meRes.text();
      await log("error", `Token invalid (${meRes.status}): ${t}`);
      await updateJob(jobId, "error", "Invalid token");
      return;
    }
    me = await meRes.json();
    await log("info", `Logged in as ${me!.username} (${me!.id})`);
  } catch (e) {
    await log("error", `Token check failed: ${e instanceof Error ? e.message : String(e)}`);
    await updateJob(jobId, "error", "Token check failed");
    return;
  }

  try {
    const chRes = await fetch(`https://discord.com/api/v9/channels/${config.channelId}`, {
      headers: { Authorization: config.token },
    });
    if (!chRes.ok) {
      const t = await chRes.text();
      await log("error", `Cannot access channel (${chRes.status}): ${t}`);
      await updateJob(jobId, "error", "Channel not accessible");
      return;
    }
    const ch = await chRes.json();
    await log("info", `Target: #${ch.name || config.channelId}`);
  } catch (e) {
    await log("error", `Channel fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    await updateJob(jobId, "error", "Channel check failed");
    return;
  }

  await log("system", `Spamming ${config.messages.length} message(s) every ~${config.interval}s`);

  let msgIndex = 0;
  let sentCount = 0;
  let failCount = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  abortSignal.addEventListener("abort", () => {
    if (pendingTimer) clearTimeout(pendingTimer);
  }, { once: true });

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
            setTimeout(() => {
              fetch(`https://discord.com/api/v9/channels/${config.channelId}/messages/${sent.id}`, {
                method: "DELETE",
                headers: { Authorization: config.token },
              }).catch((e) => {
                log("error", `Delete failed: ${e.message}`).catch(() => {});
              });
            }, randomBetween(1000, 3000));
          }
        }
      } else {
        failCount++;
        const body = await res.text();
        await log("error", `Send failed (${res.status}): ${body}`);

        if (res.status === 429) {
          failCount = Math.max(0, failCount - 5);
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
          await updateJob(jobId, "error", "Too many send failures");
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

    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      sendNext();
    }, runtime);
  };

  sendNext();

  const runtimeLog = setInterval(() => {
    if (!stopped) {
      const botMinutes = Math.floor((Date.now() - startedAt) / 60000);
      log("info", `Runtime: ${botMinutes}m | Sent: ${sentCount} | Failed: ${failCount}`).catch(() => {});
    }
  }, 300000);

  abortSignal.addEventListener("abort", () => clearInterval(runtimeLog), { once: true });

  return new Promise((resolve) => {
    const checkAbort = setInterval(() => {
      if (abortSignal.aborted || stopped) {
        clearInterval(checkAbort);
        if (pendingTimer) clearTimeout(pendingTimer);
        resolve();
      }
    }, 1000);
  });
}
