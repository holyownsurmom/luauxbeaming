#!/usr/bin/env python3
"""
Authenticated MS HTTP via residential proxy (same pool as login_otp / send_ott).
stdin JSON:
  {
    "url": "...",
    "method": "GET|POST",
    "headers": {},
    "body": "..." | null,
    "cookies": {"name": "value"},
    "proxy": "http://user:pass@host:port" | null,  # sticky preferred
    "follow": true,
    "timeout": 35
  }
stdout JSON:
  { ok, status, url, text, cookies, proxy, error? }
"""
from __future__ import annotations

import json
import sys

try:
    import httpx
except ImportError:
    print(json.dumps({"ok": False, "error": "httpx not installed"}))
    sys.exit(0)

from proxy_pool import load_proxies, mark_bad, next_proxy, proxy_label


def client(proxy_url: str | None, timeout: float) -> httpx.Client:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        if proxy_url:
            return httpx.Client(
                timeout=timeout,
                follow_redirects=False,
                headers=headers,
                proxy=proxy_url,
            )
        return httpx.Client(timeout=timeout, follow_redirects=False, headers=headers)
    except TypeError:
        if proxy_url:
            return httpx.Client(
                timeout=timeout,
                follow_redirects=False,
                headers=headers,
                proxies=proxy_url,
            )
        return httpx.Client(timeout=timeout, follow_redirects=False, headers=headers)


def apply_cookies(session: httpx.Client, cookies: dict) -> None:
    for k, v in (cookies or {}).items():
        if not k or v is None:
            continue
        # domain-less cookies work for subsequent requests on MS hosts
        session.cookies.set(k, str(v))


def dump_cookies(session: httpx.Client) -> dict:
    return {k: v for k, v in session.cookies.items()}


def do_request(req: dict) -> dict:
    url = req.get("url") or ""
    method = (req.get("method") or "GET").upper()
    headers = dict(req.get("headers") or {})
    body = req.get("body")
    cookies = req.get("cookies") or {}
    follow = req.get("follow", True)
    timeout = float(req.get("timeout") or 35)
    proxy = req.get("proxy")
    if not proxy:
        proxy = next_proxy() if load_proxies() else None
    label = proxy_label(proxy)
    max_redirects = int(req.get("max_redirects") or 12)

    if not url:
        return {"ok": False, "error": "missing url", "proxy": label}

    try:
        with client(proxy, timeout) as session:
            apply_cookies(session, cookies)
            current = url
            current_method = method
            current_body = body
            redirects = 0
            res = None
            while True:
                res = session.request(
                    current_method,
                    current,
                    headers=headers,
                    content=current_body if current_body is not None else None,
                )
                # merge set-cookie into jar automatically via httpx
                if (
                    follow
                    and res.status_code in (301, 302, 303, 307, 308)
                    and redirects < max_redirects
                ):
                    loc = res.headers.get("location")
                    if not loc:
                        break
                    redirects += 1
                    from urllib.parse import urljoin

                    current = urljoin(current, loc)
                    if res.status_code in (301, 302, 303) and current_method not in (
                        "GET",
                        "HEAD",
                    ):
                        current_method = "GET"
                        current_body = None
                        # drop content-type on method change
                        headers = {
                            k: v
                            for k, v in headers.items()
                            if k.lower() not in ("content-type", "content-length")
                        }
                    continue
                break

            text = res.text if res is not None else ""
            # cap body for IPC (node parses)
            if len(text) > 2_000_000:
                text = text[:2_000_000]
            hdrs = {}
            if res is not None:
                for k, v in res.headers.items():
                    if k.lower() != "set-cookie":
                        hdrs[k] = v
                # ensure location is present for manual-redirect callers
                loc = res.headers.get("location")
                if loc:
                    hdrs["location"] = loc
            return {
                "ok": True,
                "status": res.status_code if res is not None else 0,
                "url": str(res.url) if res is not None else current,
                "text": text,
                "headers": hdrs,
                "cookies": dump_cookies(session),
                "proxy": label,
            }
    except Exception as e:
        if proxy:
            mark_bad(proxy)
        return {"ok": False, "error": str(e), "proxy": label}


def main() -> None:
    raw = sys.stdin.read()
    try:
        req = json.loads(raw) if raw.strip() else {}
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"bad json: {e}"}))
        return
    print(json.dumps(do_request(req), ensure_ascii=False))


if __name__ == "__main__":
    main()
