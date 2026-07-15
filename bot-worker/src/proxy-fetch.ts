import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const MS_FETCH = path.resolve(__dir, "../scripts/ms_fetch.py");

export type ProxyFetchResult = {
  ok: boolean;
  status: number;
  url: string;
  text: string;
  cookies: Record<string, string>;
  headers?: Record<string, string>;
  proxy?: string;
  error?: string;
};

let stickyProxy: string | null = null;

export function setStickyProxy(proxy: string | null | undefined) {
  stickyProxy = proxy && proxy.trim() ? proxy.trim() : null;
}

export function getStickyProxy(): string | null {
  return stickyProxy;
}

function runPython(payload: Record<string, unknown>): Promise<ProxyFetchResult> {
  const bins = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  const body = JSON.stringify(payload);

  const tryBin = (bin: string) =>
    new Promise<ProxyFetchResult | null>((resolve) => {
      const child = spawn(bin, [MS_FETCH], {
        windowsHide: true,
        env: process.env,
        cwd: path.resolve(__dir, ".."),
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += String(d);
      });
      child.stderr.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", () => resolve(null));
      try {
        child.stdin.write(body);
        child.stdin.end();
      } catch {
        resolve(null);
        return;
      }
      child.on("close", () => {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
        if (!line) {
          resolve({
            ok: false,
            status: 0,
            url: String(payload.url || ""),
            text: "",
            cookies: {},
            error: `ms_fetch empty (${bin}): ${stderr.slice(0, 160)}`,
          });
          return;
        }
        try {
          resolve(JSON.parse(line) as ProxyFetchResult);
        } catch {
          resolve({
            ok: false,
            status: 0,
            url: String(payload.url || ""),
            text: "",
            cookies: {},
            error: `ms_fetch bad json: ${line.slice(0, 120)}`,
          });
        }
      });
    });

  return (async () => {
    for (const bin of bins) {
      const r = await tryBin(bin);
      if (r) return r;
    }
    return {
      ok: false,
      status: 0,
      url: String(payload.url || ""),
      text: "",
      cookies: {},
      error: "python not available for ms_fetch",
    };
  })();
}

export function loadProxyUrls(): string[] {
  try {
    const root = path.resolve(__dir, "..");
    for (const name of ["proxies.txt", "proxy.txt"]) {
      const p = path.join(root, name);
      if (!fs.existsSync(p)) continue;
      const out: string[] = [];
      for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        if (t.startsWith("http://") || t.startsWith("https://") || t.startsWith("socks5://")) {
          out.push(t);
          continue;
        }
        const parts = t.split(":");
        if (parts.length >= 4) {
          const [host, port, user, ...rest] = parts;
          out.push(`http://${user}:${rest.join(":")}@${host}:${port}`);
        } else if (t.includes("@")) {
          out.push(`http://${t}`);
        }
      }
      if (out.length) return out;
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function resolveProxyFromLabel(label: string | undefined): string | null {
  if (!label || label === "direct") return null;
  const urls = loadProxyUrls();
  return urls.find((u) => u.includes(`@${label}`) || u.endsWith(label)) || null;
}

/** Low-level HTTP via residential sticky proxy. */
export async function fetchViaProxyRaw(
  cookies: Record<string, string>,
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
  opts: {
    followRedirects?: boolean;
    maxRedirects?: number;
    timeoutMs?: number;
    proxy?: string | null;
  } = {},
): Promise<ProxyFetchResult> {
  const headers: Record<string, string> = { ...(init.headers || {}) };
  delete headers.cookie;
  delete headers.Cookie;

  return runPython({
    url,
    method: init.method || "GET",
    headers,
    body: init.body ?? null,
    cookies,
    proxy: opts.proxy ?? stickyProxy,
    follow: opts.followRedirects !== false,
    max_redirects: opts.maxRedirects ?? 12,
    timeout: Math.max(5, Math.round((opts.timeoutMs ?? 35_000) / 1000)),
  });
}
