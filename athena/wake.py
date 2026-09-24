""""Hey Athena" wake word — listens in the background, fully offline.

A lightweight loudness detector waits for speech; each short phrase is transcribed by the tiny
Whisper model and checked for Athena's name. Anything said right after the name
("Hey Athena, what's the weather?") is passed along as the first request.
"""
from __future__ import annotations

import queue
import re
import threading
import time
from typing import Any, Callable

from . import events

PATTERN = re.compile(r"\b(?:(?:hey|hi|hello|okay|ok|yo)[\s,]+)?(?:athena|athina|atena|athene|atheena|athenna|a thena|at hena)\b[\s,.!?]*(.*)", re.I)
RATE = 16000
BLOCK = 480  # 30 ms

state: dict[str, Any] = {"running": False, "paused": False, "error": "", "last_heard": "", "last_wake": 0.0}
on_wake: list[Callable[[str], None]] = []
_stop = threading.Event()
_thread: threading.Thread | None = None


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        import sounddevice  # noqa: F401
    except Exception:
        return False
    return True


def match(text: str) -> str | None:
    """Return the command after the wake word ('' if just the name), or None if not addressed."""
    m = PATTERN.search(text or "")
    if not m:
        return None
    return m.group(1).strip(" .,!?")


def start() -> None:
    global _thread
    if state["running"] or not available():
        if not available():
            state["error"] = "Wake word needs the voice add-on — run install-voice."
        return
    _stop.clear()
    _thread = threading.Thread(target=_run, daemon=True, name="athena-wake")
    _thread.start()


def stop() -> None:
    _stop.set()


def set_paused(paused: bool) -> None:
    state["paused"] = bool(paused)


def _fire(command: str) -> None:
    now = time.time()
    if now - state["last_wake"] < 2:
        return
    state["last_wake"] = now
    events.publish("wake", command=command)
    for cb in on_wake:
        try:
            cb(command)
        except Exception:
            pass


def _run() -> None:
    import numpy as np
    import sounddevice as sd
    from faster_whisper import WhisperModel

    try:
        model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
    except Exception as exc:
        state["error"] = f"Couldn't load the wake word model: {exc}"
        return
    audio_q: queue.Queue = queue.Queue(maxsize=400)

    def callback(indata, frames, t, status):
        try:
            audio_q.put_nowait(indata[:, 0].copy())
        except queue.Full:
            pass

    noise, speech, pre_roll = 0.01, [], []
    in_speech, silence = False, 0
    try:
        with sd.InputStream(samplerate=RATE, channels=1, dtype="float32", blocksize=BLOCK, callback=callback):
            state.update(running=True, error="")
            while not _stop.is_set():
                try:
                    chunk = audio_q.get(timeout=0.5)
                except queue.Empty:
                    continue
                if state["paused"]:
                    speech, in_speech, pre_roll = [], False, []
                    continue
                rms = float(np.sqrt(np.mean(chunk * chunk)))
                threshold = max(0.012, noise * 3.0)
                if rms > threshold:
                    if not in_speech:
                        in_speech, speech = True, list(pre_roll)
                    speech.append(chunk)
                    silence = 0
                elif in_speech:
                    speech.append(chunk)
                    silence += 1
                    if silence > 12:  # ~360 ms pause = end of phrase
                        audio = np.concatenate(speech)
                        in_speech, speech = False, []
                        dur = len(audio) / RATE
                        if 0.35 < dur < 7:
                            segments, _ = model.transcribe(audio, language="en", beam_size=1, vad_filter=False,
                                                           initial_prompt="Hey Athena.")
                            text = " ".join(s.text for s in segments).strip()
                            state["last_heard"] = text
                            command = match(text)
                            if command is not None:
                                _fire(command)
                else:
                    noise = 0.97 * noise + 0.03 * rms
                    pre_roll = (pre_roll + [chunk])[-10:]
                if in_speech and len(speech) > 7 * RATE / BLOCK:
                    in_speech, speech = False, []  # too long to be a wake phrase
    except Exception as exc:
        state["error"] = f"Microphone error: {exc}"
    finally:
        state["running"] = False
