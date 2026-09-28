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


def installed() -> bool:
    return VENV_PY.exists()


def sample() -> dict[str, Any] | None:
    meta = store._read(META, None)
    if meta and (VOICE_DIR / meta.get("file", "")).is_file():
        return meta
    return None


def ready() -> bool:
    return installed() and sample() is not None


def save_sample(filename: str, data: bytes, name: str, consent: bool) -> dict[str, Any]:
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
    remove_sample()
    target = VOICE_DIR / f"custom{ext}"
    target.write_bytes(data)
    meta = {"file": target.name, "name": (name or "Custom voice").strip()[:40], "added": time.time(), "consent": True}
    store._write(META, meta)
    _worker.stop()  # the next sentence uses the new recording
    return meta


def remove_sample() -> None:
    meta = store._read(META, None)
    if meta:
        try:
            (VOICE_DIR / meta.get("file", "")).unlink(missing_ok=True)
        except OSError:
            pass
        try:
            META.unlink(missing_ok=True)
        except OSError:
            pass


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

    def speak(self, text: str) -> bytes:
        meta = sample()
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


def synthesize(text: str) -> bytes:
    return _worker.speak(text)


def warm() -> None:
    _worker.warm()


def status() -> dict[str, Any]:
    running = bool(_worker.proc and _worker.proc.poll() is None)
    return {"installed": installed(), "sample": sample(), "running": running, "device": _worker.device if running else "",
            "error": _worker.error}
