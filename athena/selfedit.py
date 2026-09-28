"""Athena working on her own code: "fix yourself", "add a button that…", "why does X break?".

She opens her own folder like any Code-mode project (you approve every change as a diff), then:
- check_athena: makes sure the changed code still loads before anything restarts
- restart_athena: restarts her so the change takes effect (only if the check passes)
- undo_self_changes: puts her code back to the downloaded version (the changes are kept aside, not lost)

Updates keep her self-made changes when they can; start.bat offers to undo them if she ever fails to start.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from . import store

FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def is_self(root: Path | None) -> bool:
    try:
        return bool(root) and Path(root).resolve() == store.ROOT.resolve()
    except OSError:
        return False


def _git(*args: str, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=store.ROOT, capture_output=True, text=True, timeout=timeout,
                          encoding="utf-8", errors="replace", creationflags=FLAGS)


def has_git() -> bool:
    return bool(shutil.which("git")) and (store.ROOT / ".git").exists()


def changed_files() -> list[str]:
    if not has_git():
        return []
    out = _git("status", "--porcelain").stdout
    return [line[3:].strip() for line in out.splitlines() if line.strip()]


def check(_root: Path | None = None, _args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Does Athena's code still load? Python: compile everything and import the server. JavaScript: a syntax check
    when Node.js is installed."""
    problems: list[str] = []
    r = subprocess.run([sys.executable, "-c", "import compileall, sys\n"
                        "ok = compileall.compile_dir('athena', quiet=1, force=True)\n"
                        "import athena.server\n"
                        "sys.exit(0 if ok else 1)"],
                       cwd=store.ROOT, capture_output=True, text=True, timeout=180, creationflags=FLAGS)
    if r.returncode != 0:
        tail = [ln for ln in (r.stderr or r.stdout).strip().splitlines() if ln.strip()][-8:]
        problems.append("Python: " + "\n".join(tail))
    node = shutil.which("node")
    if node:
        for js in sorted((store.ROOT / "static").glob("*.js")):
            j = subprocess.run([node, "--check", str(js)], capture_output=True, text=True, timeout=60, creationflags=FLAGS)
            if j.returncode != 0:
                problems.append(f"{js.name}: " + "\n".join((j.stderr or "").strip().splitlines()[:6]))
    result: dict[str, Any] = {"ok": not problems, "changed_files": changed_files()}
    if problems:
        result["problems"] = problems
        result["next_step"] = "Fix these before restarting (read the file around the error), or undo_self_changes."
    else:
        result["checked"] = "Python loads fine" + (" and the JavaScript has no syntax errors" if node else
                                                  " (JavaScript wasn't checked: Node.js isn't installed)")
    return result


def restart(_root: Path | None = None, _args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Restart Athena so her code changes take effect. Refuses if the code doesn't load."""
    c = check()
    if not c["ok"]:
        return {"restarting": False, **c}
    from . import maintenance

    threading.Timer(2.0, maintenance._restart).start()  # after this reply has been sent
    return {"restarting": True, "note": "Restarting now; the page reloads by itself in a few seconds.", "changed_files": c["changed_files"]}


def undo(_root: Path | None = None, _args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Put Athena's code back to the downloaded version. The changes are kept aside (git stash), not deleted."""
    if not has_git():
        return {"error": "I can't undo on my own here (this folder isn't connected to GitHub yet). Run update.bat to get a clean copy."}
    files = changed_files()
    if not files:
        return {"undone": False, "note": "My code already matches the downloaded version; there's nothing to undo."}
    name = f"Athena's own changes {time.strftime('%Y-%m-%d %H:%M')}"
    r = _git("stash", "push", "--include-untracked", "-m", name)
    if r.returncode != 0:
        return {"error": "Couldn't undo: " + (r.stderr or r.stdout).strip()[-300:]}
    return {"undone": True, "files": files, "kept_aside_as": name,
            "next_step": "Call restart_athena (or tell the user to restart) so the original code runs again."}


def keep_through_update(pull) -> str:
    """Run an update (`pull` does the download + reset) without losing Athena's self-made changes.
    Returns a note for the user ('' if nothing special happened)."""
    if not changed_files():
        pull()
        return ""
    name = f"Athena's own changes (before update {time.strftime('%Y-%m-%d %H:%M')})"
    if _git("stash", "push", "--include-untracked", "-m", name).returncode != 0:
        pull()
        return ""
    pull()
    if _git("stash", "apply").returncode == 0:
        _git("stash", "drop")
        return "Your changes to Athena's own code were kept."
    # The update changed the same code: keep the new version working, and keep her changes aside (not lost)
    _git("reset", "-q", "--hard", "HEAD")
    _git("clean", "-fdq", "--", "athena", "static")
    return ("The update changed the same code Athena had changed herself, so her changes were set aside "
            f"(saved as “{name}”). Ask her to make them again if you still want them.")


SELF_PROMPT = (
    "\n\nThis project is YOU: Athena's own code, running right now. The user wants you to fix or improve yourself. "
    "Layout: athena/server.py is the web server and chat (FastAPI); athena/tools.py defines your tools; athena/commands.py "
    "holds the instant commands; other athena/*.py files are features (pc.py, messaging.py, photos.py…); static/app.js, "
    "static/index.html and static/style.css are the app you see; data/ holds the user's chats and settings (never edit it). "
    "Work carefully: find the right place with search_code, read it with read_code, then make the SMALLEST edit that does "
    "the job with edit_code (the user approves each diff). Don't rewrite whole files and don't touch unrelated code. After "
    "your edits, ALWAYS call check_athena. If it reports problems, fix them (or undo_self_changes). When it passes, call "
    "restart_athena so the change takes effect, then tell the user in plain words what you changed. If the user says "
    "something you changed broke things, call undo_self_changes."
)

SPECS = [
    ("check_athena", "Check that Athena's own code still loads after your edits (Python imports, JavaScript syntax). "
     "Always run it after editing yourself.", {}, []),
    ("restart_athena", "Restart Athena so your code changes take effect (the user approves; refused if check_athena fails). "
     "The page reloads by itself.", {}, []),
    ("undo_self_changes", "Put Athena's code back to the downloaded version (the user approves). Her changes are kept aside, "
     "not deleted. Use it if a self-edit broke something.", {}, []),
]
RUNNERS = {"check_athena": check, "restart_athena": restart, "undo_self_changes": undo}


def approval(name: str) -> dict[str, Any] | None:
    files = changed_files()
    listed = ", ".join(files[:6]) + ("…" if len(files) > 6 else "")
    if name == "restart_athena":
        return {"summary": "Restart Athena so her changes take effect" + (f" ({listed})" if files else "")}
    if name == "undo_self_changes":
        return {"summary": "Undo Athena's changes to her own code" + (f": {listed}" if files else "") + " (kept aside, not deleted)"}
    return None
