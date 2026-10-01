"""Athena as a desktop app: a system-tray icon, a global hotkey, "Hey Athena", and start-with-Windows.

Athena opens in her own window (Edge or Chrome in app mode — no tabs or address bar).
Run with:  python -m athena --desktop   (or double-click start-desktop.bat)
"""
from __future__ import annotations

import ctypes
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Any

from . import store

WIN = sys.platform.startswith("win")
MAC = sys.platform == "darwin"
TITLE = "Athena AI"
PROFILE_DIR = store.DATA_DIR / "browser-profile"
ICON_FILE = store.DATA_DIR / "athena.ico"
running = {"active": False}


# ------------------------------------------------------------------ icon

def make_icon(size: int = 64):
    """Draw the gold spearhead A + spark (same shape as the logo) with Pillow."""
    from PIL import Image, ImageDraw

    s = size / 44.0  # logo viewBox is 44 units wide, starting at (10, 9)
    P = lambda x, y: ((x - 10) * s, (y - 9) * s)  # noqa: E731
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    gold, width = (245, 197, 66, 255), max(2, round(7 * s))
    pts = [P(17, 49), P(32, 13), P(47, 49)]
    d.line(pts, fill=gold, width=width, joint="curve")
    for x, y in pts:
        r = width / 2
        d.ellipse([x - r, y - r, x + r, y + r], fill=gold)
    d.polygon([P(32, 31), P(33.2, 36.8), P(38, 38), P(33.2, 39.2), P(32, 45), P(30.8, 39.2), P(26, 38), P(30.8, 36.8)], fill=(255, 217, 112, 255))
    return img


def ensure_ico() -> Path:
    if not ICON_FILE.exists():
        ICON_FILE.parent.mkdir(parents=True, exist_ok=True)
        make_icon(256).save(ICON_FILE, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    return ICON_FILE


# --------------------------------------------------------------- browser

def find_browser() -> str | None:
    if WIN:
        env = os.environ
        candidates = [
            Path(env.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / r"Microsoft\Edge\Application\msedge.exe",
            Path(env.get("ProgramFiles", r"C:\Program Files")) / r"Microsoft\Edge\Application\msedge.exe",
            Path(env.get("ProgramFiles", r"C:\Program Files")) / r"Google\Chrome\Application\chrome.exe",
            Path(env.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / r"Google\Chrome\Application\chrome.exe",
            Path(env.get("LOCALAPPDATA", "")) / r"Google\Chrome\Application\chrome.exe",
        ]
    elif MAC:
        candidates = [Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
                      Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]
    else:
        candidates = [Path(p) for p in map(shutil.which, ("microsoft-edge", "google-chrome", "chromium", "chromium-browser")) if p]
    return next((str(c) for c in candidates if c.exists()), None)


def _windows_with_title(title: str) -> list[int]:
    user32 = ctypes.windll.user32  # type: ignore[attr-defined]
    found: list[int] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)  # type: ignore[attr-defined]
    def enum(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            n = user32.GetWindowTextLengthW(hwnd)
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            if buf.value == title or buf.value.startswith(title + " "):
                found.append(hwnd)
        return True

    user32.EnumWindows(enum, 0)
    return found


def _bring_to_front(hwnd: int) -> None:
    user32 = ctypes.windll.user32  # type: ignore[attr-defined]
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.keybd_event(0x12, 0, 0, 0)  # tap Alt so Windows lets us take focus
    user32.keybd_event(0x12, 0, 2, 0)
    user32.SetForegroundWindow(hwnd)


class DesktopApp:
    def __init__(self, url: str):
        self.url = url
        self.proc: subprocess.Popen | None = None
        self.icon = None
        self.browser = find_browser()

    def window_open(self) -> bool:
        if WIN:
            return bool(_windows_with_title(TITLE))
        return bool(self.proc and self.proc.poll() is None)

    def show(self, voice: bool = False) -> None:
        from . import events

        if WIN:
            windows = _windows_with_title(TITLE)
            if windows:
                _bring_to_front(windows[0])
                if voice:
                    events.publish("start_voice")
                return
        elif self.proc and self.proc.poll() is None:
            if voice:
                events.publish("start_voice")
            return
        url = self.url + ("?voice=1" if voice else "")
        if not self.browser:
            webbrowser.open(url)
            return
        PROFILE_DIR.mkdir(parents=True, exist_ok=True)
        self.proc = subprocess.Popen([
            self.browser, f"--app={url}", f"--user-data-dir={PROFILE_DIR}", "--window-size=1150,820",
            "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream",  # auto-allow the mic for Athena
            "--no-first-run", "--no-default-browser-check", "--disable-features=Translate",
        ])

    def notify(self, text: str, title: str = TITLE) -> None:
        try:
            if self.icon is not None:
                self.icon.notify(text, title)
        except Exception:
            pass

    def close_window(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()


# --------------------------------------------------------------- startup

def _startup_file() -> Path:
    return Path(os.environ.get("APPDATA", "")) / r"Microsoft\Windows\Start Menu\Programs\Startup\Athena AI.vbs"


def _pythonw() -> str:
    exe = Path(sys.executable)
    w = exe.with_name("pythonw.exe")
    return str(w if w.exists() else exe)


def autostart_enabled() -> bool:
    return WIN and _startup_file().exists()


def set_autostart(enabled: bool) -> bool:
    if not WIN:
        raise RuntimeError("Start with Windows is only available on Windows")
    f = _startup_file()
    if enabled:
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(
            'Set sh = CreateObject("WScript.Shell")\r\n'
            f'sh.CurrentDirectory = "{store.ROOT}"\r\n'
            f'sh.Run """{_pythonw()}"" -m athena --desktop --hidden", 0, False\r\n', encoding="utf-8")
    elif f.exists():
        f.unlink()
    return autostart_enabled()


EXE = store.ROOT / "Athena.exe"


def build_exe() -> dict[str, Any]:
    """Make Athena.exe (a double-click app with her icon) in the Athena folder, then point the shortcuts at it."""
    if not WIN:
        return {"error": "Athena.exe can only be made on Windows"}
    py = Path(sys.executable)
    py = py.with_name("python.exe") if py.name.lower() == "pythonw.exe" else py
    work = store.DATA_DIR / "exe-build"
    try:
        subprocess.run([str(py), "-m", "pip", "install", "-q", "pyinstaller"], capture_output=True, text=True,
                       creationflags=0x08000000, timeout=600, check=True)
        r = subprocess.run([str(py), "-m", "PyInstaller", "--onefile", "--noconsole", "--noconfirm", "--name", "Athena",
                            "--icon", str(ensure_ico()), "--distpath", str(store.ROOT), "--workpath", str(work / "build"),
                            "--specpath", str(work), str(store.ROOT / "launcher" / "athena_launcher.py")],
                           capture_output=True, text=True, creationflags=0x08000000, timeout=900, cwd=str(store.ROOT))
    except (subprocess.SubprocessError, OSError) as exc:
        return {"error": f"Couldn't make Athena.exe: {exc}"}
    if r.returncode != 0 or not EXE.exists():
        return {"error": "Couldn't make Athena.exe: " + " ".join((r.stderr or r.stdout).strip().splitlines()[-3:])}
    shutil.rmtree(work, ignore_errors=True)
    try:
        made = create_shortcuts()
    except Exception:  # noqa: BLE001
        made = []
    return {"exe": str(EXE), "shortcuts": made,
            "note": f"Made {EXE}. Double-click it (or the Athena AI shortcut on your Desktop) to open Athena."}


def ensure_exe_once() -> None:
    """First start on Windows: make Athena.exe and a Desktop shortcut by herself (once; a button redoes it)."""
    flag = store.DATA_DIR / "exe-made"
    if not WIN or EXE.exists() or flag.exists():
        return
    try:
        flag.parent.mkdir(parents=True, exist_ok=True)
        flag.write_text(time.strftime("%Y-%m-%d"), encoding="utf-8")
        build_exe()
    except Exception:  # noqa: BLE001  # a convenience: never let it stop Athena
        pass


def create_shortcuts() -> list[str]:
    """Put 'Athena AI' shortcuts on the Desktop and in the Start menu (Windows)."""
    if not WIN:
        raise RuntimeError("Shortcuts can only be created on Windows")
    icon = ensure_ico()
    places = [Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Desktop",
              Path(os.environ.get("APPDATA", "")) / r"Microsoft\Windows\Start Menu\Programs"]
    made = []
    for place in places:
        if not place.is_dir():
            continue
        lnk = place / "Athena AI.lnk"
        target, args = (str(EXE), "") if EXE.exists() else (_pythonw(), "-m athena --desktop")  # Athena.exe once it's made
        ps = (f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{lnk}');"
              f"$s.TargetPath='{target}';$s.Arguments='{args}';"
              f"$s.WorkingDirectory='{store.ROOT}';$s.IconLocation='{icon}';"
              "$s.Description='Athena AI — your offline assistant';$s.Save()")
        r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
                           capture_output=True, text=True, creationflags=0x08000000)
        if r.returncode == 0:
            made.append(str(lnk))
    return made


def refresh_shortcuts() -> None:
    """If Athena's shortcuts exist, rewrite them so they start THIS copy of Athena (after a re-download or move)."""
    try:
        places = [Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Desktop",
                  Path(os.environ.get("APPDATA", "")) / r"Microsoft\Windows\Start Menu\Programs"]
        if any((p / "Athena AI.lnk").exists() for p in places):
            create_shortcuts()
    except Exception:
        pass  # a shortcut is a convenience; never let it stop Athena


# ------------------------------------------------------------------ main

def _port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


VK = {"ctrl": 0x11, "shift": 0x10, "alt": 0x12, "cmd": 0x5B}


def _keys_really_down(combo: str) -> bool:
    """Games often swallow key-up events, so the listener can think Ctrl is still held and fire on plain Space.
    Ask Windows whether the modifier keys are actually down right now."""
    if not WIN:
        return True
    user32 = ctypes.windll.user32
    for mod, vk in VK.items():
        if f"<{mod}>" in combo.lower() and not (user32.GetAsyncKeyState(vk) & 0x8000):
            if mod == "cmd" and user32.GetAsyncKeyState(0x5C) & 0x8000:  # right Windows key
                continue
            return False
    return True


def _fullscreen_app_in_front() -> bool:
    """True when something fullscreen (a game, a video) that isn't Athena is in front."""
    if not WIN:
        return False
    try:
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        if not hwnd or hwnd in (user32.GetDesktopWindow(), user32.GetShellWindow()):
            return False
        title = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(hwnd, title, 256)
        if TITLE.lower() in title.value.lower():
            return False
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))

        class MONITORINFO(ctypes.Structure):
            _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]

        info = MONITORINFO()
        info.cbSize = ctypes.sizeof(MONITORINFO)
        monitor = user32.MonitorFromWindow(hwnd, 2)
        if not user32.GetMonitorInfoW(monitor, ctypes.byref(info)):
            return False
        m = info.rcMonitor
        return rect.left <= m.left and rect.top <= m.top and rect.right >= m.right and rect.bottom >= m.bottom
    except Exception:
        return False


def _guarded(combo: str, action):
    """Run a hotkey's action only if its keys are really held, and never over a fullscreen game."""
    def run() -> None:
        if _keys_really_down(combo) and not _fullscreen_app_in_front():
            action()
    return run


def _hotkey_listener(app: DesktopApp):
    try:
        from pynput import keyboard
    except ImportError:
        return None
    s = store.get_settings()
    mapping: dict[str, Any] = {}
    if s.get("hotkey"):
        mapping[s["hotkey"]] = _guarded(s["hotkey"], lambda: app.show())
    if s.get("voice_hotkey"):
        mapping[s["voice_hotkey"]] = _guarded(s["voice_hotkey"], lambda: app.show(voice=True))
    try:
        listener = keyboard.GlobalHotKeys(mapping)
        listener.start()
        return listener
    except Exception:
        return None


def main(host: str = "127.0.0.1", port: int = 8765, hidden: bool = False) -> None:
    import uvicorn

    from . import scheduler, server, wake

    url = f"http://localhost:{port}/"
    app = DesktopApp(url)
    running["active"] = True

    if _port_open(port):  # Athena is already running — just show her
        app.show()
        return

    # Hook Athena's background features into the desktop.
    wake.on_wake.append(lambda command: app.show(voice=True) if not app.window_open() else app.show())
    scheduler.on_fire.append(lambda r: None if app.window_open() else app.notify(f"⏰ {r['text']}", "Athena reminder"))

    config = uvicorn.Config(server.app, host=host, port=port, log_level="warning")
    srv = uvicorn.Server(config)
    threading.Thread(target=srv.run, daemon=True, name="athena-server").start()
    if host not in ("127.0.0.1", "localhost"):  # phone access: a secure address too, so the phone's mic works
        from .phone import https_server

        secure = https_server(server.app, host, port)
        if secure:
            threading.Thread(target=secure.run, daemon=True, name="athena-https").start()
    for _ in range(100):
        if _port_open(port):
            break
        time.sleep(0.1)

    hotkeys = [_hotkey_listener(app)]
    server.settings_hooks.append(lambda s: (hotkeys[0] and hotkeys[0].stop(), hotkeys.__setitem__(0, _hotkey_listener(app))))
    if not hidden:
        app.show()

    try:
        import pystray
    except ImportError:
        print(f"\n  Athena AI is running at {url}  (install 'pystray' for the tray icon)\n  Press Ctrl+C to stop.\n")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        srv.should_exit = True
        return

    def quit_app(icon, _item):
        srv.should_exit = True
        wake.stop()
        app.close_window()
        icon.stop()

    def toggle_autostart(_icon, _item):
        try:
            set_autostart(not autostart_enabled())
        except RuntimeError:
            pass

    hotkey = (store.get_settings().get("hotkey") or "").replace("<", "").replace(">", "").title()
    menu = pystray.Menu(
        pystray.MenuItem(f"Open Athena   {hotkey}", lambda: app.show(), default=True),
        pystray.MenuItem("Talk to Athena", lambda: app.show(voice=True)),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Start with Windows", toggle_autostart, checked=lambda _i: autostart_enabled(), visible=WIN),
        pystray.MenuItem("Quit Athena", quit_app),
    )
    app.icon = pystray.Icon("athena", make_icon(64), TITLE, menu)
    app.icon.run()
