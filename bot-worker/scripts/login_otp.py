#!/usr/bin/env python3
"""
Login with email OTP → dump session cookies as JSON.
Uses residential proxies from proxies.txt (same pool as send_ott).
"""
from __future__ import annotations

import json
import re
import sys
from urllib.parse import quote

try:
    import httpx
except ImportError:
    print(json.dumps({"ok": False, "error": "httpx not installed"}))
    sys.exit(0)

from proxy_pool import load_proxies, mark_bad, next_proxy, proxy_label


def get_session(proxy_url: str | None = None) -> httpx.Client:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        if proxy_url:
            return httpx.Client(
                timeout=40.0, follow_redirects=True, headers=headers, proxy=proxy_url
            )
        return httpx.Client(timeout=40.0, follow_redirects=True, headers=headers)
    except TypeError:
        if proxy_url:
            return httpx.Client(
                timeout=40.0, follow_redirects=True, headers=headers, proxies=proxy_url
            )
        return httpx.Client(timeout=40.0, follow_redirects=True, headers=headers)


def get_live_data(session: httpx.Client) -> dict:
    response = session.post("https://login.live.com")
    url_post = re.search(
        r"https://login\.live\.com/ppsecure/post\.srf\?[^\"'\\\s]+",
        response.text,
    )
    if not url_post:
        raise RuntimeError("urlPost missing")
    ppft = re.search(r'name="PPFT"[^>]*value="([^"]+)"', response.text) or re.search(
        r'value=\\?"([^"]+)"', response.text
    )
    if not ppft:
        raise RuntimeError("PPFT missing")
    return {"urlPost": url_post.group(0), "ppft": ppft.group(1)}


def has_msaauth(session: httpx.Client) -> bool:
    names = set(session.cookies.keys())
    return bool(
        names
        & {
            "__Host-MSAAUTH",
            "__Host-MSAAUTH1P",
            "MSPAuth",
            "MSPProf",
            "WLSSC",
            "MSPOK",
        }
        and ("__Host-MSAAUTH" in names or "MSPAuth" in names or "WLSSC" in names)
    )


def login_with_code(session: httpx.Client, email: str, proof_id: str, code: str) -> dict:
    odata = get_live_data(session)
    payloads = [
        {
            "login": email,
            "loginfmt": email,
            "SentProofIDE": proof_id,
            "otc": code,
            "type": "27",
            "PPFT": odata["ppft"],
        },
        {
            "login": email,
            "loginfmt": email,
            "SentProofIDE": proof_id,
            "npotc": code,
            "type": "24",
            "PPFT": odata["ppft"],
        },
    ]

    last_text = ""
    for i, payload in enumerate(payloads):
        login_data = session.post(
            url=odata["urlPost"],
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://login.live.com",
                "Referer": "https://login.live.com/",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "same-origin",
            },
            data=payload,
            follow_redirects=True,
        )
        last_text = login_data.text or ""
        cookie_names = list(session.cookies.keys())
        print(f"[login_otp] attempt {i + 1} cookies={cookie_names[:12]}", file=sys.stderr)

        if "__Host-MSAAUTH" in session.cookies or "MSPAuth" in session.cookies:
            break

        # Intermediate notice form
        m = re.search(
            r'action="([^"]+)".*?id="correlation_id" value="([^"]+)".*?id="code" value="([^"]+)"',
            last_text,
            re.DOTALL,
        )
        if m:
            action_url, cid, acode = m.groups()
            notice = session.post(
                action_url,
                data={"correlation_id": cid, "code": acode},
                follow_redirects=True,
            )
            last_text = notice.text or last_text
            redir = re.search(r"var redirectUrl = '([^']+)'", last_text)
            if redir:
                session.get(redir.group(1).replace(r"\u0026", "&"), follow_redirects=True)
            if "__Host-MSAAUTH" in session.cookies or "MSPAuth" in session.cookies:
                break

        # KMSI / stay signed in
        url_post = re.search(r'"urlPost"\s*:\s*"([^"]+)"', last_text)
        sft = re.search(r'"sFT"\s*:\s*"([^"]+)"', last_text)
        if url_post and sft and "__Host-MSAAUTH" not in session.cookies:
            session.post(
                url_post.group(1).replace(r"\u0026", "&"),
                data={"LoginOptions": "1", "type": "28", "PPFT": sft.group(1)},
                follow_redirects=True,
            )
            if "__Host-MSAAUTH" in session.cookies or "MSPAuth" in session.cookies:
                break

    if not ("__Host-MSAAUTH" in session.cookies or "MSPAuth" in session.cookies or "WLSSC" in session.cookies):
        snip = re.sub(r"\s+", " ", last_text)[:220]
        return {
            "ok": False,
            "error": f"No MSAAUTH cookie after OTP login. page={snip}",
            "cookies": dict(session.cookies),
        }

    cookies = {k: v for k, v in session.cookies.items()}
    return {"ok": True, "cookies": cookies}


def main() -> None:
    if len(sys.argv) < 4:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "usage: login_otp.py <email> <proofId> <code>",
                }
            )
        )
        return
    email, proof_id, code = sys.argv[1].strip(), sys.argv[2].strip(), sys.argv[3].strip()
    proxies = load_proxies()
    max_tries = min(6, max(2, len(proxies))) if proxies else 1
    last = {"ok": False, "error": "no attempt"}

    for i in range(max_tries):
        proxy = next_proxy() if proxies else None
        label = proxy_label(proxy)
        print(f"[login_otp] try {i + 1}/{max_tries} via {label}", file=sys.stderr)
        try:
            with get_session(proxy) as session:
                result = login_with_code(session, email, proof_id, code)
                result["proxy"] = label
                if result.get("ok"):
                    print(json.dumps(result))
                    return
                last = result
                if "invalid" in (result.get("error") or "").lower():
                    break
                if proxy:
                    mark_bad(proxy)
        except Exception as e:
            last = {"ok": False, "error": str(e), "proxy": label}
            if proxy:
                mark_bad(proxy)
    print(json.dumps(last))


if __name__ == "__main__":
    main()
