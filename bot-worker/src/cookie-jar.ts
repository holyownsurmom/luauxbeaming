export class CookieJar {
  private cookies = new Map<string, string>();

  setFromResponse(_url: string, setCookieHeader: string | string[] | undefined) {
    if (!setCookieHeader) return;
    const entries = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const entry of entries) {
      // Only use the first name=value pair of each Set-Cookie line (before attributes)
      const first = entry.split(";")[0];
      const eqIdx = first.indexOf("=");
      if (eqIdx === -1) continue;
      const name = first.slice(0, eqIdx).trim();
      const value = first.slice(eqIdx + 1);
      if (!name) continue;
      this.cookies.set(name, value);
    }
  }

  getHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
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
  // Fallback: single combined header (may be incomplete for multi-cookie responses)
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

export async function fetchWithJar(
  jar: CookieJar,
  url: string,
  init: RequestInit = {},
  opts: { followRedirects?: boolean; maxRedirects?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const followRedirects = opts.followRedirects !== false;
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
    // Merge with caller signal if present
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

      // 307/308 preserve method + body; 301/302 POST → GET (browser-like)
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
