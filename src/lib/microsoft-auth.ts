// Cookie jar that correctly handles multi Set-Cookie headers
export class CookieJar {
  private cookies = new Map<string, string>();

  setFromResponse(res: Response) {
    const headers = res.headers as Headers & { getSetCookie?: () => string[] };
    const entries =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : (() => {
            const single = res.headers.get("set-cookie");
            return single ? [single] : [];
          })();

    for (const entry of entries) {
      const first = entry.split(";")[0];
      const eqIdx = first.indexOf("=");
      if (eqIdx === -1) continue;
      const name = first.slice(0, eqIdx).trim();
      const value = first.slice(eqIdx + 1);
      if (name) this.cookies.set(name, value);
    }
  }

  getHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

export async function fetchWithJar(
  jar: CookieJar,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const jarCookies = jar.getHeader();
  if (jarCookies && !headers.get("cookie")) {
    headers.set("cookie", jarCookies);
  }

  let currentUrl = url;
  let currentInit: RequestInit = { ...init, headers, redirect: "manual" };
  let redirects = 0;

  while (true) {
    const res = await fetch(currentUrl, currentInit);
    jar.setFromResponse(res);

    if (res.status >= 301 && res.status <= 308 && redirects < 10) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      redirects++;
      currentUrl = new URL(loc, currentUrl).toString();
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

export type AuthMethodInfo =
  | { method: "authenticator"; entropy: string; deviceFlowToken: string }
  | { method: "email_otp"; securityEmail: string; flowToken: string }
  | { method: "none"; detail?: string };

interface LiveData {
  urlPost: string;
  ppft: string;
}

function extractValue(text: string, pattern: RegExp): string | null {
  const m = pattern.exec(text);
  return m ? m[1] : null;
}

function decodeUnicodeEscapes(s: string): string {
  return s.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/** POST to login.live.com to get PPFT and urlPost */
export async function getLiveData(jar?: CookieJar): Promise<LiveData> {
  const useJar = jar ?? new CookieJar();
  const res = await fetchWithJar(useJar, "https://login.live.com", {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const text = await res.text();

  const urlPost =
    extractValue(
      text,
      /https:\/\/login\.live\.com\/ppsecure\/post\.srf\?[^"'\\\s]+/,
    ) ||
    extractValue(text, /urlPost['"]\s*:\s*['"]([^'"]+)['"]/);

  if (!urlPost) throw new Error("Failed to extract urlPost from login.live.com");

  const ppftMatch =
    extractValue(text, /name="PPFT"[^>]*value="([^"]+)"/) ||
    extractValue(text, /sFTTag.*?value=\\"([^\\"]+)/) ||
    extractValue(text, /value=\\?"([^"]+)"/);

  if (!ppftMatch) throw new Error("Failed to extract PPFT from login.live.com");

  return { urlPost: decodeUnicodeEscapes(urlPost), ppft: ppftMatch };
}

/** Send auth request to Microsoft to check available verification methods */
export async function sendAuth(email: string): Promise<{
  credentials: Record<string, unknown> | null;
  raw: Record<string, unknown>;
  flowToken?: string;
}> {
  const jar = new CookieJar();
  // Warm session + get a fresh flow token when possible
  let flowToken = "";
  try {
    const live = await getLiveData(jar);
    flowToken = live.ppft;
  } catch {
    /* continue with empty flow token */
  }

  const res = await fetch("https://login.live.com/GetCredentialType.srf", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      Referer: "https://login.live.com/",
      Cookie: jar.getHeader(),
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      checkPhones: true,
      country: "",
      federationFlags: 3,
      flowToken: flowToken || undefined,
      forceotclogin: true,
      isCookieBannerShown: true,
      isExternalFederationDisallowed: true,
      isFederationDisabled: true,
      isFidoSupported: true,
      isOtherIdpSupported: false,
      isRemoteConnectSupported: false,
      isRemoteNGCSupported: true,
      isSignup: false,
      otclogindisallowed: false,
      username: email,
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  const creds = (data?.Credentials as Record<string, unknown>) ?? null;
  const returnedFlow =
    (data?.FlowToken as string) ||
    (data?.flowToken as string) ||
    flowToken ||
    undefined;
  return { credentials: creds, raw: data, flowToken: returnedFlow };
}

/** Detect which auth method is available for the account */
export function detectAuthMethod(
  credentials: Record<string, unknown> | null,
): AuthMethodInfo {
  if (!credentials) return { method: "none", detail: "No credentials returned" };

  if ("RemoteNgcParams" in credentials && credentials.RemoteNgcParams) {
    const ngc = credentials.RemoteNgcParams as Record<string, unknown>;
    const entropy =
      (ngc.Entropy as string) ??
      (ngc.SessionIdentifier as string) ??
      "unknown";
    const deviceFlowToken = (ngc.SessionIdentifier as string) ?? "";
    return { method: "authenticator", entropy, deviceFlowToken };
  }

  if ("OtcLoginEligibleProofs" in credentials) {
    const proofs = credentials.OtcLoginEligibleProofs as Array<Record<string, string>>;
    if (proofs && proofs.length > 0) {
      const emailProof =
        proofs.find((p) => /@/.test(p.display || "") || /email/i.test(p.type || "")) ||
        proofs[0];
      return {
        method: "email_otp",
        securityEmail: emailProof.display ?? "unknown",
        flowToken: emailProof.data ?? "",
      };
    }
    return { method: "none", detail: "No eligible proofs" };
  }

  // HasPassword / other fields only — no OTP path
  if (credentials.HasPassword === true || credentials.PrefCredential === 1) {
    return {
      method: "none",
      detail: "Account requires password login only (no email OTP / recovery email).",
    };
  }

  return { method: "none", detail: "No auth methods available" };
}

/** Send OTP to the account's security email (maintains cookie session via jar) */
export async function sendOtt(
  jar: CookieJar,
  email: string,
  securityEmail: string,
): Promise<boolean> {
  try {
    const liveData = await getLiveData(jar);

    // Step 1: Submit email to start login flow
    const loginRes = await fetchWithJar(jar, liveData.urlPost, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://login.live.com",
        "Accept-Language": "en-US,en;q=0.5",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
      body: new URLSearchParams({
        ps: "2",
        PPFT: liveData.ppft,
        PPSX: "Pass",
        login: email,
        loginfmt: email,
        type: "11",
        passwd: "",
      }).toString(),
    });
    const loginText = await loginRes.text();

    // Step 2: Parse MFA page for proof list
    const actionMatch =
      loginText.match(/action="([^"]+)"/i) ||
      loginText.match(/urlPost['"]\s*:\s*['"]([^'"]+)['"]/);
    if (!actionMatch) {
      console.error("[sendOtt] Failed to parse action URL");
      return false;
    }
    const action = decodeUnicodeEscapes(actionMatch[1]);

    const iptMatch =
      loginText.match(/name="ipt"[^>]*value="([^"]+)"/i) ||
      loginText.match(/"ipt"\s*:\s*"([^"]+)"/);
    const ppridMatch =
      loginText.match(/name="pprid"[^>]*value="([^"]+)"/i) ||
      loginText.match(/"pprid"\s*:\s*"([^"]+)"/);
    if (!iptMatch || !ppridMatch) {
      console.error("[sendOtt] Failed to parse ipt/pprid — may need password or account locked");
      return false;
    }
    const ipt = decodeURIComponent(iptMatch[1]);
    const pprid = ppridMatch[1];

    const identityRes = await fetchWithJar(jar, action, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://login.live.com",
        "Accept-Language": "en-US,en;q=0.5",
      },
      body: new URLSearchParams({ pprid, ipt }).toString(),
    });
    const identityText = await identityRes.text();

    // Step 3: Extract proof list and API tokens
    const rawStrMatch = identityText.match(/"rawProofList"\s*:\s*"([^"]+)"/);
    if (!rawStrMatch) {
      console.error("[sendOtt] No rawProofList found");
      return false;
    }
    const rawJson = JSON.parse(
      decodeUnicodeEscapes(rawStrMatch[1]),
    ) as Array<Record<string, string>>;
    const epid =
      rawJson.find((p) => p.type === "Email" && p.epid)?.epid ?? rawJson[0]?.epid;
    if (!epid) {
      console.error("[sendOtt] No epid found");
      return false;
    }

    const apiCanary = decodeUnicodeEscapes(
      extractValue(identityText, /"apiCanary"\s*:\s*"([^"]+)"/) ?? "",
    );
    const eipt = decodeUnicodeEscapes(
      extractValue(identityText, /"eipt"\s*:\s*"([^"]+)"/) ?? "",
    );
    const uaid = extractValue(identityText, /"uaid"\s*:\s*"([^"]+)"/) ?? "";

    if (!apiCanary || !eipt || !uaid) {
      console.error("[sendOtt] Failed to extract API tokens");
      return false;
    }

    // Step 4: Send OTP
    const otpRes = await fetchWithJar(jar, "https://account.live.com/api/Proofs/SendOtt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        hpgid: "200368",
        scid: "100166",
        canary: apiCanary,
        eipt,
        uaid,
        uiflvr: "1001",
        hpgact: "0",
      },
      body: JSON.stringify({
        token: "",
        purpose: "UnfamiliarLocationHard",
        epid,
        autoVerification: false,
        autoVerificationFailed: false,
        confirmProof: securityEmail,
        uaid,
        uiflvr: 1001,
        scid: 100166,
        hpgid: 200368,
      }),
    });

    if (!otpRes.ok) {
      const t = await otpRes.text().catch(() => "");
      console.error("[sendOtt] SendOtt failed:", otpRes.status, t.slice(0, 200));
    }
    return otpRes.ok;
  } catch (e) {
    console.error("[sendOtt] Error:", e);
    return false;
  }
}
