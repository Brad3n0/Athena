"""Tiny JSON-file persistence for settings, chats and tasks.

Everything lives in the ``data/`` folder next to the app so it stays on your PC.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("ATHENA_DATA", ROOT / "data"))
CHATS_DIR = DATA_DIR / "conversations"
SETTINGS_FILE = DATA_DIR / "settings.json"
TASKS_FILE = DATA_DIR / "tasks.json"

_lock = threading.RLock()
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

DEFAULT_SETTINGS: dict[str, Any] = {
    "user_name": "",
    "custom_instructions": "",
    # Default model per mode. Empty = let the UI pick the best installed one.
    "models": {"assistant": "", "code": "", "voice": ""},
    "tools_enabled": True,
    # Direct mode: no lecturing, moralizing or needless disclaimers
    "direct_mode": False,
    "theme": "dark",
    # Speech-to-text (runs locally with faster-whisper)
    "whisper_model": "base.en",
    "whisper_device": "cpu",
    # Text-to-speech (browser / Windows voices, work offline)
    "tts_voice": "",
    "tts_rate": 1.05,
    # "auto" uses Kokoro (natural offline voice) when installed, else the system voices
    "tts_engine": "auto",
    "kokoro_voice": "af_bella",
    "voice_pitch": 1.08,
    # "assistant" = helpful and professional, "companion" = playful anime-girl friend
    "persona": "assistant",
    # What appears in voice chat: "anime" (built-in 2D girl), "vrm" (your 3D model) or "orb"
    "avatar": "anime",
    "auto_speak": False,
}


def _ensure_dirs() -> None:
    CHATS_DIR.mkdir(parents=True, exist_ok=True)


def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write(path: Path, data: Any) -> None:
    _ensure_dirs()
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def valid_id(value: str) -> bool:
    return bool(_ID_RE.match(value or ""))


# ---------------------------------------------------------------- settings

def get_settings() -> dict[str, Any]:
    with _lock:
        saved = _read(SETTINGS_FILE, {})
    merged = {**DEFAULT_SETTINGS, **{k: v for k, v in saved.items() if k in DEFAULT_SETTINGS}}
    merged["models"] = {**DEFAULT_SETTINGS["models"], **(saved.get("models") or {})}
    return merged


def update_settings(patch: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        current = get_settings()
        for key, value in patch.items():
            if key not in DEFAULT_SETTINGS:
                continue
            if key == "models" and isinstance(value, dict):
                current["models"].update({k: str(v) for k, v in value.items() if k in current["models"]})
            else:
                current[key] = value
        _write(SETTINGS_FILE, current)
        return current


# ----------------------------------------------------------- conversations

def list_conversations() -> list[dict[str, Any]]:
    _ensure_dirs()
    items = []
    for path in CHATS_DIR.glob("*.json"):
        chat = _read(path, None)
        if not chat:
            continue
        items.append({k: chat.get(k) for k in ("id", "title", "mode", "model", "created", "updated")})
    items.sort(key=lambda c: c.get("updated") or 0, reverse=True)
    return items


def get_conversation(chat_id: str) -> dict[str, Any] | None:
    if not valid_id(chat_id):
        return None
    return _read(CHATS_DIR / f"{chat_id}.json", None)


def save_conversation(chat_id: str, chat: dict[str, Any]) -> dict[str, Any]:
    if not valid_id(chat_id):
        raise ValueError("bad id")
    with _lock:
        existing = get_conversation(chat_id) or {}
        now = time.time()
        chat = {
            **existing,
            **chat,
            "id": chat_id,
            "created": existing.get("created") or chat.get("created") or now,
            "updated": now,
        }
        _write(CHATS_DIR / f"{chat_id}.json", chat)
        return chat


def delete_conversation(chat_id: str) -> bool:
    if not valid_id(chat_id):
        return False
    try:
        (CHATS_DIR / f"{chat_id}.json").unlink()
        return True
    except FileNotFoundError:
        return False


# ------------------------------------------------------------------- tasks

def list_tasks() -> list[dict[str, Any]]:
    with _lock:
        return _read(TASKS_FILE, [])


def _save_tasks(tasks: list[dict[str, Any]]) -> None:
    _write(TASKS_FILE, tasks)


def add_task(title: str, due: str = "", priority: str = "normal", notes: str = "") -> dict[str, Any]:
    task = {
        "id": new_id()[:8],
        "title": title.strip()[:300],
        "due": (due or "").strip()[:80],
        "priority": priority if priority in ("low", "normal", "high") else "normal",
        "notes": (notes or "").strip()[:2000],
        "done": False,
        "created": time.time(),
        "completed": None,
    }
    with _lock:
        tasks = list_tasks()
        tasks.append(task)
        _save_tasks(tasks)
    return task


def update_task(task_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    with _lock:
        tasks = list_tasks()
        for task in tasks:
            if task["id"] == task_id:
                for key in ("title", "due", "priority", "notes", "done"):
                    if key in patch:
                        task[key] = patch[key]
                if "done" in patch:
                    task["completed"] = time.time() if patch["done"] else None
                _save_tasks(tasks)
                return task
    return None


def delete_task(task_id: str) -> dict[str, Any] | None:
    with _lock:
        tasks = list_tasks()
        for i, task in enumerate(tasks):
            if task["id"] == task_id:
                removed = tasks.pop(i)
                _save_tasks(tasks)
                return removed
    return None


def find_task(query: str) -> dict[str, Any] | None:
    """Find a task by id, exact title, or partial title (open tasks first)."""
    query = (query or "").strip().lower()
    if not query:
        return None
    tasks = sorted(list_tasks(), key=lambda t: t["done"])
    for task in tasks:
        if task["id"].lower() == query or task["title"].lower() == query:
            return task
    for task in tasks:
        if query in task["title"].lower() or task["title"].lower() in query:
            return task
    return None
