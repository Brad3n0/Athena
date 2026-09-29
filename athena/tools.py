"""Tools Athena can call while chatting (Ollama function calling).

Works with tool-capable models such as gpt-oss, qwen3, llama3.1 and mistral-small.
Models without tool support simply chat without them.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from . import files, knowledge, pc, scheduler, store


@dataclass
class Tool:
    name: str
    group: str  # core | tasks | memory | files | web
    description: str
    params: dict[str, Any] = field(default_factory=dict)
    required: list[str] = field(default_factory=list)
    run: Callable[..., Any] | None = None  # sync, runs in a worker thread
    arun: Callable[..., Any] | None = None  # async (args, ctx) for network tools; ctx has client/ollama/settings
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
    label = str(a.get("label", "") or "Timer")
    item = scheduler.add(label, scheduler.parse_when(minutes=minutes), kind="timer")
    return {"timer_set": True, "seconds": round(minutes * 60), "label": label, "id": item["id"]}


def _focus(a):
    minutes = float(a.get("minutes") or 25)
    if minutes <= 0 or minutes > 240:
        return {"error": "minutes must be between 1 and 240"}
    return {"focus_started": True, "minutes": minutes, "task": str(a.get("task", "") or ""),
            "break_minutes": float(a.get("break_minutes") or 5)}


def _decks():
    from . import decks
    items = decks.list_decks()
    st = decks.streak()
    return {"decks": [{"name": d["name"], "cards": d["total"], "due_today": d["due"]} for d in items], "total_due": decks.total_due(),
            "study_streak_days": st["days"], "studied_today": st["today"]}


def _reminder(a):
    try:
        when = scheduler.parse_when(str(a.get("at", "")), a.get("minutes_from_now"))
        item = scheduler.add(str(a.get("text", "")), when)
    except ValueError as exc:
        return {"error": str(exc)}
    return {"reminder_set": scheduler.describe(item)}


def _list_reminders(_a):
    items = [scheduler.describe(r) for r in scheduler.pending()]
    return {"reminders": items, "count": len(items)}


def _cancel_reminder(a):
    r = scheduler.cancel(str(a.get("reminder", "")))
    return {"cancelled": scheduler.describe(r)} if r else {"error": "No matching reminder"}


# ------------------------------------------------------------- async tools

async def _web_search(a, ctx):
    from . import web
    return await web.search(ctx["client"], str(a.get("query", "")))


async def _read_webpage(a, ctx):
    from . import web
    return await web.read_page(ctx["client"], str(a.get("url", "")))


async def _weather(a, ctx):
    from . import weather
    loc = str(a.get("location") or ctx["settings"].get("home_location") or "")
    return await weather.get_weather(ctx["client"], loc, ctx["settings"].get("units", "imperial"))


async def _edit_image(a, ctx):
    from starlette.concurrency import run_in_threadpool

    from . import photos
    source = str(a.get("image") or "").strip()
    if not source:
        history = ctx.get("history") or []
        attached = [img for m in history if m.get("role") == "user" for img in (m.get("images") or [])]
        latest_has_photo = bool(history and history[-1].get("images"))
        made = photos.last_output.get("path")
        if latest_has_photo:
            source = history[-1]["images"][-1]
        elif made and made.exists() and time.time() - photos.last_output["time"] < 3 * 3600:
            source = str(made)  # "now make it brighter": keep editing the last result
        elif attached:
            source = attached[-1]
    steps = a.get("steps")
    if isinstance(steps, str):
        try:
            steps = json.loads(steps)
        except ValueError:
            steps = [{"op": steps}]
    if isinstance(steps, dict):
        steps = [steps]
    try:
        return await run_in_threadpool(photos.edit, source, steps or [])
    except photos.PhotoError as exc:
        return {"error": str(exc)}


async def _generate_image(a, ctx):
    from . import imagegen
    try:
        w, h = int(a.get("width") or 1024), int(a.get("height") or 1024)
    except (TypeError, ValueError):
        w = h = 1024
    return await imagegen.generate(ctx["client"], str(a.get("prompt", "")), str(a.get("negative", "")), w, h, ctx.get("ollama", ""))


def _sports(fn):
    """Run a sports lookup; turn its problems into a plain message for the model."""
    async def run(a, ctx):
        from . import sports
        try:
            return await fn(sports, a, ctx["client"])
        except sports.SportsError as exc:
            return {"error": str(exc)}
    return run


def _int(v: Any) -> int | None:
    try:
        return int(str(v)[:4]) if v not in (None, "") else None
    except ValueError:
        return None


_sports_games = _sports(lambda sp, a, c: sp.games(c, str(a.get("league", "")), str(a.get("date", "")), str(a.get("team", ""))))
_sports_team = _sports(lambda sp, a, c: sp.team_report(c, str(a.get("team", "")), str(a.get("league", "")),
                                                       str(a.get("opponent", "")), _int(a.get("season"))))
_sports_player = _sports(lambda sp, a, c: sp.player_report(c, str(a.get("player", "")), str(a.get("league", "")),
                                                           str(a.get("stat", "")), a.get("line"), str(a.get("opponent", "")),
                                                           _int(a.get("season")), str(a.get("pick", ""))))
_sports_standings = _sports(lambda sp, a, c: sp.standings(c, str(a.get("league", "")), _int(a.get("season"))))
_kalshi = _sports(lambda sp, a, c: sp.kalshi(c, str(a.get("query", ""))))


async def _ha_list(a, ctx):
    from . import integrations
    return await integrations.list_devices(ctx["client"], str(a.get("query", "")))


async def _ha_control(a, ctx):
    from . import integrations
    return await integrations.control_device(ctx["client"], str(a.get("device", "")), str(a.get("action", "")), a.get("value"))


async def _look(a, ctx):
    return await ctx["look_at_screen"](str(a.get("question", "")))


def _search_docs(a):
    from .server import OLLAMA
    try:
        return knowledge.search(OLLAMA, str(a.get("query", "")), int(a.get("count") or 6))
    except knowledge.KnowledgeError as exc:
        return {"error": str(exc)}


# ------------------------------------------------------------------ memory

def _search_chats(a):
    found = store.search_messages(str(a.get("query", "")), limit=8)
    return {"results": [{"chat": r["title"], "date": datetime.fromtimestamp(r["updated"] or 0).strftime("%Y-%m-%d"),
                         "matches": [f'{h["role"]}: {h["snippet"]}' for h in r["hits"]]} for r in found]} if found else {"results": [], "message": "No past chats matched."}


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


def _approve_code(a):
    code = str(a.get("code", "")).strip()
    first = "\n".join(code.splitlines()[:12])
    more = "\n…" if len(code.splitlines()) > 12 else ""
    return f"Run this Python code on your PC:\n{first}{more}"


def _approve_home(a):
    action = str(a.get("action", "")).lower()
    if action in ("unlock", "open"):
        return f"{action.title()} {a.get('device')}"
    return None


def _pc(fn):
    def run(a):
        try:
            return fn(**a)
        except pc.PCError as exc:
            return {"error": str(exc)}
    return run


def _find_installed(a):
    """Find where a game/app is installed and open that folder. If it isn't an installed game or app, look
    through the user's files and folders instead, and open File Explorer right at the best match."""
    from . import locate
    name = str(a.get("name", ""))
    out = locate.find_installed(name)
    want_open = a.get("open", True) is not False  # opening it is the point, unless asked not to
    best = out.get("best")
    if best and best.get("exists"):
        if want_open:
            try:
                locate.open_folder(best["folder"])
                out["opened"] = best["folder"]
            except OSError as exc:
                out["open_error"] = str(exc)
        return out
    try:  # not installed software: search the user's own folders
        found = files.find_files(query=name, limit=8)
    except files.FileError:
        found = {"results": []}
    hits = found.get("results") or []
    if hits:
        hits.sort(key=lambda h: (h.get("type") != "folder", len(h["path"])))  # folders and short paths first
        out = {"results": hits[:6], "best": {"name": hits[0]["path"].rsplit("/", 1)[-1], "folder": hits[0]["path"], "found_with": "your files"}}
        if want_open:
            try:
                real = str(files.resolve(hits[0]["path"]))
                locate.reveal(real)
                out["opened"] = real
            except (files.FileError, OSError) as exc:
                out["open_error"] = str(exc)
    return out


TOOLS: list[Tool] = [
    Tool("get_current_datetime", "core", "Get the current local date, time and weekday.", run=_now),
    Tool("set_timer", "core", "Start a countdown timer / reminder that alerts the user in the Athena window.",
         {"minutes": {"type": "number", "description": "Length in minutes (can be fractional)"}, "label": S("What the timer is for")},
         ["minutes"], run=_timer),
    Tool("start_focus", "core", "Start a focus / Pomodoro session: a countdown shown on screen, then a break reminder.",
         {"minutes": {"type": "number", "description": "Focus length (default 25)"}, "task": S("What they're focusing on"),
          "break_minutes": {"type": "number", "description": "Break length afterwards (default 5)"}}, run=_focus),
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
    Tool("search_chats", "memory", "Search the user's past conversations with you by words (e.g. when they ask 'what did we say about X' "
         "or refer to an earlier chat). Returns matching chats with snippets.",
         {"query": S("Words to look for")}, ["query"], run=lambda a: _search_chats(a)),
    Tool("forget", "memory", "Delete something from long-term memory.", {"memory": S("Memory id or words from it")}, ["memory"], run=_forget),

    Tool("list_folder", "files", "List what's inside a folder. Call with no path to see which folders you may use.",
         {"path": S("Folder, e.g. 'Downloads' or 'Documents/Taxes'"), "show_hidden": {"type": "boolean"}}, run=lambda a: files.list_folder(**a)),
    Tool("find_installed", "files", "Find a game's, app's or file's location on this PC AND open it in File Explorer (Steam, Epic, "
         "Xbox/Game Pass, installed programs, game folders on every drive, then the user's own files and folders). Use for "
         "'find my game X', 'where is X installed', 'open the folder X is in', 'take me to X'. Loose names work.",
         {"name": S("The game, app, file or folder, as the user said it (e.g. 'crimson desert')"),
          "open": {"type": "boolean", "description": "Open it in File Explorer (default true; false only if they just asked where it is)"}},
         ["name"], run=_find_installed),
    Tool("find_files", "files", "List files AND folders in the user's allowed folders by name, type or contents (loose names "
         "work). It only lists them: when the user wants to find something and go to it / open it / see where it is, use "
         "find_installed instead, which also searches their files and opens File Explorer right at it.",
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

    Tool("set_reminder", "tasks", "Remind the user at a specific time (pops up and speaks). Work out the exact date/time "
         "from the current time, or use minutes_from_now.",
         {"text": S("What to remind them about"), "at": S("Local date/time in ISO format, e.g. 2026-10-01T18:00"),
          "minutes_from_now": {"type": "number", "description": "Alternative to 'at'"}}, ["text"], run=_reminder),
    Tool("flashcard_decks", "tasks", "List the user's saved flashcard decks and how many cards are due for review today. "
         "Tell them they can review with the Decks button or by typing /review.", run=lambda a: _decks()),
    Tool("list_reminders", "tasks", "List upcoming reminders and timers.", run=_list_reminders),
    Tool("cancel_reminder", "tasks", "Cancel a reminder or timer.", {"reminder": S("Reminder id or words from it")}, ["reminder"], run=_cancel_reminder),

    Tool("web_search", "web", "Search the internet for current information. Returns titles, links and snippets.",
         {"query": S("What to search for")}, ["query"], arun=_web_search),
    Tool("read_webpage", "web", "Read the text of a web page (use after web_search to get details).", {"url": S("Page address")}, ["url"], arun=_read_webpage),
    Tool("get_weather", "web", "Current weather and 3-day forecast. Leave location empty for the user's home city.",
         {"location": S("City, e.g. 'Chicago' or 'Springfield, IL'")}, arun=_weather),

    Tool("open_app", "pc", "Open an app installed on the PC (e.g. Spotify, Chrome, Notepad, Calculator, Steam, Discord). "
         "For websites like YouTube use open_website.",
         {"name": S("App name")}, ["name"], run=_pc(pc.open_app)),
    Tool("open_website", "pc", "Open a website in the browser: by name (YouTube, Netflix, Google, Gmail, Twitch, Reddit, "
         "Amazon, Roblox...) or address, optionally searching it ('play lofi on YouTube' → site 'youtube', search 'lofi'). "
         "After opening search results, use click_on_screen to pick a video or result if the user wants one played.",
         {"site": S("Site name or address"), "search": S("What to search for on it (optional)")}, ["site"],
         run=_pc(pc.open_website)),
    Tool("media_control", "pc", "Control music/video playback on the PC.",
         {"action": S("play_pause, next, previous or stop", enum=["play_pause", "next", "previous", "stop"])}, ["action"], run=_pc(pc.media)),
    Tool("set_volume", "pc", "Change the PC's volume: set a level, change it up/down, or toggle mute.",
         {"level": {"type": "number", "description": "0-100"}, "change": {"type": "number", "description": "e.g. 10 or -20"},
          "mute": {"type": "boolean", "description": "true to toggle mute"}}, run=_pc(pc.volume)),
    Tool("lock_computer", "pc", "Lock the PC (Windows lock screen).", run=_pc(lambda: pc.lock())),
    Tool("power", "pc", "Shut down, restart or sleep the PC, optionally after some minutes; or cancel a scheduled shutdown.",
         {"action": S("shutdown, restart, sleep or cancel", enum=["shutdown", "restart", "sleep", "cancel"]),
          "minutes": {"type": "number", "description": "Delay in minutes (shutdown/restart)"}}, ["action"], run=_pc(pc.power),
         approve=lambda a: None if a.get("action") == "cancel" else f"{str(a.get('action', '')).title()} the PC" + (f" in {a.get('minutes')} minutes" if a.get("minutes") else " now")),
    Tool("get_clipboard", "pc", "Read the text the user last copied (their clipboard).", run=_pc(lambda: pc.get_clipboard())),
    Tool("set_clipboard", "pc", "Put text on the user's clipboard so they can paste it.", {"text": S("Text to copy")}, ["text"], run=_pc(pc.set_clipboard)),

    Tool("look_at_screen", "screen", "Take a screenshot of the user's screen and look at it. Use when they ask about "
         "what's on their screen, an error they're seeing, a window, a game, a page, etc.",
         {"question": S("What to look for or answer about the screen")}, arun=_look),
    Tool("run_python", "code", "Run Python code on the user's PC and get its output (for calculations, data work, testing code). "
         "Print results. Runs in a temporary folder with a 30 second limit.", {"code": S("Complete Python script")}, ["code"],
         run=_pc(pc.run_python), approve=_approve_code),
    Tool("search_documents", "docs", "Search the user's own documents (notes, PDFs, Word files in their Knowledge folders) by meaning. "
         "Use it for questions about their files, schoolwork, work docs, manuals, leases, etc. Cite the file names.",
         {"query": S("What to look for"), "count": {"type": "integer", "description": "How many passages (default 6)"}}, ["query"], run=_search_docs),

    Tool("edit_image", "pc", "Edit a photo: the one the user just attached, or the last picture Athena made or edited "
         "(or a file path). Steps run in order, e.g. [{\"op\":\"crop\",\"aspect\":\"1:1\"},{\"op\":\"brightness\",\"amount\":1.2}]. "
         "ops: crop (aspect like 1:1, 16:9, 9:16, 4:5; or box), resize (width/height/scale), rotate (amount = degrees), "
         "flip (direction horizontal/vertical), brightness/contrast/saturation/sharpness (amount: 1 = same, 1.3 = more, 0.7 = less), "
         "blur (amount = radius), grayscale, sepia, invert, warm, cool, enhance, vignette, text (text, position top/center/bottom, "
         "color, size), border, remove_background, format (format png/jpg/webp, quality). The result is shown to the user.",
         {"steps": {"type": "array", "items": {"type": "object"}, "description": "Edit steps in order"},
          "image": S("A file path, only if the user named a file on the PC (optional)")},
         ["steps"], arun=_edit_image),
    Tool("generate_image", "images", "Create a picture from a description, on this PC (ComfyUI, Stable Diffusion or an Ollama "
         "image model). Write a detailed visual prompt in English: subject, setting, style, lighting, camera. Use width/height "
         "for shape (e.g. 1344x768 wide, 768x1344 tall). The picture is shown to the user; don't describe it back in detail.",
         {"prompt": S("Detailed description of the image"), "negative": S("Things to avoid"),
          "width": {"type": "integer"}, "height": {"type": "integer"}}, ["prompt"], arun=_generate_image),
    Tool("list_home_devices", "home", "List smart home devices (lights, switches, thermostats, locks...) and their state.",
         {"query": S("Optional filter, e.g. 'kitchen' or 'light'")}, arun=_ha_list),
    Tool("control_home_device", "home", "Control a smart home device.",
         {"device": S("Device name or entity id"), "action": S("on, off, toggle, brightness, temperature, volume, open, close, lock, unlock, activate, play, pause, start, stop, return_home"),
          "value": {"type": "number", "description": "Brightness %, temperature or volume % when needed"}}, ["device", "action"],
         arun=_ha_control, approve=_approve_home),
]

# ------------------------------------------------------------------ Jarvis: control the PC, message people, routines

def _ctl(fn):
    def run(a):
        from . import automation, messaging
        try:
            return fn(**a)
        except (automation.ControlError, messaging.MessageError, ValueError) as exc:
            return {"error": str(exc)}
    return run


def _pc_status(a):
    from . import pcstatus
    return pcstatus.status()


def _window(action="", app="", monitor=None):
    from . import automation
    return automation.window_control(action, app, monitor)


def _type(text="", app="", newline="shift+enter"):
    from . import automation
    if app:
        automation.focus_app(app, wait=5)
    return automation.type_text(text, newline or "shift+enter")


def _keys(keys="", app="", times=1):
    from . import automation
    if app:
        automation.focus_app(app, wait=5)
    return automation.press_keys(keys, times)


def _safe(fn):
    """Approval summaries must never crash the chat; if the arguments are bad, the tool itself reports it."""
    def run(a):
        try:
            return fn(a)
        except Exception:
            return None
    return run


def _approve_message(a):
    from . import messaging
    return messaging.describe(messaging.plan(str(a.get("app") or "discord"), str(a.get("to", "")), str(a.get("text", "")), str(a.get("subject") or "")))


async def _send_message(a, ctx):
    from starlette.concurrency import run_in_threadpool

    from . import automation, messaging
    try:
        p = messaging.plan(str(a.get("app") or "discord"), str(a.get("to", "")), str(a.get("text", "")), str(a.get("subject") or ""))
        if p["app"] in ("sms", "email"):
            return await run_in_threadpool(messaging.open_draft, p)
        if p["app"] in ("screen", *messaging.CHAT_LINKS):
            return await _send_on_screen(p, ctx)
        if p["app"] == "discord":
            await run_in_threadpool(messaging.discord_open_chat, p["target"])
            ready = False
        else:
            ready = await run_in_threadpool(messaging.whatsapp_open_chat, p["target"], p["to"], p["text"])
        if not ready:
            # Before typing anything, check the right chat opened (needs a vision model; skipped without one).
            ok, seen = await ctx["verify_chat"](" / ".join(p["aliases"]) or p["to"], "Discord" if p["app"] == "discord" else "WhatsApp")
            if ok is False:
                await run_in_threadpool(automation.press_keys, "esc")
                saw = f" The chat that opened was “{seen}”." if seen else ""
                return {"error": f"I couldn't find a chat with {p['to']}, so I didn't send anything.{saw} If that's them, "
                                 f"add “{seen or p['to']}” as their nickname in Settings → Jarvis → Contacts; otherwise try their exact "
                                 f"{'Discord username' if p['app'] == 'discord' else 'WhatsApp name'}."}
            await run_in_threadpool(messaging.type_and_send, p["text"])
        else:
            await run_in_threadpool(automation.press_keys, "enter")
        return {"sent": True, "app": p["app"], "to": p["to"], "text": p["text"], "checked_chat": ready or ok is True}
    except (messaging.MessageError, automation.ControlError) as exc:
        return {"error": str(exc)}


async def _click_spot(ctx, what: str) -> dict:
    from starlette.concurrency import run_in_threadpool

    from . import automation
    spot = await ctx["locate_on_screen"](what)
    if not spot.get("error"):
        await run_in_threadpool(automation.click, spot["x"], spot["y"])
    return spot


async def _send_on_screen(p, ctx):
    """Instagram, Messenger, Telegram (opened from a link) and any other app or site: find the chat on screen,
    check it's the right one, then type the message. Uses the vision model to see the screen."""
    import asyncio

    from starlette.concurrency import run_in_threadpool

    from . import automation, messaging
    app, who, target = p["label"], p["to"], p["target"]
    if p["app"] in messaging.CHAT_LINKS:
        await run_in_threadpool(messaging.open_link_chat, p)
    else:
        await run_in_threadpool(messaging.open_any_app, app)
        # Search for the person, like you would: the search box (or "new message"), their name, then their chat.
        spot = await _click_spot(ctx, f"the search box, or the button to search people or start a new message, in {app}")
        if spot.get("error"):
            return {"error": f"I opened {app} but couldn't find where to search for {who}. {spot['error']}"}
        await asyncio.sleep(1)
        await run_in_threadpool(automation.type_text, target)
        await asyncio.sleep(2.5)
        spot = await _click_spot(ctx, f"the search result, person, group or conversation named '{target}'")
        if spot.get("error"):
            await run_in_threadpool(automation.press_keys, "esc")
            return {"error": f"I searched {app} for {target} but couldn't see them in the results, so I didn't send anything."}
        await asyncio.sleep(2.5)
    # Never type into the wrong chat: check the open conversation is with the right person first.
    ok, seen = await ctx["verify_chat"](" / ".join(p.get("aliases") or [target]), app)
    if ok is False:
        saw = f" (it was “{seen}”)" if seen else ""
        return {"error": f"The chat that opened in {app} doesn't look like {who}'s{saw}, so I didn't send anything. "
                         f"Try their exact username, or save it as a nickname in Settings → Jarvis → Contacts."}
    spot = await _click_spot(ctx, f"the text box for typing a message in the open {app} conversation")
    if spot.get("error"):
        return {"error": f"I opened the chat with {who} but couldn't find the message box, so I didn't send anything."}
    await asyncio.sleep(0.4)
    await run_in_threadpool(messaging.type_and_send, p["text"])
    return {"sent": True, "app": app, "to": who, "text": p["text"], "checked_chat": ok is True}


def _words_to_find(a) -> str:
    """The words on the thing to click: the 'text' argument, or quoted words in the description
    ("the video that says 'cat compilation'"), or what follows 'says' / 'called' / 'named' / 'titled'."""
    text = str(a.get("text") or "").strip()
    if text:
        return text
    target = str(a.get("target") or "")
    m = re.search(r"[\"“'‘]([^\"”'’]{2,})[\"”'’]", target) or \
        re.search(r"\b(?:says?|saying|called|named|titled|labell?ed)\s+(.+)$", target, re.I)
    return m.group(1).strip(" .") if m else ""


async def _click(a, ctx):
    from starlette.concurrency import run_in_threadpool

    from . import automation
    target = str(a.get("target", "")).strip()
    words = _words_to_find(a)
    if not target and not words:
        return {"error": "What should I click?"}
    button, double = str(a.get("button") or "left"), bool(a.get("double"))
    if a.get("wait"):  # e.g. give a page that's just opening a few seconds to load
        import asyncio

        await asyncio.sleep(min(10.0, max(0.0, float(a.get("wait") or 0))))
    try:
        # 1) By its words, straight from Windows (exact, and scrolls down the page to it if needed)
        if words:
            hit = await run_in_threadpool(automation.find_by_text, words)
            if hit:
                done = await run_in_threadpool(automation.click, hit["x"], hit["y"], button, double)
                return {**done, "target": target or words, "clicked": hit["name"], "found_by": "text"}
        # 2) By looking at a screenshot with the vision model
        spot = await ctx["locate_on_screen"](target + (f" (it shows the words '{words}')" if words and words not in target else ""))
        if spot.get("error"):
            return spot
        done = await run_in_threadpool(automation.click, spot["x"], spot["y"], button, double)
    except automation.ControlError as exc:
        return {"error": str(exc)}
    return {**done, "target": target, "found_by": "screenshot"}


def _github_folder(folder: str) -> Path:
    """The folder to upload: a full path, or a folder name in the usual places. Never a whole drive or system folder."""
    raw = (folder or "").strip().strip('"')
    if not raw:
        raise ValueError("Which folder should I upload?")
    home = Path.home()
    candidates = [Path(raw).expanduser()] if Path(raw).expanduser().is_absolute() else \
        [base / raw for base in (home / "Documents" / "Athena Projects", home / "Documents", home / "Desktop", home / "Downloads", home)]
    path = next((c.resolve() for c in candidates if c.is_dir()), None)
    if not path:
        raise ValueError(f"I couldn't find a folder called {raw}. Tell me where it is, or ask me to find it first.")
    blocked = {home.resolve(), (home / "Documents").resolve(), (home / "Desktop").resolve(), (home / "Downloads").resolve()}
    low = str(path).lower()
    if path in blocked or path.parent == path or any(k in low for k in ("\\windows", "program files", "appdata", "/etc", "/usr")):
        raise ValueError(f"I won't upload {path} (it's a whole personal or system folder). Pick the project folder inside it.")
    return path


def _upload_folder(a):
    from . import workspace
    try:
        root = _github_folder(str(a.get("folder", "")))
        files_, big, total = 0, [], 0
        for p in root.rglob("*"):
            if any(part in workspace.SKIP_DIRS for part in p.relative_to(root).parts):
                continue
            if p.is_file():
                files_ += 1
                size = p.stat().st_size
                total += size
                if size > 95 * 1024 * 1024:  # GitHub refuses files over 100 MB: leave them out
                    big.append(p.relative_to(root).as_posix())
            if files_ > 20000:
                return {"error": "That folder has over 20,000 files, too many for one upload. Pick a smaller project folder."}
        if total - sum((root / b).stat().st_size for b in big) > 1024 ** 3:
            return {"error": "That folder is over 1 GB, too big for GitHub. Pick the project folder without videos or builds."}
        if big:
            ignore = root / ".gitignore"
            existing = ignore.read_text(encoding="utf-8", errors="replace") if ignore.exists() else ""
            ignore.write_text(existing + ("\n" if existing and not existing.endswith("\n") else "") + "\n".join(big) + "\n", encoding="utf-8")
        result = workspace.git_publish(root, {k: a[k] for k in ("message", "repo_name", "private", "description") if k in a})
        if big:
            result["left_out_big_files"] = big
        return result
    except (ValueError, OSError, workspace.WorkspaceError) as exc:
        return {"error": str(exc)}


def _approve_upload(a):
    import subprocess

    root = _github_folder(str(a.get("folder", "")))
    remote = ""
    if (root / ".git").exists():
        r = subprocess.run(["git", "remote", "get-url", "origin"], cwd=root, capture_output=True, text=True, timeout=10,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        remote = r.stdout.strip().removesuffix(".git") if r.returncode == 0 else ""
    if remote:
        return f"Upload the folder {root} to {remote}"
    kind = "public" if a.get("private") is False else ("private" if a.get("private") or store.get_settings().get("github_private", True) else "public")
    name = a.get("repo_name") or root.name
    return f"Upload the folder {root} to your GitHub as a new {kind} repository called “{name}”"


def _save_self(a):
    from . import selfedit
    return selfedit.save_to_github(None, a)


def _approve_save_self(a):
    from . import selfedit
    return selfedit.approval("save_self_changes")["summary"]


def _discord_search(a):
    from . import automation, messaging
    try:
        return messaging.discord_search(str(a.get("query", "")), str(a.get("where") or ""))
    except (messaging.MessageError, automation.ControlError) as exc:
        return {"error": str(exc)}


def _watch_youtube(a):
    from . import youtube
    return youtube.watch(str(a.get("query", "")), str(a.get("what") or "auto"))


def _contacts(a):
    from . import messaging
    return {"contacts": [{k: v for k, v in c.items() if k != "id" and v} for c in messaging.list_contacts()]}


def _add_contact(a):
    from . import messaging
    return {"saved": {k: v for k, v in messaging.save_contact(a).items() if k != "id" and v}}


def _routines(a):
    from . import routines
    return {"routines": [{"name": r["name"], "say_any_of": r["phrases"], "steps": [routines.describe_step(s) for s in r["steps"]]}
                         for r in routines.list_routines()]}


def _create_routine(a):
    from . import routines
    r = routines.save_routine({"name": a.get("name"), "phrases": a.get("phrases"), "steps": a.get("steps"), "icon": a.get("icon")})
    return {"saved_routine": r["name"], "say_any_of": r["phrases"], "steps": [routines.describe_step(s) for s in r["steps"]]}


def _approve_routine(a):
    from . import routines
    steps = routines.clean_steps(a.get("steps"))
    return f"Save the routine \"{a.get('name')}\":\n" + "\n".join(f"{i}. {routines.describe_step(s)}" for i, s in enumerate(steps, 1))


def _delete_routine(a):
    from . import routines
    return {"deleted": routines.delete_routine(str(a.get("name", "")))}


async def run_steps(routine, ctx, on_step=None, on_start=None):
    """Run a routine's steps in order. on_start(i, tool, args) / on_step(i, tool, args, result) report progress."""
    import asyncio

    from starlette.concurrency import run_in_threadpool

    from . import routines
    said, results = [], []
    for i, step in enumerate(routine["steps"]):
        name, args = routines.step_call(step)
        if on_start:
            await on_start(i, name, args)
        if name == "say":
            said.append(str(args.get("text", "")))
            result = {"said": args.get("text", "")}
        elif name == "wait":
            await asyncio.sleep(min(max(float(args.get("seconds") or 2), 0), 60))
            result = {"waited": args.get("seconds", 2)}
        else:
            tool = BY_NAME.get(name)
            result = await arun_tool(name, args, ctx) if tool and tool.arun else await run_in_threadpool(run_tool, name, args)
            await asyncio.sleep(0.4)  # give apps a moment between steps
        results.append({"step": routines.describe_step(step), **({"error": result["error"]} if isinstance(result, dict) and result.get("error") else {"ok": True})})
        if on_step:
            await on_step(i, name, args, result)
    return {"routine": routine["name"], "steps": results, "say": " ".join(t for t in said if t)}


async def _run_routine(a, ctx):
    from . import routines
    r = routines.find(str(a.get("name", "")))
    if not r:
        names = ", ".join(x["name"] for x in routines.list_routines()) or "none yet"
        return {"error": f"No routine called '{a.get('name')}'. Routines: {names}"}
    return await run_steps(r, ctx)


STEP_HELP = ("Each step is an object with 'do' plus its settings: open_app{name}, close_app{app}, window{action: focus|minimize|maximize|"
             "left|right|move, app, monitor}, minimize_all, volume{level}, media{action: play_pause|next|previous}, open_website{url}, "
             "message{app: discord|whatsapp|text|email, to, text}, say{text}, wait{seconds}, type{text}, keys{keys}, timer{minutes, label}, "
             "home{device, action}, lock, sleep, shutdown{minutes}.")

TOOLS += [
    Tool("pc_status", "pc", "How the PC is doing right now: CPU and memory use, graphics card load and memory (temperature on NVIDIA), "
         "free disk space, network speed, battery, uptime, and which apps use the most. Use for 'how's my PC', 'why is it slow', etc.",
         run=_pc_status),
    Tool("window_control", "pc", "Control app windows: focus (bring to front), minimize, maximize, restore, close, move to a monitor "
         "(monitor 1 is the main one), snap left/right half, minimize_all, or list open windows.",
         {"action": S("focus, minimize, maximize, restore, close, move, left, right, minimize_all or list"),
          "app": S("App or window name, e.g. Discord, Chrome, Spotify"), "monitor": {"type": "integer", "description": "Monitor number for move"}},
         ["action"], run=_ctl(_window), approve=_safe(lambda a: f"Close {a.get('app')}" if str(a.get("action")).lower() == "close" else None)),
    Tool("type_text", "pc", "Type text into the app that's in front (or into a named app, which is brought to the front first).",
         {"text": S("What to type"), "app": S("Optional app to type into")}, ["text"], run=_ctl(_type),
         approve=_safe(lambda a: f"Type into {a.get('app') or 'the window in front'}:\n\"{str(a.get('text'))[:300]}\"")),
    Tool("press_keys", "pc", "Press a keyboard shortcut or key in the app in front (or a named app): e.g. ctrl+s, alt+tab, win+d, enter, "
         "f5, space. Several: 'ctrl+a, delete'.",
         {"keys": S("Keys, e.g. ctrl+shift+t"), "app": S("Optional app to send them to"), "times": {"type": "integer", "description": "Repeat count"}},
         ["keys"], run=_ctl(_keys), approve=_safe(lambda a: f"Press {a.get('keys')}" + (f" in {a.get('app')}" if a.get("app") else ""))),
    Tool("click_on_screen", "screen", "Click something on screen: a video, link, button, song, chat, menu item... Describe it, and "
         "put the words shown on it in 'text' when there are any (e.g. a video's title). Finds it by its words first "
         "(scrolling down to it if needed), then by looking at the screen. For typing afterwards use type_text.",
         {"target": S("What to click, described clearly (e.g. 'the video about the Crimson Desert trailer')"),
          "text": S("Words shown on it, if any, e.g. the video title or button label (partial is fine)"),
          "double": {"type": "boolean", "description": "Double-click"},
          "wait": {"type": "number", "description": "Seconds to wait first, e.g. for a page that just opened (max 10)"},
          "button": S("left or right", enum=["left", "right"])}, ["target"], arun=_click,
         approve=_safe(lambda a: f"Click \"{a.get('target')}\" on your screen")),
    Tool("send_message", "pc", "Send a message to a person or group chat on any app or website: Discord (default), WhatsApp, "
         "Instagram, Messenger, Telegram, texts (Phone Link), email, or any other app or site (Snapchat, Slack, Teams, X, "
         "Reddit…). Athena opens it and sends it like the user would; the user approves first. Texts and emails open as a "
         "ready draft.",
         {"to": S("Person's name, username or group chat name (or phone / email)"), "text": S("The message"),
          "app": S("The app or website, e.g. discord, whatsapp, instagram, messenger, telegram, text, email, snapchat, slack"),
          "subject": S("Email subject")},
         ["to", "text"], arun=_send_message, approve=_safe(_approve_message)),
    Tool("discord_search", "pc", "Search Discord messages: opens Discord, goes to a server, channel or person if given (Discord "
         "searches the one that's open), and searches for the words. Use for 'find the minecraft ip in the squad server' or "
         "'search my dms with Jake for that link'.",
         {"query": S("What to search for"), "where": S("Server, channel, group chat or person to search in (optional)")},
         ["query"], run=_discord_search),
    Tool("upload_folder_to_github", "pc", "Upload a folder on this PC (a project, mod, website, notes…) to the user's GitHub: "
         "creates a new repository on their account (private unless they ask for public) or updates the one it's already "
         "connected to, and returns the link. The user approves first. For Code-mode projects use upload_to_github instead.",
         {"folder": S("Full path of the folder, or its name if it's in Documents / Desktop / Downloads"),
          "repo_name": S("Repository name (optional; default: the folder name)"),
          "private": {"type": "boolean", "description": "Private (default) or public"},
          "description": S("One-line description (optional)"), "message": S("What changed, for an update (optional)")},
         ["folder"], run=_upload_folder, approve=_safe(_approve_upload)),
    Tool("sports_games", "sports", "Scores, schedules and betting lines (spread, total, moneyline) for a league on a day. "
         "Use for 'who plays tonight', 'Lakers score', 'NFL games Sunday'.",
         {"league": S("NBA, NFL, MLB, NHL, WNBA, college football, college basketball, MLS, EPL, UFC…"),
          "date": S("today (default), tomorrow, yesterday or 2025-01-31"), "team": S("Only games for this team (optional)")},
         [], arun=_sports_games),
    Tool("sports_team", "sports", "A team's record, standing, recent results, home/away form, next games, injuries and news. "
         "Give opponent for head-to-head results (this season and last); give season for past seasons (e.g. 2016).",
         {"team": S("Team name, e.g. Lakers"), "league": S("League, if the name is shared (Giants, Rangers, Kings…)"),
          "opponent": S("Opponent for head-to-head (optional)"), "season": {"type": "integer", "description": "Year of a past season (optional)"}},
         ["team"], arun=_sports_team),
    Tool("sports_player", "sports", "A player's game-by-game stats (this or a past season). With stat + line it checks a pick "
         "(PrizePicks, Underdog, sportsbook props): how often they went over/under that line in the last 5, last 10, this "
         "season, last season, home/away and against the next opponent, plus minutes and injury status. Use it for any "
         "'X over 24.5 points', 'should I take the over', 'is this a good pick'.",
         {"player": S("Player name"), "league": S("League (optional; helps with common names)"),
          "stat": S("e.g. points, rebounds, assists, threes, PRA, pts+reb, fantasy score, passing yards, receptions, "
                    "strikeouts, total bases, shots on goal"),
          "line": {"type": "number", "description": "The line, e.g. 24.5"}, "pick": S("over or under (optional)"),
          "opponent": S("Opponent (optional; defaults to their next game)"),
          "season": {"type": "integer", "description": "Year of a past season (optional)"}},
         ["player"], arun=_sports_player),
    Tool("sports_standings", "sports", "League standings (wins, losses, games behind, streak).",
         {"league": S("League"), "season": {"type": "integer", "description": "Past season year (optional)"}}, ["league"],
         arun=_sports_standings),
    Tool("kalshi_markets", "sports", "Live Kalshi prediction-market prices for a team, game, player or league (read-only, no "
         "account needed). A YES price in cents is the market's % chance.",
         {"query": S("e.g. 'Lakers', 'NBA', 'Chiefs Bills', 'Super Bowl'")}, ["query"], arun=_kalshi),
    Tool("work_on_myself", "pc", "Open Athena's own code so you can really change yourself: call this whenever the user "
         "wants something changed, fixed, upgraded or added in Athena herself (the app, her features, her look). The app "
         "then opens her code in Code mode and continues with the user's request there.",
         {"request": S("What the user wants changed, in a sentence")}, [], run=lambda a: {"open_self": True, "request": str(a.get("request") or "")}),
    Tool("save_self_changes", "pc", "Back up the changes Athena made to her own code ('fix yourself') to the user's GitHub, on "
         "a separate branch (athena-self-changes) that updates never touch. Use for 'save your changes to GitHub'. The user approves.",
         {"message": S("Short description of the changes (optional)")}, [], run=_save_self, approve=_safe(_approve_save_self)),
    Tool("watch_youtube", "pc", "Play or open something on YouTube in the browser. what='auto' plays a YouTuber's newest video "
         "(or the top video for a topic), 'latest' = a creator's newest upload, 'channel' = open a creator's channel, "
         "'video' = the top video for a search. Use for 'watch MrBeast', 'put on some Markiplier', 'play lofi on YouTube'.",
         {"query": S("A YouTuber's name, or what to watch"), "what": S("auto, latest, channel or video", enum=["auto", "latest", "channel", "video"])},
         ["query"], run=_watch_youtube),
    Tool("list_contacts", "pc", "List the user's saved contacts (names with their Discord username, phone and email).", run=_contacts),
    Tool("add_contact", "pc", "Save or update a contact so messages reach the right person.",
         {"name": S("Name"), "nicknames": S("Other names the user calls them, comma separated (e.g. 'Jay, my brother')"), "discord": S("Discord username"), "instagram": S("Instagram username"), "snapchat": S("Snapchat username"),
          "telegram": S("Telegram username"), "phone": S("Phone number"), "email": S("Email address")}, ["name"],
         run=_ctl(lambda **a: _add_contact(a))),
    Tool("list_routines", "pc", "List the user's routines (one phrase that runs several steps).", run=_routines),
    Tool("run_routine", "pc", "Run one of the user's routines by name (e.g. 'gaming', 'goodnight').", {"name": S("Routine name")}, ["name"],
         arun=_run_routine),
    Tool("create_routine", "pc", "Create or update a routine: a name, the phrases that start it, and its steps. " + STEP_HELP,
         {"name": S("Routine name, e.g. Gaming"), "phrases": {"type": "array", "items": {"type": "string"}, "description": "Phrases that start it"},
          "steps": {"type": "array", "items": {"type": "object"}, "description": "The steps in order"}, "icon": S("One emoji")},
         ["name", "steps"], run=_ctl(lambda **a: _create_routine(a)), approve=_safe(_approve_routine)),
    Tool("delete_routine", "pc", "Delete a routine.", {"name": S("Routine name")}, ["name"], run=_delete_routine,
         approve=_safe(lambda a: f"Delete the routine \"{a.get('name')}\"")),
]
BY_NAME = {t.name: t for t in TOOLS}


def enabled_tools(settings: dict[str, Any]) -> list[Tool]:
    groups = {"core"}
    if settings.get("tools_enabled"):
        groups.add("tasks")
    if settings.get("web_enabled") and settings.get("sports_enabled", True):
        groups.add("sports")
    for key, group in (("memory_enabled", "memory"), ("files_enabled", "files"), ("web_enabled", "web"),
                       ("pc_enabled", "pc"), ("screen_enabled", "screen"), ("code_enabled", "code")):
        if settings.get(key):
            groups.add(group)
    if settings.get("docs_enabled") and settings.get("knowledge_folders"):
        groups.add("docs")
    if settings.get("images_enabled", True):  # finds ComfyUI / Forge / Ollama image models by itself
        groups.add("images")
    if settings.get("ha_url") and settings.get("ha_token"):
        groups.add("home")
    if settings.get("offline_mode"):  # nothing that reaches the internet
        groups.discard("web")
        groups.discard("sports")
        return [t for t in TOOLS if t.group in groups and t.name not in ONLINE_TOOLS]
    return [t for t in TOOLS if t.group in groups]


# Tools that need the internet (hidden in offline mode; web search, pages and weather are the "web" group)
ONLINE_TOOLS = {"watch_youtube", "upload_folder_to_github", "save_self_changes", "open_website", "discord_search", "send_message"}


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
    args = {k: v for k, v in args.items() if v is not None and v != ""}
    try:
        return tool.run(args)
    except files.FileError as exc:
        return {"error": str(exc)}
    except TypeError as exc:
        return {"error": f"Bad arguments: {exc}"}
    except Exception as exc:  # never let a tool crash the chat
        return {"error": str(exc)}


async def arun_tool(name: str, args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    tool = BY_NAME.get(name)
    args = {k: v for k, v in args.items() if v is not None and v != ""}
    try:
        return await tool.arun(args, ctx)
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
