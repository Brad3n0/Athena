"""Routines: one phrase runs several steps. "I'm gaming" opens Discord and Steam and sets the volume;
"goodnight" closes everything and locks the PC.

Each step is one of Athena's abilities with its settings, e.g. {"do": "open_app", "name": "Steam"}.
"""
from __future__ import annotations

import re
from typing import Any

from . import store

ROUTINES_FILE = store.DATA_DIR / "routines.json"

# What a step can do -> the tool it runs (and a friendly label for the Settings editor)
STEP_TYPES = {
    "open_app": ("open_app", "Open an app"),
    "close_app": ("window_control", "Close an app"),
    "window": ("window_control", "Window (focus / minimize / maximize / move)"),
    "minimize_all": ("window_control", "Minimize everything"),
    "volume": ("set_volume", "Set the volume"),
    "media": ("media_control", "Music: play/pause, next, previous"),
    "open_website": ("open_on_screen", "Open a website"),
    "message": ("send_message", "Send a message"),
    "say": ("say", "Say something"),
    "wait": ("wait", "Wait a few seconds"),
    "type": ("type_text", "Type text"),
    "keys": ("press_keys", "Press keys"),
    "timer": ("set_timer", "Start a timer"),
    "home": ("control_home_device", "Smart home"),
    "lock": ("lock_computer", "Lock the PC"),
    "sleep": ("power", "Put the PC to sleep"),
    "shutdown": ("power", "Shut down the PC"),
}


def list_routines() -> list[dict[str, Any]]:
    return store._read(ROUTINES_FILE, [])


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s']", " ", (text or "").lower())).strip()


def clean_steps(steps: Any) -> list[dict[str, Any]]:
    out = []
    for s in steps or []:
        if not isinstance(s, dict):
            continue
        kind = str(s.get("do") or s.get("type") or "").strip().lower()
        if kind not in STEP_TYPES:
            raise ValueError(f"Unknown routine step '{kind}'. Use: {', '.join(STEP_TYPES)}")
        out.append({"do": kind, **{k: v for k, v in s.items() if k not in ("do", "type") and v not in (None, "")}})
    if not out:
        raise ValueError("A routine needs at least one step")
    return out[:30]


def save_routine(data: dict[str, Any], routine_id: str | None = None) -> dict[str, Any]:
    name = str(data.get("name", "")).strip()[:60]
    if not name:
        raise ValueError("Give the routine a name")
    phrases = [p for p in (_norm(x) for x in (data.get("phrases") or [name])) if p][:8] or [_norm(name)]
    routine = {"name": name, "phrases": phrases, "steps": clean_steps(data.get("steps")), "icon": str(data.get("icon") or "⚡")[:4]}
    items = list_routines()
    existing = next((r for r in items if r["id"] == routine_id), None) or next((r for r in items if r["name"].lower() == name.lower()), None)
    if existing:
        existing.update(routine)
        routine = existing
    else:
        routine = {"id": store.new_id()[:10], **routine}
        items.append(routine)
    store._write(ROUTINES_FILE, items)
    return routine


def delete_routine(key: str) -> bool:
    items = list_routines()
    kept = [r for r in items if r["id"] != key and r["name"].lower() != (key or "").lower()]
    store._write(ROUTINES_FILE, kept)
    return len(kept) != len(items)


def find(name: str) -> dict[str, Any] | None:
    key = _norm(name)
    for r in list_routines():
        if key in (_norm(r["name"]), *r["phrases"]):
            return r
    return None


def match_phrase(message: str) -> dict[str, Any] | None:
    """Is this whole message one of your routine phrases? ("Hey Athena, goodnight!" -> the goodnight routine)"""
    text = _norm(message)
    text = re.sub(r"^(hey |ok |okay )?athena\s*", "", text)
    text = re.sub(r"^(please |can you |start |run |do |activate )", "", text)
    text = re.sub(r"\s*(please|mode on|now)$", "", text).strip()
    if not text or len(text) > 60:
        return None
    for r in list_routines():
        names = {_norm(r["name"]), *r["phrases"]}
        if text in names or f"{text} mode" in names or text.removesuffix(" mode") in names or text.removesuffix(" routine") in names:
            return r
    return None


def step_call(step: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Turn a routine step into the tool name and arguments that run it."""
    kind = step["do"]
    tool = STEP_TYPES[kind][0]
    args = {k: v for k, v in step.items() if k != "do"}
    if kind == "close_app":
        args = {"action": "close", "app": step.get("app") or step.get("name", "")}
    elif kind == "minimize_all":
        args = {"action": "minimize_all"}
    elif kind == "window":
        args = {"action": step.get("action", "focus"), "app": step.get("app", ""), **({"monitor": step["monitor"]} if step.get("monitor") else {})}
    elif kind == "volume":
        args = {"level": float(step.get("level", 50))}
    elif kind == "open_website":
        args = {"target": step.get("url") or step.get("target", "")}
    elif kind == "sleep":
        args = {"action": "sleep"}
    elif kind == "shutdown":
        args = {"action": "shutdown", **({"minutes": step["minutes"]} if step.get("minutes") else {})}
    return tool, args


def describe_step(step: dict[str, Any]) -> str:
    kind = step["do"]
    detail = {
        "open_app": step.get("name"), "close_app": step.get("app") or step.get("name"),
        "window": f"{step.get('action', 'focus')} {step.get('app', '')}" + (f" → monitor {step['monitor']}" if step.get("monitor") else ""),
        "volume": f"{step.get('level', 50)}%", "media": step.get("action"), "open_website": step.get("url") or step.get("target"),
        "message": f"{step.get('app', 'discord')} → {step.get('to')}: {step.get('text')}", "say": step.get("text"),
        "wait": f"{step.get('seconds', 2)}s", "type": step.get("text"), "keys": step.get("keys"),
        "timer": f"{step.get('minutes', '')} min {step.get('label', '')}".strip(), "home": f"{step.get('device')} {step.get('action')}",
        "shutdown": f"in {step['minutes']} min" if step.get("minutes") else "",
    }.get(kind)
    return f"{STEP_TYPES[kind][1]}{f': {detail}' if detail else ''}"
