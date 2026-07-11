export class CookieJar {
  private cookies = new Map<string, string>();

  setFromResponse(url: string, setCookieHeader: string | string[] | undefined) {
    if (!setCookieHeader) return;
    const entries = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const entry of entries) {
      const parts = entry.split(";")[0];
      const eqIdx = parts.indexOf("=");
      if (eqIdx === -1) continue;
      const name = parts.slice(0, eqIdx).trim();
      const value = parts.slice(eqIdx + 1);
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

export async function fetchWithJar(
  jar: CookieJar,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const existing = headers.get("cookie");
  if (!existing || existing === "") {
    const jarCookies = jar.getHeader();
    if (jarCookies) headers.set("cookie", jarCookies);
  }

  const res = await fetch(url, { ...init, headers, redirect: "manual" });

  const setCookie = res.headers.get("set-cookie");
  jar.setFromResponse(url, setCookie ?? undefined);

  // Follow redirects manually to track cookies
  if (res.status >= 301 && res.status <= 308) {
    const location = res.headers.get("location");
    if (location) {
      const redirectUrl = new URL(location, url).toString();
      return fetchWithJar(jar, redirectUrl, { method: "GET", headers: { cookie: jar.getHeader() } });
    }
  }

  return res;
}
