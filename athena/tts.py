"""Offline neural text-to-speech with Kokoro (optional dependency).

Much more natural than the built-in system voices. Install with install-voice.
"""
from __future__ import annotations

import io
import threading
import urllib.request
import wave

from .store import ROOT

MODEL_DIR = ROOT / "models" / "kokoro"
FILES = {
    "kokoro-v1.0.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
    "voices-v1.0.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
}

# Athena's signature voices: blends of Kokoro voices for a soft, breathy, sultry sound.
PRESETS = {
    "athena_silk": [("af_nicole", 0.55), ("af_bella", 0.45)],
    "athena_velvet": [("af_nicole", 0.5), ("af_heart", 0.5)],
    "athena_honey": [("af_bella", 0.6), ("af_sky", 0.25), ("af_nicole", 0.15)],
}

# Friendly names for the voices (Kokoro also has male and other-language voices).
VOICES = {
    "athena_silk": "Athena Silk — soft, breathy, sultry (default)",
    "athena_velvet": "Athena Velvet — warm, smooth, sultry",
    "athena_honey": "Athena Honey — sweet, playful, flirty",
    "af_bella": "Bella — bright, energetic (US)",
    "af_heart": "Heart — warm, expressive (US)",
    "af_nicole": "Nicole — whispery, ASMR-like (US)",
    "af_sky": "Sky — light, youthful (US)",
    "af_sarah": "Sarah — friendly, clear (US)",
    "af_nova": "Nova — calm, confident (US)",
    "af_jessica": "Jessica — casual (US)",
    "af_river": "River — gentle (US)",
    "af_kore": "Kore — smooth (US)",
    "af_aoede": "Aoede — airy (US)",
    "af_alloy": "Alloy — neutral (US)",
    "bf_emma": "Emma — polished (UK)",
    "bf_isabella": "Isabella — elegant (UK)",
    "bf_lily": "Lily — sweet (UK)",
    "bf_alice": "Alice — crisp (UK)",
}

_lock = threading.Lock()
_engine = None


def available() -> bool:
    try:
        import kokoro_onnx  # noqa: F401
    except Exception:
        return False
    return all((MODEL_DIR / name).exists() for name in FILES)


def download(progress=print) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in FILES.items():
        dest = MODEL_DIR / name
        if dest.exists():
            continue
        progress(f"Downloading {name}...")
        tmp = dest.with_suffix(dest.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.replace(dest)


def _get_engine():
    global _engine
    if _engine is None:
        from kokoro_onnx import Kokoro

        _engine = Kokoro(str(MODEL_DIR / "kokoro-v1.0.onnx"), str(MODEL_DIR / "voices-v1.0.bin"))
    return _engine


def warm_up() -> None:
    """Load the voice model in the background so Athena's first sentence isn't delayed."""
    try:
        with _lock:
            _get_engine()
    except Exception:
        pass


def synthesize(text: str, voice: str = "athena_silk", speed: float = 1.0) -> bytes:
    """Return a 16-bit mono WAV file of ``text`` spoken by ``voice``."""
    import numpy as np

    if voice not in VOICES:
        voice = "athena_silk"
    lang = "en-gb" if voice.startswith("b") else "en-us"
    speed = min(max(float(speed), 0.5), 2.0)
    with _lock:
        engine = _get_engine()
        style = voice
        if voice in PRESETS:
            style = sum(engine.get_voice_style(name) * weight for name, weight in PRESETS[voice]).astype(np.float32)
        samples, rate = engine.create(text[:2000], voice=style, speed=speed, lang=lang)
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()
