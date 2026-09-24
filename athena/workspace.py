"""Code projects: open a folder of code in a chat and Athena can read it, search it and edit it.

Every edit is shown to you as a diff first (unless you allowed everything in that chat), a backup
of the old file is kept, and "undo" puts it back.
"""
from __future__ import annotations

import difflib
import fnmatch
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from . import store

SKIP_DIRS = {".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv", "env", ".env", "dist", "build",
             ".next", ".nuxt", "target", ".idea", ".vs", ".gradle", ".pytest_cache", ".mypy_cache", ".ruff_cache",
             "coverage", ".cache", "bin", "obj", ".terraform", "vendor", "Pods", ".dart_tool", ".turbo", ".parcel-cache"}
BINARY_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip", ".gz", ".7z", ".rar", ".exe", ".dll",
              ".so", ".dylib", ".bin", ".class", ".jar", ".pyc", ".o", ".obj", ".woff", ".woff2", ".ttf", ".otf", ".mp3",
              ".mp4", ".mov", ".wav", ".db", ".sqlite", ".lock", ".psd", ".onnx", ".gguf", ".safetensors", ".pt"}
MAX_FILES = 5000
MAX_READ_CHARS = 60_000
BACKUPS = store.DATA_DIR / "code_backups"
JOURNAL = store.DATA_DIR / "code_journal.json"


class WorkspaceError(Exception):
    pass


def open_root(path: str | None) -> Path | None:
    """The folder the user opened for this chat, checked. None if no folder is open."""
    if not path or not str(path).strip():
        return None
    p = Path(os.path.expandvars(os.path.expanduser(str(path).strip().strip('"')))).resolve()
    if not p.is_dir():
        raise WorkspaceError(f"Folder not found: {path}")
    if p == Path(p.anchor) or p == Path.home():
        raise WorkspaceError("Pick a project folder, not a whole drive or your home folder.")
    return p


def _inside(root: Path, rel: str) -> Path:
    rel = (rel or "").strip().strip('"').replace("\\", "/")
    p = (root / rel.lstrip("/")).resolve() if not Path(rel).is_absolute() else Path(rel).resolve()
    try:
        p.relative_to(root)
    except ValueError:
        raise WorkspaceError(f"'{rel}' is outside the project folder") from None
    return p


def _rel(root: Path, p: Path) -> str:
    return p.relative_to(root).as_posix()


def _gitignore(root: Path) -> list[str]:
    try:
        lines = (root / ".gitignore").read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    return [ln.strip().rstrip("/") for ln in lines if ln.strip() and not ln.startswith(("#", "!"))]


def _ignored(rel: str, name: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(name, pat) or fnmatch.fnmatch(rel, pat.lstrip("/")) for pat in patterns)


def walk(root: Path) -> list[Path]:
    patterns = _gitignore(root)
    out: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        base = Path(dirpath)
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")
                             and not _ignored(_rel(root, base / d), d, patterns))
        for f in sorted(filenames):
            p = base / f
            if p.suffix.lower() in BINARY_EXT or _ignored(_rel(root, p), f, patterns):
                continue
            out.append(p)
            if len(out) >= MAX_FILES:
                return out
    return out


def summary(root: Path) -> dict[str, Any]:
    files = walk(root)
    langs: dict[str, int] = {}
    for f in files:
        if f.suffix:
            langs[f.suffix.lower()] = langs.get(f.suffix.lower(), 0) + 1
    top = sorted(langs.items(), key=lambda kv: -kv[1])[:5]
    return {"path": str(root), "name": root.name, "files": len(files), "languages": [k for k, _ in top],
            "git": (root / ".git").exists()}


def _is_text(p: Path) -> bool:
    try:
        with p.open("rb") as fh:
            return b"\x00" not in fh.read(4096)
    except OSError:
        return False


def _read(p: Path) -> str:
    if not p.is_file():
        raise WorkspaceError(f"No such file: {p.name}")
    if p.stat().st_size > 2_000_000 or not _is_text(p):
        raise WorkspaceError(f"{p.name} isn't a text file (or is too big to read)")
    return p.read_text(encoding="utf-8", errors="replace")


# ------------------------------------------------------------------ tools

def project_tree(root: Path, a: dict[str, Any]) -> dict[str, Any]:
    sub = str(a.get("folder") or "").strip()
    base = _inside(root, sub) if sub else root
    files = [f for f in walk(root) if base in f.parents or f.parent == base]
    lines = []
    for f in files[:600]:
        size = f.stat().st_size
        lines.append(f"{_rel(root, f)}  ({size // 1024} KB)" if size >= 10_240 else _rel(root, f))
    return {"project": root.name, "files": len(files), "tree": "\n".join(lines),
            **({"note": f"Showing 600 of {len(files)} files. Pass a folder to see more."} if len(files) > 600 else {})}


def read_code(root: Path, a: dict[str, Any]) -> dict[str, Any]:
    p = _inside(root, str(a.get("path", "")))
    text = _read(p)
    lines = text.splitlines()
    start = max(1, int(a.get("start_line") or 1))
    end = min(len(lines), int(a.get("end_line") or len(lines)))
    numbered, size = [], 0
    for i in range(start, end + 1):
        row = f"{i:>5}  {lines[i - 1]}"
        size += len(row) + 1
        if size > MAX_READ_CHARS:
            end = i - 1
            break
        numbered.append(row)
    out = {"path": _rel(root, p), "lines": f"{start}-{end} of {len(lines)}", "content": "\n".join(numbered)}
    if end < len(lines):
        out["note"] = f"File continues. Call read_code again with start_line={end + 1}."
    return out


def search_code(root: Path, a: dict[str, Any]) -> dict[str, Any]:
    query = str(a.get("query", ""))
    if not query:
        raise WorkspaceError("Nothing to search for")
    try:
        rx = re.compile(query if a.get("regex") else re.escape(query), re.I)
    except re.error as exc:
        raise WorkspaceError(f"Bad pattern: {exc}") from None
    glob = str(a.get("file_pattern") or "")
    hits, files_hit = [], set()
    for f in walk(root):
        rel = _rel(root, f)
        if glob and not fnmatch.fnmatch(f.name, glob) and not fnmatch.fnmatch(rel, glob):
            continue
        if rx.search(rel):
            files_hit.add(rel)
        if f.stat().st_size > 1_000_000 or not _is_text(f):
            continue
        try:
            for n, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                if rx.search(line):
                    hits.append(f"{rel}:{n}: {line.strip()[:200]}")
                    files_hit.add(rel)
                    if len(hits) >= 80:
                        return {"matches": hits, "note": "Stopped at 80 matches; search more specifically."}
        except OSError:
            continue
    return {"matches": hits, "files": sorted(files_hit)[:50]} if hits or files_hit else {"matches": [], "message": "No matches."}


def _diff(rel: str, old: str, new: str) -> str:
    return "".join(difflib.unified_diff(old.splitlines(keepends=True), new.splitlines(keepends=True),
                                        fromfile=f"a/{rel}", tofile=f"b/{rel}", n=3))


def _normalize_ws(s: str) -> str:
    return "\n".join(line.rstrip() for line in s.replace("\r\n", "\n").split("\n"))


def plan_edit(root: Path, a: dict[str, Any]) -> tuple[Path, str, str]:
    """Work out the new file text for edit_code / write_code without touching the disk."""
    p = _inside(root, str(a.get("path", "")))
    if "content" in a:  # write_code: whole file
        old = _read(p) if p.exists() else ""
        return p, old, str(a.get("content") or "")
    old = _read(p)
    find, replace = str(a.get("find", "")), str(a.get("replace", ""))
    if not find:
        raise WorkspaceError("edit_code needs 'find': the exact text to replace")
    crlf = "\r\n" in old
    text = old.replace("\r\n", "\n")
    find_n, replace_n = find.replace("\r\n", "\n"), replace.replace("\r\n", "\n")
    count = text.count(find_n)
    if count == 0:  # forgive trailing-space differences
        loose = _normalize_ws(text)
        if _normalize_ws(find_n) in loose:
            text, find_n = loose, _normalize_ws(find_n)
            count = text.count(find_n)
    if count == 0:
        raise WorkspaceError("Couldn't find that exact text in the file. Read the file again and copy the lines exactly.")
    if count > 1 and not a.get("replace_all"):
        raise WorkspaceError(f"That text appears {count} times. Include more surrounding lines so it's unique, or set replace_all.")
    new = text.replace(find_n, replace_n) if a.get("replace_all") else text.replace(find_n, replace_n, 1)
    if crlf:
        new = new.replace("\n", "\r\n")
    return p, old, new


def approval(root: Path, name: str, a: dict[str, Any]) -> dict[str, Any] | None:
    if name in ("edit_code", "write_code"):
        p, old, new = plan_edit(root, a)
        rel = _rel(root, p)
        if old == new:
            return None
        verb = "Create" if not p.exists() else "Edit"
        added = sum(1 for ln in new.splitlines() if ln) if not p.exists() else None
        return {"summary": f"{verb} {rel} in {root.name}" + (f" ({added} lines)" if added else ""), "diff": _diff(rel, old, new)[:40_000]}
    if name == "run_in_project":
        return {"summary": f"Run this command in {root.name}:\n{a.get('command', '')}"}
    if name == "undo_code_edit":
        return None
    return None


def apply_edit(root: Path, a: dict[str, Any]) -> dict[str, Any]:
    p, old, new = plan_edit(root, a)
    rel = _rel(root, p)
    if old == new:
        return {"message": "No change needed; the file already has that content."}
    existed = p.exists()
    backup = None
    if existed:
        BACKUPS.mkdir(parents=True, exist_ok=True)
        backup = BACKUPS / f"{int(time.time() * 1000)}-{p.name}"
        shutil.copy2(p, backup)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(new, encoding="utf-8", newline="")
    journal = store._read(JOURNAL, [])[-49:]
    journal.append({"root": str(root), "path": str(p), "backup": str(backup) if backup else None, "time": time.time()})
    store._write(JOURNAL, journal)
    diff = _diff(rel, old, new)
    plus = sum(1 for ln in diff.splitlines() if ln.startswith("+") and not ln.startswith("+++"))
    minus = sum(1 for ln in diff.splitlines() if ln.startswith("-") and not ln.startswith("---"))
    return {"edited" if existed else "created": rel, "added_lines": plus, "removed_lines": minus, "diff": diff[:20_000]}


def undo(root: Path, _a: dict[str, Any]) -> dict[str, Any]:
    journal = store._read(JOURNAL, [])
    for i in range(len(journal) - 1, -1, -1):
        entry = journal[i]
        if entry["root"] != str(root):
            continue
        p = Path(entry["path"])
        if entry.get("backup") and Path(entry["backup"]).exists():
            shutil.copy2(entry["backup"], p)
            msg = {"restored": _rel(root, p)}
        elif p.exists():
            from send2trash import send2trash
            send2trash(str(p))
            msg = {"removed_new_file": _rel(root, p)}
        else:
            msg = {"message": "That file is already gone."}
        journal.pop(i)
        store._write(JOURNAL, journal)
        return msg
    return {"message": "No edits to undo in this project."}


def run_in_project(root: Path, a: dict[str, Any]) -> dict[str, Any]:
    command = str(a.get("command", "")).strip()
    if not command:
        raise WorkspaceError("No command given")
    timeout = min(int(a.get("timeout") or 120), 600)
    try:
        r = subprocess.run(command, shell=True, cwd=root, capture_output=True, text=True, timeout=timeout,
                           encoding="utf-8", errors="replace", env={**os.environ, "NO_COLOR": "1", "CI": "1"},
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        return {"timed_out": True, "seconds": timeout}
    return {"exit_code": r.returncode, "stdout": r.stdout[-8000:], "stderr": r.stderr[-6000:]}


RUNNERS = {"project_tree": project_tree, "read_code": read_code, "search_code": search_code,
           "edit_code": apply_edit, "write_code": apply_edit, "undo_code_edit": undo, "run_in_project": run_in_project}


def run(root: Path, name: str, args: dict[str, Any]) -> dict[str, Any]:
    try:
        return RUNNERS[name](root, args)
    except WorkspaceError as exc:
        return {"error": str(exc)}
    except (OSError, ValueError, TypeError) as exc:
        return {"error": str(exc)}


def prompt(root: Path) -> str:
    info = summary(root)
    langs = ", ".join(info["languages"]) or "unknown"
    return (
        f"\n\nThe user opened their code project \"{info['name']}\" ({info['files']} files, mostly {langs}) at {root}. "
        "Work like a careful senior engineer: look before you change anything. Use project_tree to see the layout, "
        "search_code to find where things are, and read_code to read files (with line numbers). To change code, use "
        "edit_code with 'find' copied EXACTLY from the file (a few lines, enough to be unique) and the 'replace' text; "
        "use write_code only for new files or complete rewrites. Keep each edit small and focused, match the existing "
        "style, and never invent file contents you haven't read. The user sees each change as a diff and approves it. "
        "Use run_in_project for tests or build commands when useful. When done, briefly summarise what you changed."
    )


def S(desc: str) -> dict[str, Any]:
    return {"type": "string", "description": desc}


SPECS = [
    ("project_tree", "List the files in the open code project (skips node_modules, .git, build output…).",
     {"folder": S("Optional sub-folder to list")}, []),
    ("read_code", "Read a file from the open code project, with line numbers.",
     {"path": S("File path relative to the project, e.g. src/app.js"),
      "start_line": {"type": "integer", "description": "First line (optional)"},
      "end_line": {"type": "integer", "description": "Last line (optional)"}}, ["path"]),
    ("search_code", "Search every file in the open code project for text (case-insensitive). Returns path:line: text.",
     {"query": S("Text to find"), "regex": {"type": "boolean", "description": "Treat query as a regular expression"},
      "file_pattern": S("Only search files matching this, e.g. *.py")}, ["query"]),
    ("edit_code", "Change part of a file in the open code project by replacing an exact piece of text. The user approves the diff.",
     {"path": S("File path relative to the project"), "find": S("Exact existing text to replace, copied from the file"),
      "replace": S("The new text"), "replace_all": {"type": "boolean", "description": "Replace every occurrence"}}, ["path", "find", "replace"]),
    ("write_code", "Create a new file (or completely rewrite one) in the open code project. The user approves the diff.",
     {"path": S("File path relative to the project"), "content": S("The complete file content")}, ["path", "content"]),
    ("undo_code_edit", "Undo the most recent code edit in this project (restores the previous version of the file).", {}, []),
    ("run_in_project", "Run a shell command in the project folder, e.g. tests or a build (the user approves it first).",
     {"command": S("The command, e.g. npm test or python -m pytest"), "timeout": {"type": "integer", "description": "Seconds (default 120)"}},
     ["command"]),
]


def specs() -> list[dict[str, Any]]:
    return [{"type": "function", "function": {"name": n, "description": d,
             "parameters": {"type": "object", "properties": p, "required": r}}} for n, d, p, r in SPECS]


NAMES = {n for n, *_ in SPECS}


def pick_folder() -> str | None:
    """Show the PC's own folder picker (works when Athena runs on this computer)."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as exc:
        raise WorkspaceError("The folder picker isn't available. Type or paste the folder path instead.") from exc
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        chosen = filedialog.askdirectory(title="Open a code project folder", mustexist=True)
    finally:
        root.destroy()
    return chosen or None
