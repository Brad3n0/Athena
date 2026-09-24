"""Reminders, timers and the morning briefing — checked in the background every few seconds.

When one is due it's pushed to every open Athena window (and the desktop tray, if running).
If Athena isn't open at that moment, it's delivered as soon as a window connects.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta
from typing import Any, Callable

from . import events, store

REMINDERS_FILE = store.DATA_DIR / "reminders.json"
_lock = threading.RLock()
_started = False
# Extra listeners (the desktop tray shows a Windows notification)
on_fire: list[Callable[[dict[str, Any]], None]] = []


def _load() -> list[dict[str, Any]]:
    return store._read(REMINDERS_FILE, [])


def _save(items: list[dict[str, Any]]) -> None:
    store._write(REMINDERS_FILE, items)


def parse_when(at: str = "", minutes: float | None = None) -> datetime:
    now = datetime.now()
    if minutes not in (None, ""):
        return now + timedelta(minutes=float(minutes))
    text = (at or "").strip().replace("Z", "")
    if not text:
        raise ValueError("Say when: a date/time like '2026-10-01T18:00' or a number of minutes")
    try:
        when = datetime.fromisoformat(text)
    except ValueError:
        for fmt in ("%H:%M", "%I:%M %p", "%I %p", "%I:%M%p", "%I%p"):
            try:
                t = datetime.strptime(text.upper(), fmt)
                when = now.replace(hour=t.hour, minute=t.minute, second=0, microsecond=0)
                if when <= now:
                    when += timedelta(days=1)
                break
            except ValueError:
                continue
        else:
            raise ValueError(f"Couldn't understand the time '{at}'. Use a format like 2026-10-01T18:00")
    if when.tzinfo is not None:
        when = when.astimezone().replace(tzinfo=None)
    return when


def add(text: str, when: datetime, kind: str = "reminder") -> dict[str, Any]:
    if when <= datetime.now() - timedelta(seconds=5):
        raise ValueError("That time is already in the past")
    item = {"id": store.new_id()[:8], "text": text.strip()[:300] or kind.title(), "at": when.timestamp(),
            "kind": kind, "created": time.time(), "fired": False}
    with _lock:
        items = _load()
        items.append(item)
        _save(items)
    return item


def pending() -> list[dict[str, Any]]:
    return sorted((r for r in _load() if not r["fired"]), key=lambda r: r["at"])


def cancel(query: str) -> dict[str, Any] | None:
    query = (query or "").strip().lower()
    with _lock:
        items = _load()
        for r in items:
            if not r["fired"] and (r["id"] == query or query in r["text"].lower()):
                items.remove(r)
                _save(items)
                return r
    return None


def describe(r: dict[str, Any]) -> dict[str, Any]:
    when = datetime.fromtimestamp(r["at"])
    return {"id": r["id"], "text": r["text"], "kind": r["kind"], "when": when.strftime("%a %b %d, %I:%M %p").replace(" 0", " ")}


def _tick() -> None:
    now = time.time()
    has_listener = events.listener_count() > 0 or bool(on_fire)
    if not has_listener:
        return
    with _lock:
        items = _load()
        due = [r for r in items if not r["fired"] and r["at"] <= now]
        for r in due:
            r["fired"] = True
        if due:
            # keep the file small: drop reminders that fired more than a week ago
            items = [r for r in items if not r["fired"] or r["at"] > now - 7 * 86400]
            _save(items)
    for r in due:
        payload = {**describe(r), "late": now - r["at"] > 120}
        events.publish("reminder", **payload)
        for cb in on_fire:
            try:
                cb(payload)
            except Exception:
                pass
    _maybe_briefing()


def _maybe_briefing() -> None:
    settings = store.get_settings()
    at = (settings.get("briefing_time") or "").strip()
    if not at or events.listener_count() == 0:
        return
    now = datetime.now()
    try:
        hh, mm = (int(x) for x in at.split(":"))
    except ValueError:
        return
    start = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    today = now.strftime("%Y-%m-%d")
    if start <= now < start + timedelta(hours=4) and settings.get("briefing_last") != today:
        store.update_settings({"briefing_last": today})
        events.publish("briefing")


def start() -> None:
    global _started
    if _started:
        return
    _started = True

    def loop():
        while True:
            try:
                _tick()
            except Exception:
                pass
            time.sleep(3)

    threading.Thread(target=loop, daemon=True, name="athena-scheduler").start()
