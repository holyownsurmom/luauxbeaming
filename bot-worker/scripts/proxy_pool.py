"""Residential sticky proxy pool for Microsoft OTP / secure flows."""
from __future__ import annotations

import os
import random
import threading
from pathlib import Path

_lock = threading.Lock()
_idx = 0
_bad: set[str] = set()


def _parse_line(line: str) -> str | None:
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    # host:port:user:pass
    if line.count(":") >= 3 and "://" not in line:
        host, port, user, password = line.split(":", 3)
        return f"http://{user}:{password}@{host}:{port}"
    # user:pass@host:port
    if "@" in line and "://" not in line:
        return f"http://{line}"
    # already URL
    if line.startswith("http://") or line.startswith("socks5://") or line.startswith("https://"):
        return line
    return None


def load_proxies() -> list[str]:
    urls: list[str] = []
    env_list = os.environ.get("PROXY_LIST") or os.environ.get("MS_PROXIES") or ""
    if env_list:
        for part in env_list.replace(";", "\n").replace(",", "\n").splitlines():
            u = _parse_line(part)
            if u:
                urls.append(u)

    # bot-worker/proxies.txt next to scripts/
    root = Path(__file__).resolve().parent.parent
    for name in ("proxies.txt", "proxy.txt", "Webshare 20 proxies.txt"):
        p = root / name
        if p.is_file():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                u = _parse_line(line)
                if u:
                    urls.append(u)

    # de-dupe preserve order
    seen: set[str] = set()
    out: list[str] = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def mark_bad(proxy_url: str | None) -> None:
    if not proxy_url:
        return
    with _lock:
        _bad.add(proxy_url)


def next_proxy() -> str | None:
    """Round-robin sticky proxy; skip recently bad ones if possible."""
    global _idx
    proxies = load_proxies()
    if not proxies:
        return None
    with _lock:
        good = [p for p in proxies if p not in _bad]
        pool = good if good else proxies
        if not good and _bad:
            # all marked bad — reset and try again
            _bad.clear()
            pool = proxies
        _idx = (_idx + 1) % len(pool)
        return pool[_idx]


def random_proxy() -> str | None:
    proxies = load_proxies()
    if not proxies:
        return None
    with _lock:
        good = [p for p in proxies if p not in _bad] or proxies
    return random.choice(good)


def proxy_label(proxy_url: str | None) -> str:
    if not proxy_url:
        return "direct"
    # hide credentials
    if "@" in proxy_url:
        return proxy_url.split("@", 1)[1]
    return proxy_url[:40]
