"""Custom voice: Athena speaks in a voice learned from a short recording (with that person's permission).

The voice model (Chatterbox) is big and needs its own library versions, so it lives in a separate environment
(.venv-voiceclone, made by install-custom-voice.bat) and runs as a helper process. Everything stays on this PC.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

from . import store

ROOT = Path(__file__).resolve().parent.parent
VENV_PY = ROOT / ".venv-voiceclone" / ("Scripts/python.exe" if sys.platform.startswith("win") else "bin/python")
WORKER = Path(__file__).resolve().parent / "clone_worker.py"
VOICE_DIR = store.DATA_DIR / "voices"
META = VOICE_DIR / "custom.json"
MARK = "@@ATHENA@@ "
AUDIO_EXT = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".aac", ".webm"}
MAX_BYTES = 25 * 1024 * 1024


class VoiceError(Exception):
    pass


LIST = VOICE_DIR / "voices.json"


def installed() -> bool:
    return VENV_PY.exists()


def voices() -> list[dict[str, Any]]:
    """Saved voices (only ones whose recording is still there)."""
    _migrate()
    return [v for v in store._read(LIST, []) if (VOICE_DIR / v.get("file", "")).is_file()]


def _migrate() -> None:
    """The first version kept a single voice in custom.json; turn it into the first item of the list."""
    old = store._read(META, None)
    if old and not LIST.exists() and (VOICE_DIR / old.get("file", "")).is_file():
        vid = store.new_id()[:8]
        ext = Path(old["file"]).suffix
        (VOICE_DIR / old["file"]).rename(VOICE_DIR / f"{vid}{ext}")
        store._write(LIST, [{"id": vid, "file": f"{vid}{ext}", "name": old.get("name") or "Custom voice",
                             "added": old.get("added", time.time()), "consent": True}])
        if not store.get_settings().get("custom_voice_id"):
            store.update_settings({"custom_voice_id": vid})
    if old:
        try:
            META.unlink(missing_ok=True)
        except OSError:
            pass


def get(voice_id: str | None = None) -> dict[str, Any] | None:
    """A voice by id, else the one chosen in settings, else the first saved one."""
    items = voices()
    wanted = voice_id or store.get_settings().get("custom_voice_id")
    return next((v for v in items if v["id"] == wanted), None) or (items[0] if items else None)


def sample() -> dict[str, Any] | None:  # the voice in use (kept for older callers)
    return get()


def ready() -> bool:
    return installed() and bool(voices())


def save_sample(filename: str, data: bytes, name: str, consent: bool) -> dict[str, Any]:
    """Add a voice to the list."""
    if not consent:
        raise VoiceError("Please confirm you have permission from the person whose voice this is.")
    ext = Path(filename or "").suffix.lower()
    if ext not in AUDIO_EXT:
        raise VoiceError("That isn't an audio file Athena can use. Use WAV, MP3, M4A, OGG or FLAC.")
    if len(data) > MAX_BYTES:
        raise VoiceError("That recording is too big. 10 to 30 seconds of speech is plenty.")
    if len(data) < 20_000:
        raise VoiceError("That recording is too short. Use 10 to 30 seconds of clear speech.")
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    items = voices()
    if len(items) >= 20:
        raise VoiceError("You already have 20 voices. Remove one first.")
    vid = store.new_id()[:8]
    (VOICE_DIR / f"{vid}{ext}").write_bytes(data)
    entry = {"id": vid, "file": f"{vid}{ext}", "name": (name or f"Voice {len(items) + 1}").strip()[:40],
             "added": time.time(), "consent": True}
    store._write(LIST, [*items, entry])
    if not items or not get(store.get_settings().get("custom_voice_id")):
        store.update_settings({"custom_voice_id": vid})
    return entry


def remove(voice_id: str) -> bool:
    items = voices()
    gone = next((v for v in items if v["id"] == voice_id), None)
    if not gone:
        return False
    try:
        (VOICE_DIR / gone["file"]).unlink(missing_ok=True)
    except OSError:
        pass
    rest = [v for v in items if v["id"] != voice_id]
    store._write(LIST, rest)
    if store.get_settings().get("custom_voice_id") == voice_id:
        store.update_settings({"custom_voice_id": rest[0]["id"] if rest else ""})
    return True


def remove_sample() -> None:  # remove all (kept for older callers)
    for v in voices():
        remove(v["id"])


class _Worker:
    """Keeps the voice helper running (loading the model takes a while, so it's done once)."""

    def __init__(self) -> None:
        self.proc: subprocess.Popen | None = None
        self.lock = threading.Lock()
        self.device = ""
        self.error = ""

    def _read(self, timeout: float) -> dict[str, Any]:
        assert self.proc and self.proc.stdout
        result: dict[str, Any] = {}

        def pump() -> None:
            assert self.proc and self.proc.stdout
            for line in self.proc.stdout:
                if line.startswith(MARK):
                    result.update(json.loads(line[len(MARK):]))
                    return

        t = threading.Thread(target=pump, daemon=True)
        t.start()
        t.join(timeout)
        if t.is_alive() or not result:
            self.stop()
            raise VoiceError("The custom voice didn't answer in time.")
        return result

    def _start(self) -> None:
        if self.proc and self.proc.poll() is None:
            return
        if not installed():
            raise VoiceError("The custom voice isn't installed yet. Close Athena and run install-custom-voice.bat.")
        VOICE_DIR.mkdir(parents=True, exist_ok=True)
        log = open(VOICE_DIR / "helper.log", "a", encoding="utf-8", errors="replace")  # noqa: SIM115 (kept open for the helper)
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self.proc = subprocess.Popen([str(VENV_PY), str(WORKER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log,
                                     text=True, encoding="utf-8", bufsize=1, creationflags=flags)
        first = self._read(timeout=600)  # first load can take a few minutes on the processor
        if first.get("error"):
            self.error = first["error"]
            self.stop()
            raise VoiceError(self.error)
        self.device, self.error = first.get("device", ""), ""

    def stop(self) -> None:
        if self.proc:
            try:
                self.proc.kill()
            except OSError:
                pass
        self.proc = None

    def speak(self, text: str, voice_id: str | None = None) -> bytes:
        meta = get(voice_id)
        if not meta:
            raise VoiceError("Add a voice recording first (Settings → Voice → Custom voice).")
        with self.lock:
            self._start()
            fd, out = tempfile.mkstemp(suffix=".wav")
            os.close(fd)
            try:
                assert self.proc and self.proc.stdin
                self.proc.stdin.write(json.dumps({"text": text[:600], "sample": str(VOICE_DIR / meta["file"]), "out": out}) + "\n")
                self.proc.stdin.flush()
                res = self._read(timeout=240)
                if res.get("error"):
                    raise VoiceError(res["error"])
                return Path(out).read_bytes()
            finally:
                try:
                    os.unlink(out)
                except OSError:
                    pass

    def warm(self) -> None:
        """Start loading in the background, so the first sentence isn't slow."""
        def run() -> None:
            try:
                with self.lock:
                    self._start()
            except VoiceError:
                pass
        if ready() and not (self.proc and self.proc.poll() is None):
            threading.Thread(target=run, daemon=True).start()


_worker = _Worker()


def synthesize(text: str, voice_id: str | None = None) -> bytes:
    return _worker.speak(text, voice_id)


def warm() -> None:
    _worker.warm()


def status() -> dict[str, Any]:
    running = bool(_worker.proc and _worker.proc.poll() is None)
    current = get()
    return {"installed": installed(), "voices": voices(), "active": current["id"] if current else "", "running": running,
            "device": _worker.device if running else "", "error": _worker.error}
