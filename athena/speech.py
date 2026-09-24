"""Offline speech-to-text using faster-whisper (optional dependency)."""
from __future__ import annotations

import threading

_lock = threading.Lock()
_model = None
_model_key: tuple[str, str] | None = None


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
    except Exception:
        return False
    return True


def _get_model(name: str, device: str):
    global _model, _model_key
    from faster_whisper import WhisperModel

    key = (name, device)
    if _model is None or _model_key != key:
        compute = "float16" if device == "cuda" else "int8"
        _model = WhisperModel(name, device=device, compute_type=compute)
        _model_key = key
    return _model


def transcribe(path: str, model_name: str = "base.en", device: str = "cpu") -> str:
    with _lock:  # one transcription at a time keeps memory predictable
        model = _get_model(model_name, device)
        language = "en" if model_name.endswith(".en") else None
        segments, _info = model.transcribe(path, language=language, beam_size=1, vad_filter=True)
        return " ".join(seg.text.strip() for seg in segments).strip()


def preload(model_name: str = "base.en", device: str = "cpu") -> None:
    """Download + load the model now (used by the installer so it works offline later)."""
    with _lock:
        _get_model(model_name, device)
