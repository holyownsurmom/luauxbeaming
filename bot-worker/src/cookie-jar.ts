import { fetchViaProxyRaw, getStickyProxy } from "./proxy-fetch.js";

export class CookieJar {
  private cookies = new Map<string, string>();

  setFromResponse(_url: string, setCookieHeader: string | string[] | undefined) {
    if (!setCookieHeader) return;
    const entries = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const entry of entries) {
      const first = entry.split(";")[0];
      const eqIdx = first.indexOf("=");
      if (eqIdx === -1) continue;
      const name = first.slice(0, eqIdx).trim();
      const value = first.slice(eqIdx + 1);
      if (!name) continue;
      this.cookies.set(name, value);
    }
  }

  setCookie(name: string, value: string) {
    this.cookies.set(name, value);
  }

  getHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  toRecord(): Record<string, string> {
    return Object.fromEntries(this.cookies.entries());
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

function collectSetCookies(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

export type FetchJarOpts = {
  followRedirects?: boolean;
  maxRedirects?: number;
  timeoutMs?: number;
  forceDirect?: boolean;
};

/**
 * Cookie-aware fetch. When sticky residential proxy is set, MS hosts go through
 * Python httpx so the IP matches OTP login.
 */
export async function fetchWithJar(
  jar: CookieJar,
  url: string,
  init: RequestInit = {},
  opts: FetchJarOpts = {},
): Promise<Response> {
  const useProxy =
    !opts.forceDirect &&
    !!getStickyProxy() &&
    /microsoft|live\.com|xboxlive|passport|minecraft\.net/i.test(url);

  // Honor classic RequestInit.redirect === "manual"
  const followRedirects =
    opts.followRedirects !== undefined
      ? opts.followRedirects !== false
      : init.redirect !== "manual";

  if (useProxy) {
    const headersObj: Record<string, string> = {};
    if (init.headers) {
      const h = new Headers(init.headers);
      h.forEach((v, k) => {
        headersObj[k] = v;
      });
    }
    let body: string | undefined;
    if (typeof init.body === "string") body = init.body;
    else if (init.body instanceof URLSearchParams) body = init.body.toString();
    else if (init.body != null) body = String(init.body);

    const result = await fetchViaProxyRaw(
      jar.toRecord(),
      url,
      {
        method: (init.method as string) || "GET",
        headers: headersObj,
        body,
      },
      {
        followRedirects,
        maxRedirects: opts.maxRedirects,
        timeoutMs: opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
      },
    );

    if (!result.ok) {
      throw new Error(result.error || "proxy fetch failed");
    }

    if (result.cookies) {
      for (const [k, v] of Object.entries(result.cookies)) {
        jar.setCookie(k, v);
      }
    }

    const outHeaders = new Headers(result.headers || {});
    if (!outHeaders.has("content-type")) {
      outHeaders.set("content-type", "text/html; charset=utf-8");
    }

    // Preserve final URL for callers that check res.url
    const res = new Response(result.text, {
      status: result.status,
      statusText: String(result.status),
      headers: outHeaders,
    });
    try {
      Object.defineProperty(res, "url", { value: result.url || url, configurable: true });
    } catch {
      /* ignore */
    }
    return res;
  }

  const maxRedirects = opts.maxRedirects ?? 10;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  const headers = new Headers(init.headers);
  const existing = headers.get("cookie");
  if (!existing) {
    const jarCookies = jar.getHeader();
    if (jarCookies) headers.set("cookie", jarCookies);
  }

  let currentUrl = url;
  let currentInit: RequestInit = { ...init, headers, redirect: "manual" };
  let redirects = 0;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const parentSignal = init.signal;
    const onParentAbort = () => controller.abort();
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort();
      else parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }

    let res: Response;
    try {
      res = await fetch(currentUrl, { ...currentInit, signal: controller.signal });
    } catch (e) {
      if (controller.signal.aborted && !parentSignal?.aborted) {
        throw new Error(`Request timed out after ${timeoutMs}ms: ${currentUrl.slice(0, 80)}`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }

    jar.setFromResponse(currentUrl, collectSetCookies(res));

    if (
      followRedirects &&
      res.status >= 301 &&
      res.status <= 308 &&
      redirects < maxRedirects
    ) {
      const location = res.headers.get("location");
      if (!location) return res;

      redirects++;
      currentUrl = new URL(location, currentUrl).toString();

      const method = (currentInit.method || "GET").toUpperCase();
      if ((res.status === 301 || res.status === 302) && method !== "GET" && method !== "HEAD") {
        currentInit = {
          method: "GET",
          headers: { cookie: jar.getHeader() },
          redirect: "manual",
        };
      } else {
        const nextHeaders = new Headers(currentInit.headers);
        nextHeaders.set("cookie", jar.getHeader());
        currentInit = { ...currentInit, headers: nextHeaders, redirect: "manual" };
      }
      continue;
    }

    return res;
  }
}
