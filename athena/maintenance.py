"""Looking after Athena: automatic daily backups, and updating from GitHub with one click.

Backups go in the "backups" folder next to Athena (not inside data, so a broken data folder can't take them with it).
Updates use the same GitHub branch as update.bat, and a backup is made first.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from . import exporter, store

BACKUP_DIR = store.ROOT / "backups"
KEEP_DAILY = 7
KEEP_OTHER = 3  # "before restore" / "before update" safety copies
NAME = re.compile(r"^athena-(daily|before-restore|before-update|manual)-(\d{4}-\d{2}-\d{2}_\d{4})\.zip$")


# ------------------------------------------------------------------ backups

def list_backups() -> list[dict[str, Any]]:
    out = []
    if BACKUP_DIR.exists():
        for f in BACKUP_DIR.glob("athena-*.zip"):
            m = NAME.match(f.name)
            if m:
                out.append({"name": f.name, "kind": m.group(1), "time": f.stat().st_mtime, "size": f.stat().st_size})
    return sorted(out, key=lambda b: -b["time"])


def make_backup(kind: str = "daily") -> dict[str, Any]:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    data = exporter.make_backup()
    name = f"athena-{kind}-{datetime.now():%Y-%m-%d_%H%M}.zip"
    tmp = BACKUP_DIR / (name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, BACKUP_DIR / name)
    _prune()
    return next(b for b in list_backups() if b["name"] == name)


def _prune() -> None:
    items = list_backups()
    daily = [b for b in items if b["kind"] in ("daily", "manual")]
    other = [b for b in items if b["kind"] not in ("daily", "manual")]
    for b in daily[KEEP_DAILY:] + other[KEEP_OTHER:]:
        try:
            (BACKUP_DIR / b["name"]).unlink()
        except OSError:
            pass


def restore(name: str) -> int:
    """Put a backup back. A copy of how things are right now is saved first, so a restore can be undone."""
    if not NAME.match(name or "") or not (BACKUP_DIR / name).is_file():
        raise exporter.ExportError("That backup doesn't exist")
    make_backup("before-restore")
    data = (BACKUP_DIR / name).read_bytes()
    # Chats made after the backup would otherwise stay: the backup's set of chats is the one you get back.
    import io
    import zipfile

    keep = {n for n in zipfile.ZipFile(io.BytesIO(data)).namelist() if n.startswith("conversations/")}
    if keep:
        for f in store.CHATS_DIR.glob("*.json"):
            if f"conversations/{f.name}" not in keep:
                f.unlink(missing_ok=True)
    return exporter.restore_backup(data)


def backup_if_due() -> None:
    if not store.get_settings().get("auto_backup", True):
        return
    newest = next((b for b in list_backups() if b["kind"] == "daily"), None)
    if not newest or time.time() - newest["time"] > 20 * 3600:
        try:
            make_backup("daily")
        except OSError:
            pass  # full disk etc.: try again later


def start_backups() -> None:
    """Check now, then every few hours (Athena may stay open for days)."""
    def loop() -> None:
        while True:
            backup_if_due()
            time.sleep(3 * 3600)
    threading.Thread(target=loop, daemon=True, name="athena-backups").start()


# ------------------------------------------------------------------ updates

def _branch() -> str:
    try:
        m = re.search(r'set "BRANCH=([^"]+)"', (store.ROOT / "update.bat").read_text(encoding="utf-8", errors="replace"))
        if m:
            return m.group(1)
    except OSError:
        pass
    return "main"


def _git(*args: str, timeout: int = 60) -> str:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"}  # never pop up a sign-in window
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    r = subprocess.run(["git", *args], cwd=store.ROOT, capture_output=True, text=True, timeout=timeout, env=env,
                       creationflags=flags)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip().splitlines()[-1] if (r.stderr or r.stdout).strip() else "git failed")
    return r.stdout.strip()


def check_update() -> dict[str, Any]:
    if not (store.ROOT / ".git").exists():
        return {"available": False, "reason": "Run update.bat once to connect Athena to GitHub; after that she updates herself."}
    try:
        _git("fetch", "-q", "origin", _branch())
        here, there = _git("rev-parse", "HEAD"), _git("rev-parse", "FETCH_HEAD")
        if here == there:
            return {"available": False, "reason": "You have the newest version."}
        changes = _git("log", "--format=%s", "-8", "HEAD..FETCH_HEAD").splitlines()
        count = int(_git("rev-list", "--count", "HEAD..FETCH_HEAD") or 0)
        if not count:
            return {"available": False, "reason": "You have the newest version."}
        return {"available": True, "count": count, "changes": [c for c in changes if c.strip()]}
    except FileNotFoundError:
        return {"available": False, "reason": "Git isn't installed. Run update.bat once and it installs it."}
    except (RuntimeError, subprocess.TimeoutExpired) as exc:
        return {"available": False, "reason": f"Couldn't check GitHub ({exc}). Check your internet connection."}


def apply_update() -> dict[str, Any]:
    """Back up, download the new version, then restart Athena in a few seconds."""
    make_backup("before-update")
    try:
        _git("fetch", "-q", "origin", _branch())
        _git("reset", "-q", "--hard", "FETCH_HEAD")
        subject = _git("log", "-1", "--format=%s")
    except (RuntimeError, subprocess.TimeoutExpired, FileNotFoundError) as exc:
        raise RuntimeError(f"The update didn't download: {exc}") from exc
    # New version, maybe new parts: install them before starting it
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", str(store.ROOT / "requirements.txt")],
                   cwd=store.ROOT, capture_output=True, timeout=900, creationflags=flags)
    threading.Timer(1.0, _restart).start()
    return {"ok": True, "version": subject}


def _restart() -> None:
    """Start a fresh Athena (once this one has closed and freed the port), then close this one."""
    args = list(getattr(sys, "orig_argv", [])[1:]) or ["-m", "athena"]
    if "--desktop" not in args and "--no-browser" not in args:
        args.append("--no-browser")  # the page that's already open reloads itself
    cmd = [sys.executable, *args]
    if sys.platform.startswith("win"):
        line = subprocess.list2cmdline(cmd)
        console = Path(sys.executable).name.lower() == "python.exe"
        flags = subprocess.CREATE_NEW_CONSOLE if console else (subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS)
        subprocess.Popen(f'cmd /c "timeout /t 3 /nobreak >nul & title Athena AI & {line}"', cwd=store.ROOT, creationflags=flags)
    else:
        import shlex

        subprocess.Popen(["sh", "-c", f"sleep 3; exec {shlex.join(cmd)}"], cwd=store.ROOT, start_new_session=True)
    os._exit(0)
