export type McBotConfig = {
  accountId: string;
  label: string;
  serverHost: string;
  serverPort: number;
  authType: "ssid" | "microsoft" | "offline";
  username?: string;
  ssid?: string;
  messages: string[];
  interval: number;
};

const UNAVAILABLE =
  "Minecraft bot runtime is not available in this deployment (Node-only dependencies cannot run on the edge Worker).";

export async function startMcBot(_userId: string, _config: McBotConfig): Promise<string> {
  throw new Error(UNAVAILABLE);
}

export async function stopMcBot(_botId: string): Promise<boolean> {
  return false;
}

export async function pingMcServer(_host: string, _port: number): Promise<{ online: boolean; error: string }> {
  return { online: false, error: UNAVAILABLE };
}