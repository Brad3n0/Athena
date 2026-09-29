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
import re
import shutil
import subprocess
import sys
import tempfile
import webbrowser
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
    try:
        return _open_app(name)
    except PCError:
        key = (name or "").strip().lower().removesuffix(".com")
        if key in SITES:  # "open YouTube": it's a website, not an app
            return open_website(name)
        # "pull up MrBeast": not an app or a site, but maybe a YouTuber
        from . import store, youtube

        try:
            channel = youtube.find_channel(name) if 0 < len(key.split()) <= 4 and not store.get_settings().get("offline_mode") else None
        except Exception:  # offline, YouTube changed its page... just say the app wasn't found
            channel = None
        if channel:
            webbrowser.open(channel["url"])
            return {"opened": channel["url"], "youtube_channel": channel["title"]}
        raise


def _open_app(name: str) -> dict[str, Any]:
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
            key = query.removesuffix(".com")
            if key in SITES or "." in query:  # "open YouTube": it's a website, not an app
                return open_website(name)
            raise PCError(f"Couldn't find an app called '{name}'. If it's a website, I can open it in the browser.")
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


def screenshot_for_pointing(width: int = 1288) -> dict[str, Any]:
    """A screenshot of the main screen sized for vision models to point at things (sides are multiples of 28,
    which is how Qwen-VL models measure), plus what's needed to turn their answer back into screen pixels."""
    try:
        import mss
        from PIL import Image
    except ImportError:
        raise PCError("Clicking on things needs 'mss' and 'Pillow' — restart Athena with start.bat to install them")
    with mss.mss() as sct:
        mon = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
        shot = sct.grab(mon)
    img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
    w = min(width, img.width) // 28 * 28
    h = max(28, round(img.height * w / img.width / 28) * 28)
    img = img.resize((w, h))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return {"image": base64.b64encode(buf.getvalue()).decode(), "width": w, "height": h,
            "left": mon["left"], "top": mon["top"], "scale_x": mon["width"] / w, "scale_y": mon["height"] / h}


# --------------------------------------------------------------- run code

# Loaded before the user's script when it uses matplotlib: plt.show() (and any figure left open at the end)
# is saved as a PNG so the chat can show the chart instead of trying to open a window.
_PLOT_HOOK = """
import atexit, runpy, sys
_n = [0]
def _save_all(*_a, **_k):
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return
    for num in plt.get_fignums():
        _n[0] += 1
        plt.figure(num).savefig(f"_athena_plot_{_n[0]}.png", dpi=110, bbox_inches="tight")
    plt.close("all")
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.show = _save_all
    atexit.register(_save_all)
except Exception:
    pass
sys.argv = ["main.py"]
runpy.run_path("main.py", run_name="__main__")
"""

MAX_IMAGES = 6


def _collect_images(folder: Path) -> list[str]:
    """PNG/JPG/SVG files the code wrote (charts, drawings), as data URLs for the chat."""
    out = []
    for f in sorted(folder.iterdir(), key=lambda f: f.stat().st_mtime):
        ext = f.suffix.lower()
        if ext in (".png", ".jpg", ".jpeg", ".svg", ".gif") and f.stat().st_size < 3_000_000 and len(out) < MAX_IMAGES:
            mime = {"svg": "image/svg+xml", "jpg": "image/jpeg"}.get(ext[1:], f"image/{ext[1:]}")
            out.append(f"data:{mime};base64," + base64.b64encode(f.read_bytes()).decode())
    return out


# language -> (file name, command). Node, PowerShell and Bash are used only if they're installed.
def _runner(lang: str) -> tuple[str, list[str]] | None:
    import shutil

    lang = (lang or "python").lower()
    if lang in ("python", "py", "python3", ""):
        return "main.py", [sys.executable, "main.py"]
    if lang in ("javascript", "js", "node", "mjs"):
        node = shutil.which("node")
        return ("main.mjs", [node, "main.mjs"]) if node else None
    if lang in ("typescript", "ts"):
        node = shutil.which("node")
        # Node 22.6+ can run TypeScript directly by stripping the types.
        return ("main.ts", [node, "--experimental-strip-types", "--no-warnings", "main.ts"]) if node else None
    if lang in ("powershell", "ps1", "pwsh"):
        ps = shutil.which("pwsh") or shutil.which("powershell")
        return ("main.ps1", [ps, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "main.ps1"]) if ps else None
    if lang in ("bat", "batch", "cmd"):
        return ("main.bat", ["cmd", "/c", "main.bat"]) if os.name == "nt" else None
    if lang in ("bash", "sh", "shell", "zsh"):
        sh = shutil.which("bash") or shutil.which("sh")
        return ("main.sh", [sh, "main.sh"]) if sh else None
    return None


RUNNABLE = ("python", "javascript", "typescript", "powershell", "batch", "bash")
_NEEDS = {"javascript": "Node.js (nodejs.org)", "typescript": "Node.js 22 or newer (nodejs.org)",
          "powershell": "PowerShell", "batch": "Windows", "bash": "Bash (Git Bash or WSL on Windows)"}


def run_code(code: str, language: str = "python", timeout: int = 30) -> dict[str, Any]:
    code = code or ""
    if not code.strip():
        raise PCError("No code to run")
    runner = _runner(language)
    if not runner:
        norm = {"js": "javascript", "node": "javascript", "ts": "typescript", "ps1": "powershell", "pwsh": "powershell",
                "bat": "batch", "cmd": "batch", "sh": "bash", "shell": "bash", "zsh": "bash"}.get(language.lower(), language.lower())
        need = _NEEDS.get(norm)
        raise PCError(f"Running {language} needs {need}, which isn't installed." if need else f"Can't run {language} code yet.")
    name, cmd = runner
    if name == "main.py" and GUI_HINT.search(code):
        return _run_window(code)
    with tempfile.TemporaryDirectory(prefix="athena-run-") as tmp:
        folder = Path(tmp)
        (folder / name).write_text(code, encoding="utf-8", newline="\r\n" if name.endswith(".bat") else None)
        if name == "main.py" and ("matplotlib" in code or "plt." in code):
            (folder / "_athena_run.py").write_text(_PLOT_HOOK, encoding="utf-8")
            cmd = [sys.executable, "_athena_run.py"]
        env = {**os.environ, "PYTHONIOENCODING": "utf-8", "MPLBACKEND": "Agg", "NO_COLOR": "1"}
        try:
            r = subprocess.run(cmd, cwd=tmp, capture_output=True, text=True, timeout=timeout, env=env,
                               encoding="utf-8", errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except subprocess.TimeoutExpired as exc:
            out = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
            return {"timed_out": True, "seconds": timeout, "stdout": out[-6000:], "images": _collect_images(folder)}
        images = _collect_images(folder)
        r.stderr = r.stderr.replace(str(folder) + os.sep, "")
    result: dict[str, Any] = {"exit_code": r.returncode, "stdout": r.stdout[-8000:], "stderr": _clean_trace(r.stderr)[-6000:]}
    if images:
        result["images"] = images
    missing = re.search(r"No module named '([\w.]+)'", result["stderr"])
    if missing:
        result["tip"] = _install_tip(missing.group(1))
    return result


# Python import name -> pip package name, when they differ.
PIP_NAMES = {"cv2": "opencv-python", "PIL": "pillow", "sklearn": "scikit-learn", "bs4": "beautifulsoup4", "yaml": "pyyaml"}


# Programs that open their own window (games, apps, drawings). These keep running until you close them,
# so they aren't cut off by the time limit, and the window pops up on your PC.
GUI_HINT = re.compile(r"^\s*(import|from)\s+(tkinter|pygame|turtle|pyglet|arcade|kivy|PyQt5|PyQt6|PySide6|customtkinter|ursina|wx)\b", re.M)


def _run_window(code: str) -> dict[str, Any]:
    import time

    from . import store

    runs = store.DATA_DIR / "runs"
    folder = runs / time.strftime("%Y%m%d-%H%M%S")
    folder.mkdir(parents=True, exist_ok=True)
    for old in sorted(p for p in runs.iterdir() if p.is_dir())[:-20]:  # keep the 20 most recent
        shutil.rmtree(old, ignore_errors=True)
    (folder / "main.py").write_text(code, encoding="utf-8")
    log = open(folder / "output.txt", "w", encoding="utf-8")
    exe = Path(sys.executable)
    windowed = exe.with_name("pythonw.exe")  # no black console window next to the app on Windows
    flags = 0x00000008 | 0x00000200 if os.name == "nt" else 0  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    proc = subprocess.Popen([str(windowed if windowed.exists() else exe), "main.py"], cwd=folder, stdout=log, stderr=subprocess.STDOUT,
                            env={**os.environ, "PYTHONIOENCODING": "utf-8"}, creationflags=flags, start_new_session=os.name != "nt")
    try:
        code_ = proc.wait(timeout=3)  # did it crash straight away (e.g. a missing package)?
    except subprocess.TimeoutExpired:
        return {"opened_window": True, "message": "It's running in its own window on your PC. Close the window when you're done."}
    finally:
        log.close()
    out = (folder / "output.txt").read_text(encoding="utf-8", errors="replace").replace(str(folder) + os.sep, "")
    result: dict[str, Any] = {"exit_code": code_, "stdout": "" if code_ else out[-8000:], "stderr": out[-6000:] if code_ else ""}
    missing = re.search(r"No module named '([\w.]+)'", out)
    if missing:
        result["tip"] = _install_tip(missing.group(1))
    return result


def _install_tip(module: str) -> str:
    name = module.split(".")[0]
    if name in ("tkinter", "_tkinter", "turtle"):
        return "tkinter comes with Python: run the Python installer again, choose Modify, and tick \"tcl/tk and IDLE\"."
    pkg = PIP_NAMES.get(name, name)
    return f'This needs the {pkg} package. Install it with:  "{sys.executable}" -m pip install {pkg}'


def _clean_trace(err: str) -> str:
    """Hide the plotting helper's own frames from Python tracebacks."""
    lines = err.splitlines(keepends=True)
    out, skip = [], False
    for line in lines:
        if line.startswith('  File "') and ("_athena_run.py" in line or "runpy" in line):
            skip = True
            continue
        if skip and line.startswith("    "):
            continue
        skip = False
        out.append(line)
    return "".join(out)


def run_python(code: str, timeout: int = 30) -> dict[str, Any]:
    return run_code(code, "python", timeout)


# ------------------------------------------------------------ websites

SITES = {
    "youtube": ("https://www.youtube.com", "https://www.youtube.com/results?search_query={q}"),
    "google": ("https://www.google.com", "https://www.google.com/search?q={q}"),
    "gmail": ("https://mail.google.com", "https://mail.google.com/mail/u/0/#search/{q}"),
    "netflix": ("https://www.netflix.com", "https://www.netflix.com/search?q={q}"),
    "twitch": ("https://www.twitch.tv", "https://www.twitch.tv/search?term={q}"),
    "spotify": ("https://open.spotify.com", "https://open.spotify.com/search/{q}"),
    "reddit": ("https://www.reddit.com", "https://www.reddit.com/search/?q={q}"),
    "amazon": ("https://www.amazon.com", "https://www.amazon.com/s?k={q}"),
    "wikipedia": ("https://www.wikipedia.org", "https://en.wikipedia.org/w/index.php?search={q}"),
    "maps": ("https://www.google.com/maps", "https://www.google.com/maps/search/{q}"),
    "google maps": ("https://www.google.com/maps", "https://www.google.com/maps/search/{q}"),
    "tiktok": ("https://www.tiktok.com", "https://www.tiktok.com/search?q={q}"),
    "instagram": ("https://www.instagram.com", "https://www.instagram.com/explore/search/keyword/?q={q}"),
    "x": ("https://x.com", "https://x.com/search?q={q}"), "twitter": ("https://x.com", "https://x.com/search?q={q}"),
    "facebook": ("https://www.facebook.com", "https://www.facebook.com/search/top?q={q}"),
    "ebay": ("https://www.ebay.com", "https://www.ebay.com/sch/i.html?_nkw={q}"),
    "github": ("https://github.com", "https://github.com/search?q={q}"),
    "roblox": ("https://www.roblox.com", "https://www.roblox.com/discover/?Keyword={q}"),
    "pinterest": ("https://www.pinterest.com", "https://www.pinterest.com/search/pins/?q={q}"),
    "soundcloud": ("https://soundcloud.com", "https://soundcloud.com/search?q={q}"),
    "quizlet": ("https://quizlet.com", "https://quizlet.com/search?query={q}"),
    "disney plus": ("https://www.disneyplus.com", None), "hulu": ("https://www.hulu.com", None),
    "crunchyroll": ("https://www.crunchyroll.com", "https://www.crunchyroll.com/search?q={q}"),
}


def open_website(site: str, search: str = "") -> dict[str, Any]:
    """Open a website in the default browser: a known site by name ('YouTube'), any address, and
    optionally search it ('YouTube' + 'lofi beats' opens the YouTube results)."""
    from urllib.parse import quote_plus

    raw = (site or "").strip()
    if not raw:
        raise PCError("Which website?")
    key = re.sub(r"\s+", " ", raw.lower()).removesuffix(".com").removeprefix("www.").strip()
    home, search_url = SITES.get(key, (None, None))
    if raw.startswith(("http://", "https://")):
        url = raw
    elif home:
        url = search_url.format(q=quote_plus(search)) if search and search_url else home
    elif "." in raw and " " not in raw:
        url = "https://" + raw
    else:
        url = f"https://www.{re.sub(r'[^a-z0-9-]', '', key)}.com"
    if search and not (home and search_url) and not raw.startswith("http"):
        url = f"https://www.google.com/search?q={quote_plus(search + ' ' + raw)}"
    webbrowser.open(url)
    return {"opened": url}
