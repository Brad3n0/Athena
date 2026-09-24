"""Tools Athena can call while chatting (Ollama function calling).

Works with tool-capable models such as gpt-oss, qwen3, llama3.1 and mistral-small.
Models without tool support simply chat without them.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from . import files, store


@dataclass
class Tool:
    name: str
    group: str  # core | tasks | memory | files | web
    description: str
    params: dict[str, Any] = field(default_factory=dict)
    required: list[str] = field(default_factory=list)
    run: Callable[..., Any] | None = None  # sync; web tools are run by the server (async)
    approve: Callable[[dict[str, Any]], str | None] | None = None  # returns a summary if approval is needed

    def spec(self) -> dict[str, Any]:
        return {"type": "function", "function": {
            "name": self.name, "description": self.description,
            "parameters": {"type": "object", "properties": self.params, "required": self.required},
        }}


def S(desc: str, **extra) -> dict[str, Any]:
    return {"type": "string", "description": desc, **extra}


# ------------------------------------------------------------- core / tasks

def _now(_args):
    now = datetime.now()
    return {"datetime": now.strftime("%A, %B %d, %Y %I:%M %p"), "iso": now.isoformat(timespec="seconds")}


def _brief(task: dict[str, Any]) -> dict[str, Any]:
    return {k: task[k] for k in ("id", "title", "due", "priority", "done") if task.get(k) not in ("", None) or k == "done"}


def _add_task(a):
    title = str(a.get("title", "")).strip()
    if not title:
        return {"error": "title is required"}
    return {"added": _brief(store.add_task(title, str(a.get("due", "")), str(a.get("priority", "normal")), str(a.get("notes", ""))))}


def _list_tasks(a):
    tasks = [_brief(t) for t in store.list_tasks() if a.get("include_done") or not t["done"]]
    return {"tasks": tasks, "count": len(tasks)}


def _task_action(kind):
    def run(a):
        task = store.find_task(str(a.get("task", "")))
        if not task:
            return {"error": f"No task matching '{a.get('task', '')}'"}
        if kind == "complete":
            return {"completed": _brief(store.update_task(task["id"], {"done": True}))}
        store.delete_task(task["id"])
        return {"deleted": _brief(task)}
    return run


def _timer(a):
    minutes = float(a.get("minutes", 0))
    if minutes <= 0 or minutes > 24 * 60:
        return {"error": "minutes must be between 0 and 1440"}
    return {"timer_set": True, "seconds": round(minutes * 60), "label": str(a.get("label", "") or "Timer")}


# ------------------------------------------------------------------ memory

def _remember(a):
    text = str(a.get("fact", "")).strip()
    if not text:
        return {"error": "Nothing to remember"}
    return {"remembered": store.add_memory(text)["text"]}


def _forget(a):
    m = store.forget_memory(str(a.get("memory", "")))
    return {"forgot": m["text"]} if m else {"error": "No matching memory"}


# ------------------------------------------------------------ file approvals

def _approve_move(a):
    return f"Move {a.get('source')} → {a.get('destination')}"


def _approve_organize(a):
    base, plan = files.plan_organize(str(a.get("folder", "")), str(a.get("by", "type")))
    if not plan:
        return None  # nothing to do, no need to ask
    counts: dict[str, int] = {}
    for _, dest in plan:
        counts[dest.parent.name] = counts.get(dest.parent.name, 0) + 1
    detail = ", ".join(f"{n} → {k}" for k, n in sorted(counts.items(), key=lambda kv: -kv[1]))
    return f"Organize {len(plan)} files in {files.pretty(base)} by {a.get('by', 'type')}: {detail}"


RISKY_OPEN = files.CATEGORIES["Installers"] | {".bat", ".cmd", ".ps1", ".vbs", ".js", ".jar", ".scr", ".lnk", ".reg"}


def _approve_open(a):
    target = str(a.get("target", ""))
    return f"Open {target} (this runs a program)" if Path(target).suffix.lower() in RISKY_OPEN else None


def _open(a):
    return {"opened": files.open_on_screen(str(a.get("target", "")))}


TOOLS: list[Tool] = [
    Tool("get_current_datetime", "core", "Get the current local date, time and weekday.", run=_now),
    Tool("set_timer", "core", "Start a countdown timer / reminder that alerts the user in the Athena window.",
         {"minutes": {"type": "number", "description": "Length in minutes (can be fractional)"}, "label": S("What the timer is for")},
         ["minutes"], run=_timer),
    Tool("add_task", "tasks", "Add a task / to-do item to the user's task list.",
         {"title": S("Short description of the task"), "due": S("Optional due date/time, e.g. '2026-10-01' or 'Friday 5pm'"),
          "priority": S("low, normal or high", enum=["low", "normal", "high"]), "notes": S("Optional extra details")},
         ["title"], run=_add_task),
    Tool("list_tasks", "tasks", "List the user's tasks.", {"include_done": {"type": "boolean", "description": "Also include completed tasks"}}, run=_list_tasks),
    Tool("complete_task", "tasks", "Mark a task as done.", {"task": S("Task id or (part of) its title")}, ["task"], run=_task_action("complete")),
    Tool("delete_task", "tasks", "Remove a task from the list.", {"task": S("Task id or (part of) its title")}, ["task"], run=_task_action("delete")),

    Tool("remember", "memory", "Save a lasting fact about the user or their preferences to long-term memory "
         "(e.g. birthdays, names, likes, projects). Use when they share something worth remembering or ask you to remember.",
         {"fact": S("The fact, written as a short sentence")}, ["fact"], run=_remember),
    Tool("forget", "memory", "Delete something from long-term memory.", {"memory": S("Memory id or words from it")}, ["memory"], run=_forget),

    Tool("list_folder", "files", "List what's inside a folder. Call with no path to see which folders you may use.",
         {"path": S("Folder, e.g. 'Downloads' or 'Documents/Taxes'"), "show_hidden": {"type": "boolean"}}, run=lambda a: files.list_folder(**a)),
    Tool("find_files", "files", "Search the user's allowed folders for files by name, type or contents.",
         {"query": S("Part of the file name, or a pattern like '*.pdf'"), "folder": S("Only search inside this folder"),
          "kind": S("Type of file", enum=["images", "videos", "music", "documents", "spreadsheets", "presentations", "archives", "installers", "code"]),
          "contains": S("Text that must appear inside the file (text files only)")},
         run=lambda a: files.find_files(**a)),
    Tool("read_file", "files", "Read the text of a file (text, code, markdown, CSV; PDFs if supported).", {"path": S("File path")}, ["path"], run=lambda a: files.read_file(**a)),
    Tool("create_folder", "files", "Create a new folder.", {"path": S("New folder path, e.g. 'Documents/Recipes'")}, ["path"], run=lambda a: files.create_folder(**a)),
    Tool("move_file", "files", "Move or rename a file or folder. If destination is an existing folder, the file goes inside it.",
         {"source": S("File to move"), "destination": S("New folder or new full path/name")}, ["source", "destination"],
         run=lambda a: files.move_file(**a), approve=_approve_move),
    Tool("copy_file", "files", "Copy a file or folder.", {"source": S("File to copy"), "destination": S("Folder or new path")},
         ["source", "destination"], run=lambda a: files.copy_file(**a)),
    Tool("write_file", "files", "Create a text file (notes, code, lists) with the given content.",
         {"path": S("File path, e.g. 'Documents/shopping list.txt'"), "content": S("Full text of the file"),
          "overwrite": {"type": "boolean", "description": "Replace the file if it already exists"}},
         ["path", "content"], run=lambda a: files.write_file(**a),
         approve=lambda a: f"{'Overwrite' if a.get('overwrite') else 'Create'} {a.get('path')} ({len(str(a.get('content', '')))} characters)"),
    Tool("delete_file", "files", "Delete a file or folder (it goes to the Recycle Bin).", {"path": S("File or folder to delete")}, ["path"],
         run=lambda a: files.delete_file(**a), approve=lambda a: f"Delete {a.get('path')} (to the Recycle Bin)"),
    Tool("organize_folder", "files", "Tidy a messy folder by moving its loose files into subfolders by type "
         "(Images, Documents, Videos, Music, Archives, Installers, Code...) or by month.",
         {"folder": S("Folder to organize, e.g. 'Downloads'"), "by": S("How to group", enum=["type", "date"])}, ["folder"],
         run=lambda a: files.organize_folder(**a), approve=_approve_organize),
    Tool("undo_last_change", "files", "Undo the most recent file change Athena made (moves, organizing, new files).",
         run=lambda a: files.undo_last_change(), approve=lambda a: "Undo the last file change"),
    Tool("open_on_screen", "files", "Open a file, folder or web address on the user's screen (in its app, File Explorer or the browser).",
         {"target": S("File/folder path or https:// URL")}, ["target"], run=_open, approve=_approve_open),

    Tool("web_search", "web", "Search the internet for current information. Returns titles, links and snippets.",
         {"query": S("What to search for")}, ["query"]),
    Tool("read_webpage", "web", "Read the text of a web page (use after web_search to get details).", {"url": S("Page address")}, ["url"]),
]
BY_NAME = {t.name: t for t in TOOLS}


def enabled_tools(settings: dict[str, Any]) -> list[Tool]:
    groups = {"core"}
    if settings.get("tools_enabled"):
        groups.add("tasks")
    for key, group in (("memory_enabled", "memory"), ("files_enabled", "files"), ("web_enabled", "web")):
        if settings.get(key):
            groups.add(group)
    return [t for t in TOOLS if t.group in groups]


def approval_summary(name: str, args: dict[str, Any], settings: dict[str, Any]) -> str | None:
    tool = BY_NAME.get(name)
    if not tool or not tool.approve or not settings.get("confirm_changes", True):
        return None
    try:
        return tool.approve(args)
    except files.FileError:
        return None  # let the tool itself report the problem


def run_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    tool = BY_NAME.get(name)
    if not tool or not tool.run:
        return {"error": f"Unknown tool: {name}"}
    args = {k: v for k, v in args.items() if v is not None}
    try:
        return tool.run(args)
    except files.FileError as exc:
        return {"error": str(exc)}
    except TypeError as exc:
        return {"error": f"Bad arguments: {exc}"}
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
