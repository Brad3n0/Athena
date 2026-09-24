"""Tools Athena can call while chatting (Ollama function calling).

Works with tool-capable models such as gpt-oss, qwen3, llama3.1 and mistral-small.
Models without tool support simply chat without them.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from . import store


def _fn(name: str, description: str, properties: dict[str, Any] | None = None, required: list[str] | None = None):
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties or {}, "required": required or []},
        },
    }


TOOLS = [
    _fn("get_current_datetime", "Get the current local date, time and weekday."),
    _fn(
        "add_task",
        "Add a task / to-do item to the user's task list.",
        {
            "title": {"type": "string", "description": "Short description of the task"},
            "due": {"type": "string", "description": "Optional due date/time, e.g. '2026-10-01' or 'Friday 5pm'"},
            "priority": {"type": "string", "enum": ["low", "normal", "high"]},
            "notes": {"type": "string", "description": "Optional extra details"},
        },
        ["title"],
    ),
    _fn(
        "list_tasks",
        "List the user's tasks. Use this before completing or deleting a task if unsure which one is meant.",
        {"include_done": {"type": "boolean", "description": "Also include completed tasks"}},
    ),
    _fn(
        "complete_task",
        "Mark a task as done.",
        {"task": {"type": "string", "description": "Task id or (part of) its title"}},
        ["task"],
    ),
    _fn(
        "delete_task",
        "Permanently remove a task from the list.",
        {"task": {"type": "string", "description": "Task id or (part of) its title"}},
        ["task"],
    ),
    _fn(
        "set_timer",
        "Start a countdown timer / reminder that alerts the user in the Athena window.",
        {
            "minutes": {"type": "number", "description": "Length of the timer in minutes (can be fractional)"},
            "label": {"type": "string", "description": "What the timer is for"},
        },
        ["minutes"],
    ),
]


def _brief(task: dict[str, Any]) -> dict[str, Any]:
    return {k: task[k] for k in ("id", "title", "due", "priority", "done") if task.get(k) not in ("", None) or k == "done"}


def run_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    try:
        if name == "get_current_datetime":
            now = datetime.now()
            return {"datetime": now.strftime("%A, %B %d, %Y %I:%M %p"), "iso": now.isoformat(timespec="seconds")}

        if name == "add_task":
            title = str(args.get("title", "")).strip()
            if not title:
                return {"error": "title is required"}
            task = store.add_task(title, str(args.get("due", "")), str(args.get("priority", "normal")), str(args.get("notes", "")))
            return {"added": _brief(task)}

        if name == "list_tasks":
            include_done = bool(args.get("include_done"))
            tasks = [_brief(t) for t in store.list_tasks() if include_done or not t["done"]]
            return {"tasks": tasks, "count": len(tasks)}

        if name in ("complete_task", "delete_task"):
            task = store.find_task(str(args.get("task", "")))
            if not task:
                return {"error": f"No task matching '{args.get('task', '')}'"}
            if name == "complete_task":
                return {"completed": _brief(store.update_task(task["id"], {"done": True}))}
            store.delete_task(task["id"])
            return {"deleted": _brief(task)}

        if name == "set_timer":
            minutes = float(args.get("minutes", 0))
            if minutes <= 0 or minutes > 24 * 60:
                return {"error": "minutes must be between 0 and 1440"}
            return {"timer_set": True, "seconds": round(minutes * 60), "label": str(args.get("label", "") or "Timer")}

        return {"error": f"Unknown tool: {name}"}
    except Exception as exc:  # never let a tool crash the chat
        return {"error": str(exc)}


def parse_args(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            value = json.loads(raw)
            return value if isinstance(value, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}
