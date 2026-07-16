/**
 * VPS/local healthcheck for bot-worker + Mailcow + site APIs.
 * Usage (from bot-worker/): node scripts/healthcheck.mjs
 * Loads .env via process if dotenv present; otherwise set env yourself.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnv() {
  const p = resolve(root, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnv();

const SITE = (process.env.SITE_URL || "").replace(/\/+$/, "");
const SECRET = process.env.WORKER_SECRET || "";
const MAIL_BASE = (process.env.MAILCOW_API_URL || process.env.MAILCOW_URL || "").replace(/\/+$/, "");
const MAIL_KEY = process.env.MAILCOW_API_KEY || "";
const MAIL_DOMAIN = process.env.MAILCOW_DOMAIN || "";
const TLS_INSECURE = /^(1|true|yes)$/i.test((process.env.MAIL_TLS_INSECURE || "").trim());

const results = [];
function ok(name, detail = "") {
  results.push({ name, pass: true, detail });
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  results.push({ name, pass: false, detail });
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

function httpsJson(method, urlStr, headers, body, insecure) {
  return new Promise((resolveP, reject) => {
    const u = new URL(urlStr);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method,
        headers: {
          ...headers,
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
        rejectUnauthorized: !insecure,
        timeout: 20_000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolveP({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (body) req.write(body);
    req.end();
  });
}

console.log("\n=== LuauX bot-worker healthcheck ===\n");

// Env
if (!SITE) fail("SITE_URL", "missing");
else ok("SITE_URL", SITE + (process.env.SITE_URL?.endsWith("/") ? " (was trailing /)" : ""));
if (!SECRET) fail("WORKER_SECRET", "missing");
else ok("WORKER_SECRET", `set (len=${SECRET.length})`);
if (!MAIL_BASE || !MAIL_KEY || !MAIL_DOMAIN) fail("Mailcow env", "API_URL/KEY/DOMAIN incomplete");
else ok("Mailcow env", `${MAIL_BASE} domain=${MAIL_DOMAIN}`);
if (MAIL_BASE && !TLS_INSECURE) fail("MAIL_TLS_INSECURE", "off — self-signed Mailcow will fail");
else if (MAIL_BASE) ok("MAIL_TLS_INSECURE", TLS_INSECURE ? "1" : "0");

// Site worker APIs
if (SITE && SECRET) {
  const hdr = { "Content-Type": "application/json", "x-worker-secret": SECRET, Accept: "application/json" };
  for (const [method, path, body] of [
    ["POST", "/api/bots/worker/poll", JSON.stringify({ worker_id: process.env.WORKER_ID || "worker-1", limit: 1 })],
    ["POST", "/api/bots/worker/otp-pending", JSON.stringify({ worker_id: process.env.WORKER_ID || "worker-1", limit: 1 })],
    ["GET", "/api/bots/worker/presence-tokens", null],
    ["GET", "/api/bots/worker/payments-pending", null],
    // empty job_ids is ok after deploy of status.ts fix; dummy id always works on live
    [
      "POST",
      "/api/bots/worker/status",
      JSON.stringify({
        worker_id: process.env.WORKER_ID || "worker-1",
        job_ids: ["00000000-0000-0000-0000-000000000001"],
      }),
    ],
  ]) {
    try {
      const res = await fetch(`${SITE}${path}`, { method, headers: hdr, body: body || undefined });
      const text = await res.text();
      const isJson = text.trimStart().startsWith("{") || text.trimStart().startsWith("[");
      if (!res.ok) fail(`${method} ${path}`, `HTTP ${res.status} ${text.slice(0, 100)}`);
      else if (!isJson) fail(`${method} ${path}`, `non-json ${text.slice(0, 60)}`);
      else ok(`${method} ${path}`, `HTTP ${res.status}`);
    } catch (e) {
      fail(`${method} ${path}`, e instanceof Error ? e.message : String(e));
    }
  }
}

// Mailcow
if (MAIL_BASE && MAIL_KEY && MAIL_DOMAIN) {
  try {
    const local = `hchk${Math.random().toString(36).slice(2, 8)}`;
    const body = JSON.stringify({
      local_part: local,
      domain: MAIL_DOMAIN,
      name: local,
      quota: "64",
      password: "HcHkTmp1239!",
      password2: "HcHkTmp1239!",
      active: "1",
      force_pw_update: "0",
      tls_enforce_in: "0",
      tls_enforce_out: "0",
    });
    const r = await httpsJson(
      "POST",
      `${MAIL_BASE}/api/v1/add/mailbox`,
      { "X-API-Key": MAIL_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body,
      TLS_INSECURE,
    );
    if (r.status >= 200 && r.status < 300 && /success/i.test(r.text)) {
      ok("Mailcow add/mailbox", `${local}@${MAIL_DOMAIN}`);
    } else {
      fail("Mailcow add/mailbox", `status=${r.status} ${r.text.slice(0, 140)}`);
    }
  } catch (e) {
    fail("Mailcow add/mailbox", e instanceof Error ? e.message : String(e));
  }
}

// Proxies
const px = resolve(root, "proxies.txt");
if (existsSync(px)) {
  const n = readFileSync(px, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#")).length;
  if (n > 0) ok("proxies.txt", `${n} lines`);
  else fail("proxies.txt", "empty");
} else fail("proxies.txt", "missing");

const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== ${results.length - failed}/${results.length} passed ===\n`);
process.exit(failed ? 1 : 0);
