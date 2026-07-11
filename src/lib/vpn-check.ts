export async function getClientIp(request: Request): Promise<string | null> {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  try {
    const url = new URL(request.url);
    if (url.hostname && url.hostname !== "localhost") {
      return url.hostname;
    }
  } catch {
    /* ignore */
  }

  return null;
}

export async function checkVpn(ip: string): Promise<{ vpn: boolean; ip: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,proxy,query`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return { vpn: false, ip };

    const data = (await res.json()) as { status: string; proxy: boolean; query: string };

    if (data.status !== "success") return { vpn: false, ip };

    return { vpn: data.proxy === true, ip: data.query || ip };
  } catch {
    clearTimeout(timeout);
    return { vpn: false, ip };
  }
}
