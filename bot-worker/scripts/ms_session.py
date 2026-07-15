#!/usr/bin/env python3
"""
Long-lived sticky-proxy MS HTTP session.
Protocol (stdin/stdout, one JSON object per line):

  → {"op":"open","proxy":"http://...","cookies":{...}}
  ← {"ok":true,"proxy":"host:port"}

  → {"op":"fetch","id":1,"url":"...","method":"GET","headers":{},"body":null,"follow":true,"timeout":35}
  ← {"ok":true,"id":1,"status":200,"url":"...","text":"...","headers":{},"cookies":{...}}

  → {"op":"close"}
  ← {"ok":true}
"""
from __future__ import annotations

import json
import sys
from urllib.parse import urljoin

try:
    import httpx
except ImportError:
    print(json.dumps({"ok": False, "error": "httpx not installed"}), flush=True)
    sys.exit(0)

from proxy_pool import load_proxies, next_proxy, proxy_label

session: httpx.Client | None = None
base_cookies: dict = {}
proxy_url: str | None = None
proxy_lbl = "direct"


def log_err(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def make_client(proxy: str | None, timeout: float = 40.0) -> httpx.Client:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    }
    # connect short, read longer — Webshare stickies often stall on account.live
    to = httpx.Timeout(timeout, connect=15.0, read=timeout, write=20.0, pool=15.0)
    try:
        if proxy:
            return httpx.Client(
                timeout=to,
                follow_redirects=False,
                headers=headers,
                proxy=proxy,
            )
        return httpx.Client(timeout=to, follow_redirects=False, headers=headers)
    except TypeError:
        if proxy:
            return httpx.Client(
                timeout=to,
                follow_redirects=False,
                headers=headers,
                proxies=proxy,
            )
        return httpx.Client(timeout=to, follow_redirects=False, headers=headers)


def apply_cookies(client: httpx.Client, cookies: dict) -> None:
    for k, v in (cookies or {}).items():
        if not k or v is None:
            continue
        val = str(v)
        for domain in (
            "login.live.com",
            "account.live.com",
            ".live.com",
            "account.microsoft.com",
            ".microsoft.com",
            "sisu.xboxlive.com",
            ".xboxlive.com",
        ):
            try:
                client.cookies.set(k, val, domain=domain, path="/")
            except Exception:
                pass
        try:
            client.cookies.set(k, val)
        except Exception:
            pass


def cookie_header(cookies: dict) -> str:
    return "; ".join(f"{k}={v}" for k, v in (cookies or {}).items() if k and v is not None)


def dump_cookies(client: httpx.Client) -> dict:
    out = dict(base_cookies)
    try:
        for c in client.cookies.jar:
            out[c.name] = c.value
    except Exception:
        for k, v in client.cookies.items():
            out[k] = v
    return out


def do_fetch(req: dict) -> dict:
    global base_cookies
    if session is None:
        return {"ok": False, "error": "session not open", "id": req.get("id")}

    url = req.get("url") or ""
    method = (req.get("method") or "GET").upper()
    headers = dict(req.get("headers") or {})
    body = req.get("body")
    follow = req.get("follow", True)
    max_redirects = int(req.get("max_redirects") or 12)
    timeout = float(req.get("timeout") or 35)
    req_id = req.get("id")

    if not url:
        return {"ok": False, "error": "missing url", "id": req_id}

    # merge any extra cookies from node
    extra = req.get("cookies")
    if extra:
        base_cookies.update(extra)
        apply_cookies(session, extra)

    headers = {k: v for k, v in headers.items() if k.lower() not in ("cookie", "host")}
    current = url
    current_method = method
    current_body = body
    redirects = 0
    res = None

    try:
        # per-request timeout via client is fixed at open; use request timeout if supported
        while True:
            merged = dump_cookies(session)
            headers["Cookie"] = cookie_header(merged)
            res = session.request(
                current_method,
                current,
                headers=headers,
                content=current_body if current_body is not None else None,
                timeout=timeout,
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
                        if k.lower() not in ("content-type", "content-length")
                    }
                continue
            break

        text = res.text if res is not None else ""
        if len(text) > 2_500_000:
            text = text[:2_500_000]
        hdrs = {}
        if res is not None:
            for k, v in res.headers.items():
                if k.lower() != "set-cookie":
                    hdrs[k] = v
            loc = res.headers.get("location")
            if loc:
                hdrs["location"] = loc

        cookies = dump_cookies(session)
        base_cookies = cookies
        return {
            "ok": True,
            "id": req_id,
            "status": res.status_code if res is not None else 0,
            "url": str(res.url) if res is not None else current,
            "text": text,
            "headers": hdrs,
            "cookies": cookies,
            "proxy": proxy_lbl,
            "redirects": redirects,
        }
    except Exception as e:
        return {"ok": False, "error": str(e), "id": req_id, "proxy": proxy_lbl}


def handle(msg: dict) -> dict:
    global session, base_cookies, proxy_url, proxy_lbl
    op = msg.get("op")

    if op == "open":
        if session is not None:
            try:
                session.close()
            except Exception:
                pass
        proxy_url = msg.get("proxy")
        if not proxy_url:
            proxy_url = next_proxy() if load_proxies() else None
        proxy_lbl = proxy_label(proxy_url)
        base_cookies = dict(msg.get("cookies") or {})
        session = make_client(proxy_url)
        apply_cookies(session, base_cookies)
        log_err(f"[ms_session] open proxy={proxy_lbl} cookies={len(base_cookies)}")
        return {"ok": True, "proxy": proxy_lbl, "cookie_count": len(base_cookies)}

    if op == "fetch":
        return do_fetch(msg)

    if op == "ping":
        return {"ok": True, "proxy": proxy_lbl, "open": session is not None}

    if op == "close":
        if session is not None:
            try:
                session.close()
            except Exception:
                pass
        session = None
        return {"ok": True}

    return {"ok": False, "error": f"unknown op {op}"}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception as e:
            print(json.dumps({"ok": False, "error": f"bad json: {e}"}), flush=True)
            continue
        try:
            out = handle(msg)
        except Exception as e:
            out = {"ok": False, "error": str(e), "id": msg.get("id")}
        print(json.dumps(out, ensure_ascii=False), flush=True)
        if msg.get("op") == "close":
            break


if __name__ == "__main__":
    main()
