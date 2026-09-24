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
MEMORY_FILE = DATA_DIR / "memories.json"
SAVED_FILE = DATA_DIR / "saved.json"

_lock = threading.RLock()
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

DEFAULT_SETTINGS: dict[str, Any] = {
    "user_name": "",
    "custom_instructions": "",
    # Default model per mode. Empty = let the UI pick the best installed one.
    "models": {"assistant": "", "code": "", "voice": "", "vision": "", "study": ""},
    "tools_enabled": True,
    # Abilities
    "memory_enabled": True,
    "files_enabled": True,
    "web_enabled": True,
    "confirm_changes": True,  # ask before moving/deleting/writing files
    "show_on_screen": True,  # open folders/pages on screen while Athena works
    "file_folders": [],  # empty = Desktop, Documents, Downloads, Pictures, Music, Videos
    "pc_enabled": True,  # open apps, volume, media keys, lock, clipboard
    "screen_enabled": True,  # "what's on my screen?"
    "code_enabled": True,  # run Python code (always asks first)
    "docs_enabled": True,  # search your documents
    "knowledge_folders": [],
    "embed_model": "nomic-embed-text",
    # Briefing / weather
    "briefing_time": "",  # e.g. "07:30"; empty = off
    "briefing_last": "",
    "home_location": "",
    "units": "imperial",
    # Integrations
    "image_api": "",  # Stable Diffusion WebUI / Forge, e.g. http://127.0.0.1:7860
    "ha_url": "",  # Home Assistant, e.g. http://homeassistant.local:8123
    "ha_token": "",
    # Custom personalities: [{"id","name","instructions","voice"}]
    "personas": [],
    # PIN lock
    "pin_hash": "",
    "pin_salt": "",
    "auto_lock_minutes": 0,
    # Desktop app
    "wake_enabled": False,
    "hotkey": "<ctrl>+<space>",
    "voice_hotkey": "<ctrl>+<shift>+<space>",
    # Direct mode: no lecturing, moralizing or needless disclaimers
    "direct_mode": False,
    "theme": "dark",
    "text_size": "normal",  # small | normal | large
    "compact": False,
    "sound_effects": False,
    "birthday": "",  # "MM-DD"
    "accent": "gold",  # gold, rose, silver, cyan, emerald, aurora, sunset, violet, sakura, ice, lime
    "voice_barge_in": True,  # interrupt Athena just by talking
    "voice_sleep": True,  # dim after a minute of silence in voice chat
    # Speech-to-text (runs locally with faster-whisper)
    "whisper_model": "base.en",
    "whisper_device": "cpu",
    # Text-to-speech (browser / Windows voices, work offline)
    "tts_voice": "",
    "tts_rate": 0.97,
    # "auto" uses Kokoro (natural offline voice) when installed, else the system voices
    "tts_engine": "auto",
    "kokoro_voice": "athena_silk",
    "voice_pitch": 0.95,
    # "assistant" = helpful and professional, "companion" = playful, warm friend
    "persona": "assistant",
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
        items.append({k: chat.get(k) for k in ("id", "title", "mode", "model", "created", "updated", "pinned", "icon")})
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


# ----------------------------------------------------------------- memory

def list_memories() -> list[dict[str, Any]]:
    with _lock:
        return _read(MEMORY_FILE, [])


def add_memory(text: str) -> dict[str, Any]:
    text = text.strip()[:500]
    with _lock:
        memories = list_memories()
        for m in memories:
            if m["text"].lower() == text.lower():
                return m
        memory = {"id": new_id()[:8], "text": text, "created": time.time()}
        memories.append(memory)
        _write(MEMORY_FILE, memories[-200:])
    return memory


def forget_memory(query: str) -> dict[str, Any] | None:
    query = (query or "").strip().lower()
    if not query:
        return None
    with _lock:
        memories = list_memories()
        match = next((m for m in memories if m["id"] == query), None) or \
            next((m for m in memories if query in m["text"].lower()), None)
        if match:
            memories.remove(match)
            _write(MEMORY_FILE, memories)
        return match


# ------------------------------------------------------------ saved replies

def list_saved() -> list[dict[str, Any]]:
    with _lock:
        return _read(SAVED_FILE, [])


def add_saved(item: dict[str, Any]) -> dict[str, Any]:
    entry = {
        "id": new_id()[:10],
        "chat_id": str(item.get("chat_id") or ""),
        "chat_title": str(item.get("chat_title") or "")[:120],
        "content": str(item.get("content") or "")[:50000],
        "model": str(item.get("model") or ""),
        "time": time.time(),
    }
    with _lock:
        items = list_saved()
        items.append(entry)
        _write(SAVED_FILE, items[-500:])
    return entry


def delete_saved(item_id: str) -> bool:
    with _lock:
        items = list_saved()
        kept = [i for i in items if i["id"] != item_id]
        _write(SAVED_FILE, kept)
        return len(kept) != len(items)
