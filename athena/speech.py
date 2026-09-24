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


def model_for(model_name: str, language: str) -> str:
    """English-only models (*.en) can't hear other languages, so switch to the multilingual one of the same size."""
    if language and language != "en" and model_name.endswith(".en"):
        return model_name[:-3]
    return model_name


def transcribe_full(path: str, model_name: str = "base.en", device: str = "cpu", language: str = "en") -> dict:
    """Returns {"text", "language"}. language: "en", "auto" (detect) or a code like "es"."""
    name = model_for(model_name, language)
    with _lock:  # one transcription at a time keeps memory predictable
        model = _get_model(name, device)
        hint = "en" if name.endswith(".en") else (None if language in ("", "auto") else language)
        segments, info = model.transcribe(path, language=hint, beam_size=1, vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return {"text": text, "language": hint or getattr(info, "language", None) or "en"}


def transcribe(path: str, model_name: str = "base.en", device: str = "cpu") -> str:
    return transcribe_full(path, model_name, device)["text"]


def preload(model_name: str = "base.en", device: str = "cpu") -> None:
    """Download + load the model now (used by the installer so it works offline later)."""
    with _lock:
        _get_model(model_name, device)
