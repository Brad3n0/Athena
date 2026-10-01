"""Nightly reflection: once a day, while the PC is idle, Athena reads back over the day's chats and writes down what
to do better (mistakes you corrected, things that annoyed you, what you liked). They become lessons she follows
from then on, in Settings → About you, where you can edit or delete any of them.

Runs at most once a day, in the evening or at night, only when Athena hasn't been used for a while and no game or
fullscreen app is in front, and never changes her personality settings.
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime
from typing import Any

import httpx

from . import learning, store

LOG_FILE = store.DATA_DIR / "reflections.json"
IDLE_MINUTES = 20
_last_activity = [time.time()]
_running = threading.Lock()

PROMPT = (
    "You are Athena, the user's personal AI. Below are today's conversations between the user and you. Reflect on them "
    "like a thoughtful person at the end of the day.\n\n"
    "Find up to 3 concrete lessons for yourself: mistakes you made that the user corrected or was annoyed by, things "
    "you did that they clearly liked, or preferences they showed. Write each as one short instruction to yourself, e.g. "
    "\"When the user asks for code, give the full file instead of snippets.\" Only real lessons that are clearly shown "
    "in the conversations; never invent any, and an empty list is fine. Don't include facts about the user (those are "
    "remembered separately) or anything about your personality or tone unless the user asked for it.\n"
    "Also write a warm 1-2 sentence summary of the day from your point of view.\n\n"
    'Reply with JSON only: {"lessons": ["..."], "summary": "..."}\n\n'
)


def touch() -> None:
    """Athena was just used (a chat message): reflection waits until she's been idle a while."""
    _last_activity[0] = time.time()


def log() -> list[dict[str, Any]]:
    return store._read(LOG_FILE, [])


def _done_today() -> bool:
    items = log()
    return bool(items) and items[-1].get("date") == datetime.now().strftime("%Y-%m-%d")


def _updated_s(chat: dict[str, Any]) -> float:
    t = float(chat.get("updated") or 0)
    return t / 1000 if t > 1e12 else t


def _transcript(hours: float = 26, limit: int = 9000) -> tuple[str, int]:
    since = time.time() - hours * 3600
    parts, chats = [], 0
    for meta in store.list_conversations():
        if _updated_s(meta) < since or meta.get("mode") == "code":
            continue
        chat = store.get_conversation(meta["id"]) or {}
        lines = []
        for m in (chat.get("messages") or [])[-24:]:
            text = str(m.get("display") or m.get("content") or "").strip()
            if m.get("role") in ("user", "assistant") and text:
                who = "User" if m["role"] == "user" else "Athena"
                lines.append(f"{who}: {text[:500]}")
        if lines:
            chats += 1
            parts.append(f"--- Chat: {meta.get('title') or 'untitled'}\n" + "\n".join(lines))
        if sum(len(p) for p in parts) > limit:
            break
    return "\n\n".join(parts)[:limit], chats


def _model(ollama: str) -> str:
    chosen = ((store.get_settings().get("models") or {}).get("assistant") or "").strip()
    try:
        names = [m["name"] for m in httpx.get(f"{ollama}/api/tags", timeout=5).json().get("models", [])]
    except (httpx.HTTPError, ValueError):
        return ""
    if chosen in names:
        return chosen
    return next((n for n in names if "embed" not in n), "")


def run(ollama: str) -> dict[str, Any]:
    """Reflect on today's chats now. Returns what happened (also kept in the reflection log)."""
    if not _running.acquire(blocking=False):
        return {"note": "Already reflecting"}
    try:
        text, chats = _transcript()
        entry: dict[str, Any] = {"date": datetime.now().strftime("%Y-%m-%d"), "time": time.time(), "chats": chats,
                                 "lessons": [], "summary": ""}
        if not text:
            entry["summary"] = "No chats today, so nothing to reflect on."
        else:
            model = _model(ollama)
            if not model:
                return {"error": "No model to reflect with right now"}
            r = httpx.post(f"{ollama}/api/chat", json={
                "model": model, "stream": False, "format": "json", "think": False, "keep_alive": "2m",
                "options": {"temperature": 0.2, "num_predict": 400},
                "messages": [{"role": "user", "content": PROMPT + text}]}, timeout=httpx.Timeout(20, read=600))
            if r.status_code == 400 and "think" in r.text.lower():  # models that can't switch thinking off
                r = httpx.post(f"{ollama}/api/chat", json={
                    "model": model, "stream": False, "format": "json", "keep_alive": "2m",
                    "options": {"temperature": 0.2, "num_predict": 400},
                    "messages": [{"role": "user", "content": PROMPT + text}]}, timeout=httpx.Timeout(20, read=600))
            r.raise_for_status()
            raw = (r.json().get("message") or {}).get("content") or ""
            m = re.search(r"\{.*\}", raw, re.S)
            data = json.loads(m.group(0)) if m else {}
            entry["summary"] = str(data.get("summary") or "")[:400]
            for lesson in (data.get("lessons") or [])[:3]:
                if isinstance(lesson, str) and (added := learning.add_lesson(lesson, "reflection")):
                    entry["lessons"].append(added["text"])
        items = (log() + [entry])[-60:]
        store._write(LOG_FILE, items)
        return entry
    except (httpx.HTTPError, ValueError) as exc:
        return {"error": f"Couldn't reflect right now ({exc.__class__.__name__})"}
    finally:
        _running.release()


def _quiet_moment() -> bool:
    hour = datetime.now().hour
    if not (hour >= 20 or hour < 6):
        return False
    if time.time() - _last_activity[0] < IDLE_MINUTES * 60:
        return False
    try:
        from . import desktop

        if desktop._fullscreen_app_in_front():  # a game or a movie: don't load her brain now
            return False
    except Exception:  # noqa: BLE001
        pass
    return True


def start(ollama_url) -> None:
    """Check every few minutes whether it's a good time for tonight's reflection. `ollama_url` is a function that
    gives the current address (it changes when her own engine takes over)."""
    def loop() -> None:
        while True:
            time.sleep(300)
            try:
                s = store.get_settings()
                if s.get("reflection_enabled", True) and s.get("auto_learn", True) and not _done_today() and _quiet_moment():
                    run(ollama_url())
            except Exception:  # noqa: BLE001  # never take Athena down over this
                pass
    threading.Thread(target=loop, daemon=True, name="athena-reflect").start()
