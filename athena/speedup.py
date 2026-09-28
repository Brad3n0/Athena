"""Ollama speed boost: flash attention + a compressed chat memory (KV cache).

Both are Ollama settings read when Ollama starts, from environment variables. Together they roughly halve the
graphics memory the chat memory needs, so more of a big model fits on the card and replies come out faster.
Windows only (that's where Athena manages Ollama); elsewhere this only reports.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

# OLLAMA_MAX_LOADED_MODELS=1: one model on the graphics card at a time. Ollama then waits for one to unload before
# loading another, instead of trying to fit two big ones and running out of memory (it misjudges free memory on
# some AMD cards).
WANTED = {"OLLAMA_FLASH_ATTENTION": "1", "OLLAMA_KV_CACHE_TYPE": "q8_0", "OLLAMA_MAX_LOADED_MODELS": "1"}
APP = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama app.exe"
last = {"changed": False, "restarted": False, "note": ""}


def _user_env() -> dict[str, str]:
    import winreg

    out = {}
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
        for name in WANTED:
            try:
                out[name] = str(winreg.QueryValueEx(key, name)[0])
            except OSError:
                out[name] = ""
    return out


def _set_user_env(values: dict[str, str]) -> None:
    import ctypes
    import winreg

    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment", 0, winreg.KEY_SET_VALUE) as key:
        for name, value in values.items():
            if value:
                winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
            else:
                try:
                    winreg.DeleteValue(key, name)
                except OSError:
                    pass
    # Tell Windows the settings changed, so Ollama picks them up next time it starts
    ctypes.windll.user32.SendMessageTimeoutW(0xFFFF, 0x001A, 0, "Environment", 0x0002, 2000, None)


def restart_ollama(ollama_url: str) -> bool:
    """Restart Ollama (it crashed or froze), then wait until it answers. False if it can't be restarted from here."""
    if not sys.platform.startswith("win"):
        return False
    return _restart_ollama(ollama_url)


def _restart_ollama(ollama_url: str) -> bool:
    """Restart the Ollama tray app (with the speed settings). Only if it's the normal installed app."""
    if not APP.exists():
        return False
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    for exe in ("ollama app.exe", "ollama.exe"):
        subprocess.run(["taskkill", "/IM", exe, "/F"], capture_output=True, creationflags=flags)
    time.sleep(1.5)
    env = {**os.environ, **_user_env()}  # the speed boost settings as they are now (on or off)
    env = {k: v for k, v in env.items() if v != ""}
    subprocess.Popen([str(APP)], env=env, creationflags=flags | getattr(subprocess, "DETACHED_PROCESS", 0))
    import httpx

    for _ in range(40):  # wait until it answers again (up to ~20 s)
        time.sleep(0.5)
        try:
            httpx.get(f"{ollama_url}/api/version", timeout=1)
            return True
        except httpx.HTTPError:
            continue
    return False


def apply(enabled: bool, ollama_url: str) -> dict[str, Any]:
    """Turn the boost on (or off) for Ollama. Restarts Ollama once, only when something changed."""
    if not sys.platform.startswith("win"):
        last.update(note="Set OLLAMA_FLASH_ATTENTION=1, OLLAMA_KV_CACHE_TYPE=q8_0 and OLLAMA_MAX_LOADED_MODELS=1 for Ollama")
        return dict(last)
    try:
        current = _user_env()
        wanted = WANTED if enabled else {k: "" for k in WANTED}
        if current == wanted:
            last.update(changed=False, note="")
            return dict(last)
        _set_user_env(wanted)
        restarted = _restart_ollama(ollama_url)
        last.update(changed=True, restarted=restarted,
                    note="" if restarted else "Restart Ollama (or your PC) once so it picks up the speed boost")
    except Exception as exc:  # never stop Athena from starting over this
        last.update(note=f"Couldn't apply the speed boost: {exc}")
    return dict(last)


def status(enabled: bool) -> tuple[str, str]:
    """For the health check."""
    if not enabled:
        return "skip", "Off (Settings → Models)"
    if not sys.platform.startswith("win"):
        return "skip", last["note"]
    try:
        on = _user_env() == WANTED
    except Exception as exc:
        return "warn", str(exc)
    if not on:
        return "warn", "Not applied yet · restart Athena"
    return ("warn", last["note"]) if last["note"] else ("ok", "Flash attention, compressed chat memory, one model at a time")
