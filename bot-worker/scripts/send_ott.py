#!/usr/bin/env python3
"""Exact Autosecure sendOtt + sendAuth (httpx). Prints JSON to stdout."""
from __future__ import annotations

import json
import re
import sys
from urllib.parse import unquote

try:
    import httpx
except ImportError:
    print(json.dumps({"ok": False, "error": "httpx not installed — run: pip install httpx"}))
    sys.exit(0)


def get_session() -> httpx.Client:
    return httpx.Client(
        timeout=30.0,
        follow_redirects=False,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
        },
    )


def get_live_data(session: httpx.Client) -> dict:
    response = session.post("https://login.live.com")
    url_post = re.search(
        r"https://login\.live\.com/ppsecure/post\.srf\?contextid=[0-9a-zA-Z]{1,100}&opid=[0-9a-zA-Z]{1,100}&bk=[a-zA-Z0-9]{1,100}&uaid=[0-9a-zA-Z]{1,100}&pid=0",
        response.text,
    )
    if not url_post:
        url_post = re.search(
            r"https://login\.live\.com/ppsecure/post\.srf\?[^\"'\\\s]+",
            response.text,
        )
    if not url_post:
        raise RuntimeError("Failed to extract urlPost")
    ppft = re.search(r'value=\\?"([^"]+)"', response.text)
    if not ppft:
        raise RuntimeError("Failed to extract PPFT")
    return {"urlPost": url_post.group(0), "ppft": ppft.group(1)}


def send_auth(session: httpx.Client, email: str) -> dict:
    r = session.post(
        "https://login.live.com/GetCredentialType.srf",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json; charset=utf-8",
            "Referer": "https://login.live.com/",
            "hpgact": "0",
            "hpgid": "33",
        },
        json={
            "checkPhones": True,
            "country": "",
            "federationFlags": 3,
            "forceotclogin": True,
            "isCookieBannerShown": True,
            "isExternalFederationDisallowed": True,
            "isFederationDisabled": True,
            "isFidoSupported": True,
            "isOtherIdpSupported": False,
            "isRemoteConnectSupported": False,
            "isRemoteNGCSupported": True,
            "isSignup": False,
            "otclogindisallowed": False,
            "username": email,
        },
    )
    return r.json()


def send_ott(session: httpx.Client, email: str, security_email: str) -> tuple[bool, str]:
    data = get_live_data(session)

    login_data = session.post(
        url=data["urlPost"],
        headers={
            "host": "login.live.com",
            "Accept-Language": "en-US,en;q=0.5",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://login.live.com",
            "Referer": "https://login.live.com/",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
        },
        data={
            "ps": 2,
            "PPFT": data["ppft"],
            "PPSX": "Pass",
            "login": email,
            "loginfmt": email,
            "type": 11,
            "passwd": "",
        },
    )

    # If redirected, follow once (some tenants 302 to identity page)
    text = login_data.text
    if login_data.is_redirect and login_data.headers.get("location"):
        loc = login_data.headers["location"]
        if loc.startswith("/"):
            loc = "https://login.live.com" + loc
        follow = session.get(loc)
        text = follow.text

    action_m = re.search(r'action="([^"]+)"', text)
    ipt_m = re.search(r'name="ipt"[^>]+value="([^"]+)"', text)
    pprid_m = re.search(r'name="pprid"[^>]+value="([^"]+)"', text)
    if not action_m or not ipt_m or not pprid_m:
        snip = re.sub(r"\s+", " ", text)[:200]
        return False, f"missing ipt/pprid: {snip}"

    action = action_m.group(1)
    ipt = unquote(ipt_m.group(1))
    pprid = pprid_m.group(1)

    identity_confirm = session.post(
        url=action,
        headers={
            "host": "account.live.com",
            "Accept-Language": "en-US,en;q=0.5",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://login.live.com",
            "Referer": "https://login.live.com/",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
        },
        data={"pprid": pprid, "ipt": ipt},
    )
    id_text = identity_confirm.text
    if identity_confirm.is_redirect and identity_confirm.headers.get("location"):
        loc = identity_confirm.headers["location"]
        if loc.startswith("/"):
            loc = "https://account.live.com" + loc
        id_text = session.get(loc, follow_redirects=True).text

    raw_str = re.search(r'"rawProofList"\s*:\s*"([^"]+)"', id_text)
    if not raw_str:
        snip = re.sub(r"\s+", " ", id_text)[:200]
        return False, f"no rawProofList: {snip}"

    raw = json.loads(raw_str.group(1).encode().decode("unicode_escape"))
    epid = next(
        (p["epid"] for p in raw if p.get("type") == "Email" and p.get("epid")),
        raw[0]["epid"] if raw else None,
    )
    if not epid:
        return False, "no epid"

    api_canary = (
        re.search(r'"apiCanary"\s*:\s*"([^"]+)"', id_text)
        .group(1)
        .encode()
        .decode("unicode_escape")
    )
    eipt = (
        re.search(r'"eipt"\s*:\s*"([^"]+)"', id_text).group(1).encode().decode("unicode_escape")
    )
    uaid = re.search(r'"uaid"\s*:\s*"([^"]+)"', id_text).group(1)

    resp = session.post(
        url="https://account.live.com/api/Proofs/SendOtt",
        headers={
            "Content-type": "application/json",
            "Accept": "application/json",
            "hpgid": "200368",
            "scid": "100166",
            "canary": api_canary,
            "eipt": eipt,
            "uaid": uaid,
            "uiflvr": "1001",
            "hpgact": "0",
        },
        json={
            "token": "",
            "purpose": "UnfamiliarLocationHard",
            "epid": epid,
            "autoVerification": False,
            "autoVerificationFailed": False,
            "confirmProof": security_email,
            "uaid": uaid,
            "uiflvr": 1001,
            "scid": 100166,
            "hpgid": 200368,
        },
    )
    body = (resp.text or "")[:200]
    if resp.status_code == 200:
        return True, body
    return False, f"SendOtt {resp.status_code}: {body}"


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: send_ott.py <email>"}))
        return
    email = sys.argv[1].strip()
    try:
        with get_session() as session:
            info = send_auth(session, email)
            if len(info) == 1:
                print(
                    json.dumps(
                        {
                            "ok": False,
                            "error": "Email OTP cooldown — wait a few minutes and try again.",
                        }
                    )
                )
                return
            if "Credentials" not in info:
                print(json.dumps({"ok": False, "error": "Email does not exist / no credentials"}))
                return
            creds = info["Credentials"]
            if "RemoteNgcParams" in creds and creds["RemoteNgcParams"]:
                print(json.dumps({"ok": False, "error": "Authenticator-only account"}))
                return
            proofs = creds.get("OtcLoginEligibleProofs") or []
            if not proofs:
                print(json.dumps({"ok": False, "error": "No email OTP proofs"}))
                return
            selected = proofs[0]
            ver_email = selected.get("display") or "unknown"
            proof_id = selected.get("data") or ""
            ok, detail = send_ott(session, email, ver_email)
            print(
                json.dumps(
                    {
                        "ok": ok,
                        "securityEmail": ver_email,
                        "proofId": proof_id,
                        "error": None if ok else detail,
                        "detail": detail if ok else detail,
                    }
                )
            )
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))


if __name__ == "__main__":
    main()
