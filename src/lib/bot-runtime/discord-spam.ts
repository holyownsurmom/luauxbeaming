export type DiscordSpamConfig = {
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

const UNAVAILABLE =
  "Discord bot runtime is not available in this deployment (discord.js requires a Node host and cannot run on the edge Worker).";

export async function startDiscordSpam(_userId: string, _config: DiscordSpamConfig): Promise<string> {
  throw new Error(UNAVAILABLE);
}

export async function stopDiscordSpam(_botId: string): Promise<boolean> {
  return false;
}

export function getDiscordSpamStatus(_botId: string) {
  return null;
}