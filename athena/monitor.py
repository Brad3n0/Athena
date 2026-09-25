"""Heads-ups: Athena speaks up on her own when something needs your attention.

A download finished, the PC is struggling (CPU maxed, memory full, graphics card hot), a drive is
nearly full, the battery is low, or a reminder is coming up. Each kind has a cooldown so she never nags.
"""
from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any

from . import events, store

PARTIAL = (".crdownload", ".part", ".partial", ".tmp", ".download", ".opdownload", ".!ut", ".aria2")
CHECK_EVERY = 5  # seconds
COOLDOWN = {"download": 0, "cpu": 20 * 60, "memory": 20 * 60, "gpu_temp": 15 * 60, "disk": 12 * 3600, "battery": 30 * 60, "reminder": 0}

_last: dict[str, float] = {}
_thread: threading.Thread | None = None


def _settings() -> dict[str, Any]:
    return store.get_settings()


def _say(kind: str, text: str, key: str | None = None) -> None:
    """Send a heads-up to the Athena window (it shows it, and speaks it if you turned that on)."""
    s = _settings()
    if not s.get("alerts_enabled", True) or not s.get(f"alert_{kind}", True):
        return
    k = key or kind
    now = time.time()
    if now - _last.get(k, 0) < COOLDOWN.get(kind, 600):
        return
    _last[k] = now
    events.publish("alert", category=kind, text=text, speak=bool(s.get("alerts_speak", True)))


def _downloads_dir() -> Path | None:
    home = Path.home()
    for p in (home / "Downloads", home / "OneDrive" / "Downloads"):
        if p.is_dir():
            return p
    return None


class _Downloads:
    """Notices files that appear in Downloads and stop growing (skipping browsers' partial files)."""

    def __init__(self) -> None:
        self.folder = _downloads_dir()
        self.known = self._scan()
        self.pending: dict[str, int] = {}

    def _scan(self) -> dict[str, int]:
        if not self.folder:
            return {}
        out = {}
        try:
            for f in self.folder.iterdir():
                if f.is_file() and not f.name.lower().endswith(PARTIAL) and not f.name.startswith(("~$", ".")):
                    out[f.name] = f.stat().st_size
        except OSError:
            pass
        return out

    def check(self) -> None:
        now = self._scan()
        for name, size in now.items():
            if name in self.known:
                continue
            if self.pending.get(name) == size and size > 0:  # same size as last check: finished
                self.known[name] = size
                self.pending.pop(name, None)
                _say("download", f"Your download finished: {name}", key=f"dl:{name}")
            else:
                self.pending[name] = size
        for gone in set(self.known) - set(now):
            self.known.pop(gone, None)


def _check_health(state: dict[str, Any]) -> None:
    import psutil

    cpu = psutil.cpu_percent(interval=None)
    state["cpu_high"] = state.get("cpu_high", 0) + CHECK_EVERY if cpu >= 95 else 0
    if state["cpu_high"] >= 60:
        top = _top_app("cpu")
        _say("cpu", f"Your CPU has been maxed out for over a minute{f', mostly {top}' if top else ''}.")
        state["cpu_high"] = 0
    mem = psutil.virtual_memory()
    if mem.percent >= 93:
        top = _top_app("memory")
        _say("memory", f"Memory is almost full ({mem.percent:.0f}% used){f'. {top} is using the most' if top else ''}.")
    battery = psutil.sensors_battery() if hasattr(psutil, "sensors_battery") else None
    if battery and not battery.power_plugged and battery.percent <= 15:
        _say("battery", f"Battery's at {battery.percent:.0f}%. Plug in soon.")
    state["slow_tick"] = state.get("slow_tick", 0) + 1
    if state["slow_tick"] % 12 == 0:  # about once a minute: the slower checks
        try:
            system_drive = Path.home().anchor or "/"
            u = psutil.disk_usage(system_drive)
            free_gb = u.free / 1024**3
            if free_gb < 10 or u.percent >= 95:
                _say("disk", f"Your {system_drive.rstrip(chr(92))} drive is almost full: only {free_gb:.0f} GB left.")
        except OSError:
            pass
        from .pcstatus import _run

        out = _run(["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"], timeout=5).strip()
        if out.splitlines() and out.splitlines()[0].strip().isdigit() and int(out.splitlines()[0]) >= 85:
            _say("gpu_temp", f"Your graphics card is running hot: {out.splitlines()[0].strip()}°C.")


def _top_app(what: str) -> str:
    import psutil

    best, best_val = "", 0.0
    for p in psutil.process_iter(["name", "memory_info", "cpu_percent"]):
        try:
            val = p.info["cpu_percent"] if what == "cpu" else (p.info["memory_info"].rss if p.info["memory_info"] else 0)
            name = (p.info["name"] or "").removesuffix(".exe")
            if val and val > best_val and name.lower() not in ("system idle process", "idle", "system"):
                best, best_val = name, val
        except psutil.Error:
            continue
    return best


def _check_reminders(announced: set[str]) -> None:
    from . import scheduler

    now = time.time()
    for r in scheduler.pending():
        rid, due, created = str(r["id"]), r["at"], r.get("created") or 0
        if rid in announced or r.get("kind") == "timer":  # timers already count down on screen
            continue
        if 0 < due - now <= 5 * 60 and due - created > 15 * 60:  # only for reminders set well ahead of time
            announced.add(rid)
            _say("reminder", f"Heads-up: in 5 minutes, {r.get('text') or 'your reminder'}.", key=f"rem:{rid}")


def _loop() -> None:
    try:
        import psutil

        psutil.cpu_percent(interval=None)  # first reading primes the counter
        has_psutil = True
    except ImportError:
        has_psutil = False
    downloads = _Downloads()
    health: dict[str, Any] = {}
    announced: set[str] = set()
    while True:
        time.sleep(CHECK_EVERY)
        try:
            if not _settings().get("alerts_enabled", True):
                continue
            downloads.check()
            if has_psutil:
                _check_health(health)
            _check_reminders(announced)
        except Exception:
            pass  # a heads-up must never take Athena down


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _thread = threading.Thread(target=_loop, name="athena-heads-ups", daemon=True)
    _thread.start()
