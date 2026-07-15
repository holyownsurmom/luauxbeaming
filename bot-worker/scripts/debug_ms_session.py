#!/usr/bin/env python3
"""Quick smoke test: open sticky session, hit account.live.com, print fingerprint."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# allow import proxy_pool
sys.path.insert(0, str(Path(__file__).resolve().parent))

from proxy_pool import load_proxies, next_proxy, proxy_label  # noqa: E402

try:
    import httpx
except ImportError:
    print("httpx missing")
    sys.exit(1)


def main() -> None:
    proxies = load_proxies()
    print(f"proxies loaded: {len(proxies)}")
    proxy = next_proxy()
    print(f"using: {proxy_label(proxy)}")
    try:
        client = httpx.Client(timeout=25.0, follow_redirects=True, proxy=proxy)
    except TypeError:
        client = httpx.Client(timeout=25.0, follow_redirects=True, proxies=proxy)

    r = client.get("https://login.live.com")
    print(f"login.live status={r.status_code} len={len(r.text)} cookies={list(client.cookies.keys())[:8]}")
    r2 = client.get("https://account.live.com/")
    text = r2.text
    flags = []
    for name, pat in [
        ("login", r'name="PPFT"|id="i0116"'),
        ("canary", r"apiCanary"),
        ("enc", r"encryptedNetId"),
        ("t0", r"\bt0\s*="),
        ("ServerData", r"ServerData\s*="),
    ]:
        if re.search(pat, text, re.I):
            flags.append(name)
    print(f"account.live status={r2.status_code} len={len(text)} fp={','.join(flags) or 'none'}")
    print(json.dumps({"ok": True, "proxy": proxy_label(proxy), "fp": flags}))


if __name__ == "__main__":
    main()
