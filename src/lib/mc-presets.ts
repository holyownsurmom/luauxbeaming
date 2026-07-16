/** Built-in + user-saved Minecraft server list and launch presets (localStorage). */

export type McServerEntry = {
  id: string;
  label: string;
  host: string;
  port: number;
  builtin?: boolean;
};

export type McLaunchPreset = {
  id: string;
  name: string;
  serverHost: string;
  serverPort: string;
  messages: string;
  interval: string;
  autoReply?: boolean;
  autoReplyMessages?: string;
  autoReplyCmd?: "r" | "reply";
  autoReplyCooldownSec?: string;
  createdAt: number;
};

const SERVERS_KEY = "luaux_mc_servers_v1";
const PRESETS_KEY = "luaux_mc_presets_v1";
const MAX_USER = 40;

export const BUILTIN_SERVERS: McServerEntry[] = [
  { id: "donut", label: "DonutSMP", host: "donutsmp.net", port: 25565, builtin: true },
  { id: "catpvp", label: "CatPVP", host: "catpvp.com", port: 25565, builtin: true },
  { id: "hugo", label: "HugoSMP", host: "hugosmp.com", port: 25565, builtin: true },
  { id: "minemen", label: "Minemen EU", host: "minemen.club", port: 25565, builtin: true },
  { id: "mcpvp-na", label: "MCPVP NA", host: "na.mcpvp.club", port: 25565, builtin: true },
  { id: "mcpvp-eu", label: "MCPVP EU", host: "eu.mcpvp.club", port: 25565, builtin: true },
  { id: "hypixel", label: "Hypixel", host: "mc.hypixel.net", port: 25565, builtin: true },
  { id: "cubecraft", label: "CubeCraft", host: "play.cubecraft.net", port: 25565, builtin: true },
];

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event("luaux-mc-presets"));
  } catch {
    /* quota */
  }
}

export function listUserServers(): McServerEntry[] {
  const list = readJson<McServerEntry[]>(SERVERS_KEY, []);
  return Array.isArray(list) ? list.filter((s) => s && s.host) : [];
}

export function listAllServers(): McServerEntry[] {
  return [...BUILTIN_SERVERS, ...listUserServers()];
}

export function addUserServer(entry: { label: string; host: string; port?: number }): McServerEntry {
  const row: McServerEntry = {
    id: crypto.randomUUID(),
    label: entry.label.trim() || entry.host.trim(),
    host: entry.host.trim().toLowerCase(),
    port: entry.port && entry.port > 0 ? entry.port : 25565,
  };
  const next = [row, ...listUserServers().filter((s) => s.host !== row.host)].slice(0, MAX_USER);
  writeJson(SERVERS_KEY, next);
  return row;
}

export function removeUserServer(id: string) {
  writeJson(
    SERVERS_KEY,
    listUserServers().filter((s) => s.id !== id),
  );
}

export function listLaunchPresets(): McLaunchPreset[] {
  const list = readJson<McLaunchPreset[]>(PRESETS_KEY, []);
  return Array.isArray(list)
    ? list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    : [];
}

export function saveLaunchPreset(
  p: Omit<McLaunchPreset, "id" | "createdAt"> & { id?: string },
): McLaunchPreset {
  const row: McLaunchPreset = {
    id: p.id || crypto.randomUUID(),
    name: p.name.trim() || "Preset",
    serverHost: p.serverHost.trim(),
    serverPort: p.serverPort.trim() || "25565",
    messages: p.messages,
    interval: p.interval || "5",
    autoReply: p.autoReply,
    autoReplyMessages: p.autoReplyMessages,
    autoReplyCmd: p.autoReplyCmd === "reply" ? "reply" : "r",
    autoReplyCooldownSec: p.autoReplyCooldownSec || "8",
    createdAt: Date.now(),
  };
  const next = [row, ...listLaunchPresets().filter((x) => x.id !== row.id)].slice(0, MAX_USER);
  writeJson(PRESETS_KEY, next);
  return row;
}

export function removeLaunchPreset(id: string) {
  writeJson(
    PRESETS_KEY,
    listLaunchPresets().filter((p) => p.id !== id),
  );
}
