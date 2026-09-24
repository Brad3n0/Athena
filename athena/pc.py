"""Control the PC: open apps, volume & media keys, lock/sleep/shutdown, clipboard, screenshots, run code.

Built mainly for Windows (using the built-in Windows APIs, no extra installs); macOS/Linux get
what's easy to support.
"""
from __future__ import annotations

import base64
import ctypes
import difflib
import io
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

WIN = sys.platform.startswith("win")
MAC = sys.platform == "darwin"


class PCError(Exception):
    pass


# ------------------------------------------------------------------- apps

BUILTIN_APPS = {
    "notepad": "notepad.exe", "calculator": "calc.exe", "calc": "calc.exe", "paint": "mspaint.exe",
    "file explorer": "explorer.exe", "explorer": "explorer.exe", "files": "explorer.exe",
    "command prompt": "cmd.exe", "cmd": "cmd.exe", "terminal": "wt.exe", "powershell": "powershell.exe",
    "task manager": "taskmgr.exe", "settings": "ms-settings:", "control panel": "control.exe",
    "snipping tool": "snippingtool.exe", "camera": "microsoft.windows.camera:", "clock": "ms-clock:",
    "photos": "ms-photos:", "store": "ms-windows-store:", "mail": "outlookmail:", "calendar": "outlookcal:",
    "edge": "microsoft-edge:", "spotify": "spotify:", "xbox": "xbox:",
}


def _start_menu_shortcuts() -> dict[str, Path]:
    dirs = [Path(os.environ.get("ProgramData", r"C:\ProgramData")) / r"Microsoft\Windows\Start Menu\Programs",
            Path(os.environ.get("APPDATA", "")) / r"Microsoft\Windows\Start Menu\Programs",
            Path.home() / "Desktop"]
    found: dict[str, Path] = {}
    for d in dirs:
        if not d.is_dir():
            continue
        for p in d.rglob("*"):
            if p.suffix.lower() in (".lnk", ".url", ".appref-ms") and "uninstall" not in p.stem.lower():
                found.setdefault(p.stem.lower(), p)
    return found


def installed_apps() -> list[str]:
    return sorted({*BUILTIN_APPS, *(_start_menu_shortcuts() if WIN else {})})


def open_app(name: str) -> dict[str, Any]:
    query = (name or "").strip().lower()
    if not query:
        raise PCError("Which app?")
    if WIN:
        shortcuts = _start_menu_shortcuts()
        target: str | Path | None = shortcuts.get(query) or BUILTIN_APPS.get(query)
        if not target:
            contains = [k for k in shortcuts if query in k]
            close = contains or difflib.get_close_matches(query, list(shortcuts), n=1, cutoff=0.6)
            if close:
                target = shortcuts[sorted(close, key=len)[0]]
        if not target:
            raise PCError(f"Couldn't find an app called '{name}'")
        os.startfile(str(target))  # type: ignore[attr-defined]
        return {"opened": Path(str(target)).stem if isinstance(target, Path) else query}
    if MAC:
        r = subprocess.run(["open", "-a", name], capture_output=True, text=True)
        if r.returncode:
            raise PCError(f"Couldn't find an app called '{name}'")
        return {"opened": name}
    try:
        subprocess.Popen([query], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    except FileNotFoundError:
        raise PCError(f"Couldn't find an app called '{name}'")
    return {"opened": name}


# ------------------------------------------------------------ volume/media

VK = {"volume_up": 0xAF, "volume_down": 0xAE, "mute": 0xAD, "play_pause": 0xB3, "next": 0xB0, "previous": 0xB1, "stop": 0xB2}


def _press(vk: int, times: int = 1) -> None:
    user32 = ctypes.windll.user32  # type: ignore[attr-defined]
    for _ in range(times):
        user32.keybd_event(vk, 0, 0, 0)
        user32.keybd_event(vk, 0, 2, 0)


def media(action: str) -> dict[str, Any]:
    action = action.strip().lower().replace(" ", "_").replace("/", "_")
    action = {"pause": "play_pause", "play": "play_pause", "skip": "next", "back": "previous", "prev": "previous"}.get(action, action)
    if action not in ("play_pause", "next", "previous", "stop"):
        raise PCError("Use play_pause, next, previous or stop")
    if not WIN:
        raise PCError("Media keys are only supported on Windows")
    _press(VK[action])
    return {"media": action}


def volume(level: float | None = None, change: float | None = None, mute: bool | None = None) -> dict[str, Any]:
    if not WIN:
        raise PCError("Volume control is only supported on Windows")
    if mute is not None:
        _press(VK["mute"])
        return {"mute_toggled": True}
    if level is not None:
        level = max(0, min(100, float(level)))
        _press(VK["volume_down"], 50)  # each key press is 2%
        _press(VK["volume_up"], round(level / 2))
        return {"volume": round(level)}
    if change is not None:
        steps = round(abs(float(change)) / 2) or 1
        _press(VK["volume_up" if float(change) > 0 else "volume_down"], steps)
        return {"volume_changed": f"{'+' if float(change) > 0 else '-'}{steps * 2}%"}
    raise PCError("Give a level (0-100), a change (+/-) or mute")


# ------------------------------------------------------------------ power

def lock() -> dict[str, Any]:
    if WIN:
        ctypes.windll.user32.LockWorkStation()  # type: ignore[attr-defined]
    elif MAC:
        subprocess.Popen(["pmset", "displaysleepnow"])
    else:
        subprocess.Popen(["loginctl", "lock-session"])
    return {"locked": True}


def power(action: str, minutes: float = 0) -> dict[str, Any]:
    action = action.strip().lower()
    secs = max(0, int(float(minutes or 0) * 60))
    if not WIN:
        raise PCError("Power controls are only supported on Windows")
    if action == "cancel":
        subprocess.run(["shutdown", "/a"], capture_output=True)
        return {"cancelled": "any scheduled shutdown or restart"}
    if action in ("shutdown", "restart"):
        subprocess.run(["shutdown", "/s" if action == "shutdown" else "/r", "/t", str(secs)], capture_output=True)
        return {"scheduled": action, "in_minutes": round(secs / 60, 1), "note": "Say 'cancel the shutdown' to stop it."}
    if action == "sleep":
        subprocess.Popen(["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"])
        return {"sleeping": True}
    raise PCError("Use shutdown, restart, sleep or cancel")


# -------------------------------------------------------------- clipboard

def get_clipboard() -> dict[str, Any]:
    try:
        import pyperclip
    except ImportError:
        raise PCError("Clipboard support needs 'pyperclip' — restart Athena with start.bat to install it")
    text = pyperclip.paste() or ""
    return {"clipboard": text[:20000], "empty": not text}


def set_clipboard(text: str) -> dict[str, Any]:
    try:
        import pyperclip
    except ImportError:
        raise PCError("Clipboard support needs 'pyperclip' — restart Athena with start.bat to install it")
    pyperclip.copy(text or "")
    return {"copied_characters": len(text or "")}


# ------------------------------------------------------------ screenshots

def screenshot(max_width: int = 1600) -> str:
    """Capture the main screen and return a base64 PNG/JPEG."""
    try:
        import mss
        import mss.tools
    except ImportError:
        raise PCError("Screenshots need 'mss' — restart Athena with start.bat to install it")
    with mss.mss() as sct:
        mon = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
        shot = sct.grab(mon)
        try:
            from PIL import Image

            img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
            if img.width > max_width:
                img = img.resize((max_width, round(img.height * max_width / img.width)))
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=85)
            return base64.b64encode(buf.getvalue()).decode()
        except ImportError:
            return base64.b64encode(mss.tools.to_png(shot.rgb, shot.size)).decode()


# --------------------------------------------------------------- run code

def run_python(code: str, timeout: int = 30) -> dict[str, Any]:
    code = code or ""
    if not code.strip():
        raise PCError("No code to run")
    with tempfile.TemporaryDirectory(prefix="athena-run-") as tmp:
        script = Path(tmp) / "main.py"
        script.write_text(code, encoding="utf-8")
        env = {**os.environ, "PYTHONIOENCODING": "utf-8", "MPLBACKEND": "Agg"}
        try:
            r = subprocess.run([sys.executable, "-I", str(script)], cwd=tmp, capture_output=True, text=True,
                               timeout=timeout, env=env, encoding="utf-8", errors="replace")
        except subprocess.TimeoutExpired as exc:
            out = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
            return {"timed_out": True, "seconds": timeout, "stdout": out[-6000:]}
    return {"exit_code": r.returncode, "stdout": r.stdout[-8000:], "stderr": r.stderr[-6000:]}
