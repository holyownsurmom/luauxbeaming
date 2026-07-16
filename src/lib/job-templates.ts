/** Versioned localStorage templates for Discord bot configs (never stores tokens). */

export type SpamTemplate = {
  id: string;
  name: string;
  kind: "spam";
  channelId: string;
  messages: string;
  interval: string;
  minDelay: string;
  maxDelay: string;
  profile?: "safe" | "balanced" | "custom";
  createdAt: number;
};

export type AutoreplyTemplate = {
  id: string;
  name: string;
  kind: "autoreply";
  messages: string;
  minDelay: string;
  maxDelay: string;
  autoAcceptFriends: boolean;
  profile?: "safe" | "balanced" | "custom";
  createdAt: number;
};

export type JobTemplate = SpamTemplate | AutoreplyTemplate;

const KEY = "luaux_job_templates_v1";
const MAX = 20;

function readAll(): JobTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as JobTemplate[]) : [];
  } catch {
    return [];
  }
}

function writeAll(list: JobTemplate[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event("luaux-templates"));
  } catch {
    /* quota */
  }
}

export function listTemplates(kind?: "spam" | "autoreply"): JobTemplate[] {
  const all = readAll().sort((a, b) => b.createdAt - a.createdAt);
  return kind ? all.filter((t) => t.kind === kind) : all;
}

export function saveTemplate(
  t: (Omit<SpamTemplate, "id" | "createdAt"> | Omit<AutoreplyTemplate, "id" | "createdAt">) & {
    id?: string;
  },
): JobTemplate {
  const all = readAll();
  const row = {
    ...t,
    id: t.id || crypto.randomUUID(),
    createdAt: Date.now(),
  } as JobTemplate;
  const next = [row, ...all.filter((x) => x.id !== row.id)].slice(0, MAX);
  writeAll(next);
  return row;
}

export function deleteTemplate(id: string) {
  writeAll(readAll().filter((t) => t.id !== id));
}

export const SPAM_PROFILES = {
  safe: {
    label: "Safe",
    hint: "Slowest · lowest heat",
    interval: "2400",
    minDelay: "1800",
    maxDelay: "3600",
  },
  balanced: {
    label: "Balanced",
    hint: "Recommended floors",
    interval: "1200",
    minDelay: "1200",
    maxDelay: "2400",
  },
} as const;

export const AUTOREPLY_PROFILES = {
  safe: {
    label: "Safe",
    hint: "Slowest · lowest heat",
    minDelay: "90",
    maxDelay: "240",
  },
  balanced: {
    label: "Balanced",
    hint: "Recommended floors",
    minDelay: "45",
    maxDelay: "120",
  },
} as const;
