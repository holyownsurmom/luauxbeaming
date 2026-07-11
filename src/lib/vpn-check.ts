const VPN_ISPS = [
  "mullvad",
  "nordvpn",
  "expressvpn",
  "surfshark",
  "protonvpn",
  "cyberghost",
  "private internet access",
  "pia",
  "torguard",
  "windscribe",
  "ivpn",
  "airvpn",
  "hide.me",
  "vpn",
  "wireguard",
];

export async function getClientIp(request: Request): Promise<string | null> {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return null;
}

export async function checkVpn(ip: string): Promise<{ vpn: boolean; ip: string; reason?: string }> {
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip === "localhost") {
    return { vpn: false, ip };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(
      `https://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,proxy,hosting,isp,query`,
      {
        signal: controller.signal,
        headers: { "User-Agent": "LuauX-Bot-Manager/1.0" },
      },
    );
    clearTimeout(timeout);

    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
      console.warn(`[vpn] rate limited, waiting ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 30000)));
      return { vpn: false, ip, reason: "rate_limited" };
    }

    if (!res.ok) return { vpn: false, ip, reason: `http_${res.status}` };

    const data = (await res.json()) as {
      status: string;
      proxy: boolean;
      hosting: boolean;
      isp: string;
      query: string;
    };

    if (data.status !== "success") return { vpn: false, ip, reason: "api_error" };

    if (data.proxy) {
      return { vpn: true, ip: data.query || ip, reason: "proxy_flag" };
    }

    if (data.hosting) {
      return { vpn: true, ip: data.query || ip, reason: "hosting_flag" };
    }

    const ispLower = (data.isp || "").toLowerCase();
    for (const vpnKeyword of VPN_ISPS) {
      if (ispLower.includes(vpnKeyword)) {
        return { vpn: true, ip: data.query || ip, reason: `isp_match:${vpnKeyword}` };
      }
    }

    return { vpn: false, ip: data.query || ip };
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("abort")) {
      console.warn("[vpn] request timed out");
    }
    return { vpn: false, ip, reason: `error:${msg}` };
  }
}
