"""Jarvis-style control of the PC: windows, monitors, typing, keyboard shortcuts and clicks.

Uses the Windows API directly through ctypes (no extra installs). Other systems get a clear
"Windows only" message, except where noted.
"""
from __future__ import annotations

import ctypes
import difflib
import re
import sys
import time
from ctypes import wintypes
from typing import Any

WIN = sys.platform.startswith("win")


class ControlError(Exception):
    pass


def _need_windows() -> None:
    if not WIN:
        raise ControlError("This only works on Windows")


if WIN:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    # Window handles are pointer-sized; without these, big handles on 64-bit Windows would overflow.
    H = wintypes.HWND
    for _name, _args in {
        "ShowWindow": [H, ctypes.c_int], "SetForegroundWindow": [H], "BringWindowToTop": [H], "IsIconic": [H], "IsZoomed": [H],
        "IsWindowVisible": [H], "GetWindow": [H, wintypes.UINT], "GetWindowLongW": [H, ctypes.c_int],
        "GetWindowTextLengthW": [H], "GetWindowTextW": [H, wintypes.LPWSTR, ctypes.c_int],
        "GetWindowThreadProcessId": [H, ctypes.POINTER(wintypes.DWORD)], "GetWindowRect": [H, ctypes.POINTER(wintypes.RECT)],
        "PostMessageW": [H, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM],
        "SetWindowPos": [H, H, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT],
    }.items():
        getattr(user32, _name).argtypes = _args
    user32.GetWindow.restype = H
    try:  # real pixel coordinates on high-DPI screens (so clicks land where the screenshot says)
        ctypes.WinDLL("shcore").SetProcessDpiAwareness(2)
    except Exception:
        try:
            user32.SetProcessDPIAware()
        except Exception:
            pass

# ------------------------------------------------------------------ input structures (SendInput)

ULONG_PTR = ctypes.c_size_t


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]


class _INPUTUNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("u", _INPUTUNION)]


INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
KEYUP, UNICODE, EXTENDED = 0x0002, 0x0004, 0x0001

VK = {
    "ctrl": 0x11, "control": 0x11, "shift": 0x10, "alt": 0x12, "win": 0x5B, "windows": 0x5B, "cmd": 0x5B, "super": 0x5B,
    "enter": 0x0D, "return": 0x0D, "tab": 0x09, "esc": 0x1B, "escape": 0x1B, "space": 0x20, "backspace": 0x08,
    "delete": 0x2E, "del": 0x2E, "insert": 0x2D, "home": 0x24, "end": 0x23, "pageup": 0x21, "pagedown": 0x22,
    "up": 0x26, "down": 0x28, "left": 0x25, "right": 0x27, "printscreen": 0x2C, "capslock": 0x14,
    "volumeup": 0xAF, "volumedown": 0xAE, "mute": 0xAD, "playpause": 0xB3, "nexttrack": 0xB0, "prevtrack": 0xB1,
    "menu": 0x5D, "plus": 0xBB, "minus": 0xBD, "comma": 0xBC, "period": 0xBE, "slash": 0xBF,
}
VK.update({f"f{i}": 0x6F + i for i in range(1, 25)})
EXTENDED_KEYS = {0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5D}
MODIFIERS = {0x11, 0x10, 0x12, 0x5B}


def parse_combo(combo: str) -> list[int]:
    """'ctrl+shift+t' -> [VK_CONTROL, VK_SHIFT, 'T']. Raises for unknown keys."""
    keys = []
    for part in re.split(r"\s*\+\s*", combo.strip().lower()):
        part = part.replace(" ", "")
        if not part:
            continue
        if part in VK:
            keys.append(VK[part])
        elif len(part) == 1 and part.isalnum():
            keys.append(ord(part.upper()))
        else:
            raise ControlError(f"Unknown key '{part}'")
    if not keys:
        raise ControlError("No keys given")
    return keys


def _send(inputs: list[INPUT]) -> None:
    arr = (INPUT * len(inputs))(*inputs)
    if user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT)) != len(inputs):
        raise ControlError("Windows blocked the keyboard/mouse input (is an admin app or the lock screen in front?)")


def _key(vk: int, up: bool = False) -> INPUT:
    flags = (KEYUP if up else 0) | (EXTENDED if vk in EXTENDED_KEYS else 0)
    return INPUT(type=INPUT_KEYBOARD, u=_INPUTUNION(ki=KEYBDINPUT(wVk=vk, wScan=0, dwFlags=flags, time=0, dwExtraInfo=0)))


def press_keys(keys: str, times: int = 1) -> dict[str, Any]:
    """Press a shortcut like 'ctrl+c', 'alt+tab', 'win+d' or a single key like 'enter'."""
    _need_windows()
    combos = [c for c in re.split(r"\s*,\s*|\s+then\s+", keys.strip()) if c]
    for combo in combos:
        vks = parse_combo(combo)
        for _ in range(max(1, min(int(times or 1), 50))):
            _send([_key(v) for v in vks] + [_key(v, up=True) for v in reversed(vks)])
            time.sleep(0.05)
        time.sleep(0.12)
    return {"pressed": combos}


def type_text(text: str, newline: str = "shift+enter") -> dict[str, Any]:
    """Type any text (emoji and accents included) into whatever has focus."""
    _need_windows()
    text = str(text or "")
    if not text:
        raise ControlError("Nothing to type")
    lines = text.replace("\r\n", "\n").split("\n")
    for i, line in enumerate(lines):
        units = line.encode("utf-16-le")
        batch = []
        for j in range(0, len(units), 2):
            code = int.from_bytes(units[j:j + 2], "little")
            for up in (False, True):
                batch.append(INPUT(type=INPUT_KEYBOARD, u=_INPUTUNION(ki=KEYBDINPUT(
                    wVk=0, wScan=code, dwFlags=UNICODE | (KEYUP if up else 0), time=0, dwExtraInfo=0))))
        for k in range(0, len(batch), 200):  # chunks keep slow apps from dropping keys
            _send(batch[k:k + 200])
            time.sleep(0.01)
        if i < len(lines) - 1:
            press_keys(newline)
    return {"typed_characters": len(text)}


def click(x: int, y: int, button: str = "left", double: bool = False) -> dict[str, Any]:
    """Click at real screen coordinates."""
    _need_windows()
    down, upf = {"left": (0x0002, 0x0004), "right": (0x0008, 0x0010), "middle": (0x0020, 0x0040)}.get(button, (0x0002, 0x0004))
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.05)
    for _ in range(2 if double else 1):
        _send([INPUT(type=INPUT_MOUSE, u=_INPUTUNION(mi=MOUSEINPUT(dx=0, dy=0, mouseData=0, dwFlags=f, time=0, dwExtraInfo=0)))
               for f in (down, upf)])
        time.sleep(0.08)
    return {"clicked": [int(x), int(y)], "button": button, "double": bool(double)}


def scroll(amount: int) -> dict[str, Any]:
    """Scroll the mouse wheel: positive = up, negative = down (in notches)."""
    _need_windows()
    _send([INPUT(type=INPUT_MOUSE, u=_INPUTUNION(mi=MOUSEINPUT(dx=0, dy=0, mouseData=ctypes.c_ulong(int(amount) * 120).value,
                                                              dwFlags=0x0800, time=0, dwExtraInfo=0)))])
    return {"scrolled": int(amount)}


# ------------------------------------------------------------------ windows

def _process_name(pid: int) -> str:
    try:
        import psutil

        return psutil.Process(pid).name()
    except Exception:
        return ""


def list_windows() -> list[dict[str, Any]]:
    """Visible app windows (skips tool windows, hidden and cloaked ones)."""
    _need_windows()
    found: list[dict[str, Any]] = []
    dwmapi = ctypes.WinDLL("dwmapi")
    proc_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def handle(hwnd, _lparam):
        if not hwnd or not user32.IsWindowVisible(hwnd) or user32.GetWindow(hwnd, 4):  # 4 = GW_OWNER: skip dialogs owned by another window
            return True
        if user32.GetWindowLongW(hwnd, -20) & 0x80:  # WS_EX_TOOLWINDOW
            return True
        cloaked = wintypes.DWORD()
        dwmapi.DwmGetWindowAttribute(wintypes.HWND(hwnd), 14, ctypes.byref(cloaked), ctypes.sizeof(cloaked))
        if cloaked.value:
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if not length:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        found.append({"hwnd": int(hwnd), "title": buf.value, "app": _process_name(pid.value).removesuffix(".exe"), "pid": pid.value,
                      "minimized": bool(user32.IsIconic(hwnd)), "maximized": bool(user32.IsZoomed(hwnd)),
                      "rect": [rect.left, rect.top, rect.right, rect.bottom]})
        return True

    user32.EnumWindows(proc_type(handle), 0)
    return [w for w in found if w["title"] not in ("Program Manager", "Windows Input Experience")]


def match_windows(query: str, windows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Windows whose app name or title matches what the user said ("discord", "chrome", "my essay")."""
    q = re.sub(r"[^a-z0-9 ]", "", query.lower()).strip()
    if not q:
        return []
    q = {"google chrome": "chrome", "edge": "msedge", "microsoft edge": "msedge", "file explorer": "explorer", "files": "explorer",
         "vs code": "code", "vscode": "code", "visual studio code": "code", "word": "winword", "excel": "excel", "powerpoint": "powerpnt",
         "terminal": "windowsterminal", "task manager": "taskmgr"}.get(q, q)
    exact = [w for w in windows if w["app"].lower() == q]
    if exact:
        return exact
    loose = [w for w in windows if q in w["app"].lower() or q in w["title"].lower()]
    if loose:
        return loose
    names = {w["app"].lower() for w in windows}
    close = difflib.get_close_matches(q, list(names), n=1, cutoff=0.7)
    return [w for w in windows if close and w["app"].lower() == close[0]]


def _find(query: str) -> list[dict[str, Any]]:
    wins = match_windows(query, list_windows())
    if not wins:
        raise ControlError(f"No open window matches '{query}'. Is it open?")
    return wins


def monitors() -> list[dict[str, Any]]:
    """Screens, primary first, then left to right. 'work' excludes the taskbar."""
    _need_windows()

    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]

    found = []
    proc_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)

    def handle(hmon, _hdc, _rect, _lparam):
        info = MONITORINFO(cbSize=ctypes.sizeof(MONITORINFO))
        user32.GetMonitorInfoW(hmon, ctypes.byref(info))
        m, w = info.rcMonitor, info.rcWork
        found.append({"primary": bool(info.dwFlags & 1), "rect": [m.left, m.top, m.right, m.bottom], "work": [w.left, w.top, w.right, w.bottom]})
        return True

    user32.EnumDisplayMonitors(None, None, proc_type(handle), 0)
    found.sort(key=lambda m: (not m["primary"], m["rect"][0]))
    for i, m in enumerate(found, 1):
        m["number"] = i
    return found


def _focus(hwnd: int) -> None:
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    # Windows only lets the app in front hand over focus; a quick Alt tap makes our request count.
    user32.keybd_event(0x12, 0, 0, 0)
    user32.keybd_event(0x12, 0, 2, 0)
    user32.SetForegroundWindow(hwnd)
    user32.BringWindowToTop(hwnd)


def focus_app(app: str, wait: float = 0) -> dict[str, Any]:
    """Bring an app to the front. With wait>0, keep looking for up to that many seconds (e.g. right after opening it)."""
    _need_windows()
    deadline = time.time() + max(0.0, float(wait))
    while True:
        try:
            win = _find(app)[0]
            break
        except ControlError:
            if time.time() >= deadline:
                raise
            time.sleep(0.5)
    _focus(win["hwnd"])
    time.sleep(0.3)
    return {"focused": win["title"], "app": win["app"]}


WINDOW_ACTIONS = ("focus", "minimize", "maximize", "restore", "close", "move", "left", "right", "fullscreen")


def window_control(action: str, app: str = "", monitor: int | None = None) -> dict[str, Any]:
    """Focus, minimize, maximize, restore, close, or move a window (to another monitor, or snap left/right)."""
    _need_windows()
    action = (action or "").lower().strip()
    if action in ("minimize_all", "show_desktop", "minimize everything"):
        press_keys("win+m")
        return {"minimized_all": True}
    if action in ("list", "list_windows"):
        return {"windows": [{"app": w["app"], "title": w["title"][:80], "minimized": w["minimized"]} for w in list_windows()][:40],
                "monitors": len(monitors())}
    if not app:
        raise ControlError("Which app's window?")
    wins = _find(app)
    if action == "close":
        for w in wins:
            user32.PostMessageW(w["hwnd"], 0x0010, 0, 0)  # WM_CLOSE: asks nicely, so apps can offer to save
        return {"closed": [w["title"][:60] for w in wins]}
    win = wins[0]
    hwnd = win["hwnd"]
    if action == "focus":
        _focus(hwnd)
    elif action == "minimize":
        for w in wins:
            user32.ShowWindow(w["hwnd"], 6)
    elif action in ("maximize", "fullscreen"):
        user32.ShowWindow(hwnd, 3)
        _focus(hwnd)
    elif action == "restore":
        user32.ShowWindow(hwnd, 9)
        _focus(hwnd)
    elif action in ("move", "left", "right"):
        mons = monitors()
        if monitor is not None:
            if not 1 <= int(monitor) <= len(mons):
                raise ControlError(f"There {'is' if len(mons) == 1 else 'are'} {len(mons)} monitor{'s' if len(mons) != 1 else ''}")
            target = mons[int(monitor) - 1]
        else:  # the monitor the window is on now
            cx = (win["rect"][0] + win["rect"][2]) // 2
            target = next((m for m in mons if m["rect"][0] <= cx < m["rect"][2]), mons[0])
        left, top, right, bottom = target["work"]
        w, h = right - left, bottom - top
        user32.ShowWindow(hwnd, 9)
        if action == "left":
            user32.SetWindowPos(hwnd, 0, left, top, w // 2, h, 0x0044)
        elif action == "right":
            user32.SetWindowPos(hwnd, 0, left + w // 2, top, w - w // 2, h, 0x0044)
        else:  # move to that monitor and fill it
            user32.SetWindowPos(hwnd, 0, left + 40, top + 40, max(400, w - 80), max(300, h - 80), 0x0044)
            if win["maximized"] or monitor is not None:
                user32.ShowWindow(hwnd, 3)
        _focus(hwnd)
    else:
        raise ControlError(f"Unknown window action '{action}'. Use: {', '.join(WINDOW_ACTIONS)}, minimize_all or list")
    return {"done": action, "window": win["title"][:80], "app": win["app"], **({"monitor": monitor} if monitor else {})}


def close_app(app: str) -> dict[str, Any]:
    return window_control("close", app)
