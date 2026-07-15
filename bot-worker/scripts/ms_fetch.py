#!/usr/bin/env python3
"""
Authenticated MS HTTP via residential proxy (same pool as login_otp / send_ott).
stdin JSON → stdout JSON one-shot request with cookie jar merge.
"""
from __future__ import annotations

import json
import sys
from urllib.parse import urljoin, urlparse

try:
    import httpx
except ImportError:
    print(json.dumps({"ok": False, "error": "httpx not installed"}))
    sys.exit(0)

from proxy_pool import load_proxies, mark_bad, next_proxy, proxy_label

MS_DOMAINS = (
    ".live.com",
    "login.live.com",
    "account.live.com",
    ".microsoft.com",
    "account.microsoft.com",
    ".xboxlive.com",
    "sisu.xboxlive.com",
)


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
    """Inject jar cookies so they are sent to MS hosts (incl. __Host-*)."""
    for k, v in (cookies or {}).items():
        if not k or v is None:
            continue
        val = str(v)
        # Prefer Cookie header injection for Host-prefixed cookies
        # also register under common MS domains for httpx jar
        try:
            session.cookies.set(k, val, domain="login.live.com", path="/")
        except Exception:
            pass
        try:
            session.cookies.set(k, val, domain="account.live.com", path="/")
        except Exception:
            pass
        try:
            session.cookies.set(k, val, domain=".live.com", path="/")
        except Exception:
            pass
        try:
            session.cookies.set(k, val, domain="account.microsoft.com", path="/")
        except Exception:
            pass
        try:
            session.cookies.set(k, val, domain=".microsoft.com", path="/")
        except Exception:
            pass
        try:
            session.cookies.set(k, val)
        except Exception:
            pass


def cookie_header(cookies: dict) -> str:
    return "; ".join(f"{k}={v}" for k, v in (cookies or {}).items() if k and v is not None)


def dump_cookies(session: httpx.Client, base: dict) -> dict:
    out = dict(base or {})
    try:
        for cookie in session.cookies.jar:
            out[cookie.name] = cookie.value
    except Exception:
        for k, v in session.cookies.items():
            out[k] = v
    return out


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

    # Always send explicit Cookie header so __Host-MSAAUTH is not dropped
    ch = cookie_header(cookies)
    if ch and "cookie" not in {k.lower() for k in headers}:
        headers["Cookie"] = ch

    try:
        with client(proxy, timeout) as session:
            apply_cookies(session, cookies)
            current = url
            current_method = method
            current_body = body
            redirects = 0
            res = None
            while True:
                # refresh cookie header each hop from merged jar
                merged = dump_cookies(session, cookies)
                headers["Cookie"] = cookie_header(merged)

                res = session.request(
                    current_method,
                    current,
                    headers=headers,
                    content=current_body if current_body is not None else None,
                )
                if (
                    follow
                    and res.status_code in (301, 302, 303, 307, 308)
                    and redirects < max_redirects
                ):
                    loc = res.headers.get("location")
                    if not loc:
                        break
                    redirects += 1
                    current = urljoin(current, loc)
                    if res.status_code in (301, 302, 303) and current_method not in (
                        "GET",
                        "HEAD",
                    ):
                        current_method = "GET"
                        current_body = None
                        headers = {
                            k: v
                            for k, v in headers.items()
                            if k.lower()
                            not in ("content-type", "content-length")
                        }
                    continue
                break

            text = res.text if res is not None else ""
            if len(text) > 2_000_000:
                text = text[:2_000_000]
            hdrs = {}
            if res is not None:
                for k, v in res.headers.items():
                    if k.lower() != "set-cookie":
                        hdrs[k] = v
                loc = res.headers.get("location")
                if loc:
                    hdrs["location"] = loc
            final_cookies = dump_cookies(session, cookies)
            return {
                "ok": True,
                "status": res.status_code if res is not None else 0,
                "url": str(res.url) if res is not None else current,
                "text": text,
                "headers": hdrs,
                "cookies": final_cookies,
                "proxy": label,
                "redirects": redirects,
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
