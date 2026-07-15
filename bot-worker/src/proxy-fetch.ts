import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const MS_SESSION = path.resolve(__dir, "../scripts/ms_session.py");
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
  redirects?: number;
};

let stickyProxy: string | null = null;
let session: MsSession | null = null;
let fetchSeq = 0;

export function setStickyProxy(proxy: string | null | undefined) {
  stickyProxy = proxy && proxy.trim() ? proxy.trim() : null;
}

export function getStickyProxy(): string | null {
  return stickyProxy;
}

class MsSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private waiters = new Map<
    number,
    { resolve: (v: ProxyFetchResult) => void; reject: (e: Error) => void }
  >();
  private openWaiter: {
    resolve: (v: { ok: boolean; proxy?: string; error?: string }) => void;
  } | null = null;
  private closed = false;
  private bin = "";

  async start(proxy: string | null, cookies: Record<string, string>): Promise<void> {
    const bins =
      process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];

    for (const bin of bins) {
      try {
        await this.spawnBin(bin);
        this.bin = bin;
        const opened = await this.sendOpen(proxy, cookies);
        if (opened.ok) return;
        this.kill();
      } catch {
        this.kill();
      }
    }
    throw new Error("Failed to start ms_session.py (python/httpx?)");
  }

  private spawnBin(bin: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.child = spawn(bin, [MS_SESSION], {
          windowsHide: true,
          env: process.env,
          cwd: path.resolve(__dir, ".."),
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }

      this.child.stdout.on("data", (d) => {
        this.buf += String(d);
        let idx: number;
        while ((idx = this.buf.indexOf("\n")) >= 0) {
          const line = this.buf.slice(0, idx).trim();
          this.buf = this.buf.slice(idx + 1);
          if (!line) continue;
          this.onLine(line);
        }
      });
      this.child.stderr.on("data", (d) => {
        const s = String(d).trim();
        if (s) console.log(`[ms_session] ${s.slice(0, 200)}`);
      });
      this.child.on("error", () => {
        if (!this.closed) reject(new Error(`spawn failed: ${bin}`));
      });
      this.child.on("close", () => {
        this.closed = true;
        for (const [, w] of this.waiters) {
          w.reject(new Error("ms_session closed"));
        }
        this.waiters.clear();
      });

      // process started
      setTimeout(() => resolve(), 50);
    });
  }

  private onLine(line: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    if (msg.id != null && msg.id !== undefined) {
      const id = Number(msg.id);
      const w = this.waiters.get(id);
      if (w) {
        this.waiters.delete(id);
        w.resolve({
          ok: !!msg.ok,
          status: Number(msg.status || 0),
          url: String(msg.url || ""),
          text: String(msg.text || ""),
          cookies: (msg.cookies as Record<string, string>) || {},
          headers: (msg.headers as Record<string, string>) || {},
          proxy: msg.proxy as string | undefined,
          error: msg.error as string | undefined,
          redirects: msg.redirects as number | undefined,
        });
      }
      return;
    }

    // open / ping / close (no id)
    if (this.openWaiter) {
      const w = this.openWaiter;
      this.openWaiter = null;
      w.resolve({
        ok: !!msg.ok,
        proxy: msg.proxy as string | undefined,
        error: msg.error as string | undefined,
      });
    }
  }

  private write(obj: Record<string, unknown>) {
    if (!this.child || this.closed) throw new Error("ms_session not running");
    this.child.stdin.write(JSON.stringify(obj) + "\n");
  }

  private sendOpen(
    proxy: string | null,
    cookies: Record<string, string>,
  ): Promise<{ ok: boolean; proxy?: string; error?: string }> {
    return new Promise((resolve) => {
      this.openWaiter = { resolve };
      this.write({ op: "open", proxy, cookies });
      setTimeout(() => {
        if (this.openWaiter) {
          this.openWaiter = null;
          resolve({ ok: false, error: "open timeout" });
        }
      }, 15_000);
    });
  }

  fetch(
    url: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      cookies?: Record<string, string>;
    },
    opts: {
      followRedirects?: boolean;
      maxRedirects?: number;
      timeoutMs?: number;
    },
  ): Promise<ProxyFetchResult> {
    const id = ++fetchSeq;
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      try {
        this.write({
          op: "fetch",
          id,
          url,
          method: init.method || "GET",
          headers: init.headers || {},
          body: init.body ?? null,
          cookies: init.cookies,
          follow: opts.followRedirects !== false,
          max_redirects: opts.maxRedirects ?? 12,
          timeout: Math.max(5, Math.round((opts.timeoutMs ?? 35_000) / 1000)),
        });
      } catch (e) {
        this.waiters.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
      setTimeout(() => {
        if (this.waiters.has(id)) {
          this.waiters.delete(id);
          resolve({
            ok: false,
            status: 0,
            url,
            text: "",
            cookies: {},
            error: `ms_session fetch timeout id=${id}`,
          });
        }
      }, (opts.timeoutMs ?? 35_000) + 10_000);
    });
  }

  close() {
    try {
      this.write({ op: "close" });
    } catch {
      /* ignore */
    }
    this.kill();
  }

  private kill() {
    try {
      this.child?.kill();
    } catch {
      /* ignore */
    }
    this.child = null;
    this.closed = true;
  }
}

/** Open long-lived sticky proxy session for a secure job. */
export async function openMsSession(
  proxy: string | null,
  cookies: Record<string, string>,
): Promise<void> {
  await closeMsSession();
  const s = new MsSession();
  await s.start(proxy || stickyProxy, cookies);
  session = s;
}

export async function closeMsSession(): Promise<void> {
  if (session) {
    try {
      session.close();
    } catch {
      /* ignore */
    }
    session = null;
  }
}

export function hasMsSession(): boolean {
  return !!session;
}

function runOneShotPython(payload: Record<string, unknown>): Promise<ProxyFetchResult> {
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

/** Prefer long-lived session; fall back to one-shot ms_fetch.py */
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

  if (session) {
    return session.fetch(
      url,
      {
        method: init.method || "GET",
        headers,
        body: init.body,
        cookies,
      },
      {
        followRedirects: opts.followRedirects,
        maxRedirects: opts.maxRedirects,
        timeoutMs: opts.timeoutMs,
      },
    );
  }

  return runOneShotPython({
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
