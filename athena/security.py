"""Optional PIN lock. When a PIN is set, the API only answers windows that have unlocked."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time

from . import store

COOKIE = "athena_session"
_sessions: dict[str, float] = {}  # token -> last activity
_fails = {"count": 0, "until": 0.0, "strikes": 0}


def _hash(pin: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), 200_000).hex()


def pin_set() -> bool:
    return bool(store.get_settings().get("pin_hash"))


def set_pin(new_pin: str) -> None:
    if not new_pin:
        store.update_settings({"pin_hash": "", "pin_salt": ""})
        _sessions.clear()
        return
    if not (new_pin.isdigit() and 4 <= len(new_pin) <= 12):
        raise ValueError("The PIN must be 4 to 12 digits")
    salt = secrets.token_hex(16)
    store.update_settings({"pin_hash": _hash(new_pin, salt), "pin_salt": salt})


def verify(pin: str) -> bool:
    s = store.get_settings()
    if not s.get("pin_hash"):
        return True
    return hmac.compare_digest(_hash(pin or "", s["pin_salt"]), s["pin_hash"])


def unlock(pin: str) -> str:
    now = time.time()
    if now < _fails["until"]:
        raise PermissionError(f"Too many tries. Wait {int(_fails['until'] - now) + 1} seconds.")
    if not verify(pin):
        _fails["count"] += 1
        if _fails["count"] >= 5:  # each lockout is twice as long as the last: 30 s, 1 min, 2 min … up to an hour
            _fails["strikes"] += 1
            _fails.update(count=0, until=now + min(3600, 30 * 2 ** (_fails["strikes"] - 1)))
        raise PermissionError("Wrong PIN")
    _fails.update(count=0, strikes=0)
    token = secrets.token_urlsafe(24)
    _sessions[token] = now
    return token


def is_unlocked(token: str | None, touch: bool = True) -> bool:
    if not pin_set():
        return True
    if not token or token not in _sessions:
        return False
    idle = (store.get_settings().get("auto_lock_minutes") or 0) * 60
    now = time.time()
    if idle and now - _sessions[token] > idle:
        _sessions.pop(token, None)
        return False
    if touch:
        _sessions[token] = now
    return True


def lock(token: str | None) -> None:
    if token:
        _sessions.pop(token, None)
