"""Know the PC: graphics card memory, system RAM, and which models fit — plus a self-test of every feature."""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

WIN = sys.platform.startswith("win")
MAC = sys.platform == "darwin"


def _run(cmd: list[str], timeout: float = 8) -> str:
    try:
        flags = 0x08000000 if WIN else 0  # no console window flash on Windows
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, creationflags=flags)
        return r.stdout if r.returncode == 0 else ""
    except Exception:
        return ""


# ---------------------------------------------------------------- hardware

def ram_gb() -> float:
    try:
        if WIN:
            import ctypes

            class MEM(ctypes.Structure):
                _fields_ = [("len", ctypes.c_ulong), ("load", ctypes.c_ulong), ("total", ctypes.c_ulonglong),
                            ("avail", ctypes.c_ulonglong), ("tp", ctypes.c_ulonglong), ("ap", ctypes.c_ulonglong),
                            ("tv", ctypes.c_ulonglong), ("av", ctypes.c_ulonglong), ("ave", ctypes.c_ulonglong)]

            m = MEM()
            m.len = ctypes.sizeof(MEM)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))  # type: ignore[attr-defined]
            return round(m.total / 1024**3, 1)
        if MAC:
            return round(int(_run(["sysctl", "-n", "hw.memsize"]) or 0) / 1024**3, 1)
        with open("/proc/meminfo") as f:
            kb = int(re.search(r"MemTotal:\s+(\d+)", f.read()).group(1))
        return round(kb / 1024**2, 1)
    except Exception:
        return 0.0


def gpus() -> list[dict[str, Any]]:
    """Graphics cards with their dedicated memory (VRAM) in GB."""
    found: list[dict[str, Any]] = []
    out = _run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) == 2 and parts[1].isdigit():
            found.append({"name": parts[0], "vram_gb": round(int(parts[1]) / 1024, 1), "source": "nvidia-smi"})
    if found:
        return found
    if WIN:
        # The display-adapter registry keys hold the real memory size (WMI caps it at 4 GB).
        ps = ("Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' "
              "-ErrorAction SilentlyContinue | ForEach-Object { \"$($_.DriverDesc)|$($_.'HardwareInformation.qwMemorySize')\" }")
        for line in _run(["powershell", "-NoProfile", "-Command", ps], timeout=12).strip().splitlines():
            name, _, size = line.partition("|")
            if name and size.strip().isdigit() and int(size) > 0:
                found.append({"name": name.strip(), "vram_gb": round(int(size) / 1024**3, 1), "source": "registry"})
    elif MAC:
        chip = _run(["sysctl", "-n", "machdep.cpu.brand_string"]).strip()
        if "Apple" in chip:  # Apple Silicon shares memory with the GPU (about 70% usable)
            found.append({"name": chip, "vram_gb": round(ram_gb() * 0.7, 1), "source": "unified memory"})
    else:
        out = _run(["rocm-smi", "--showmeminfo", "vram", "--json"])
        for m in re.finditer(r'"VRAM Total Memory \(B\)":\s*"?(\d+)', out):
            found.append({"name": "AMD GPU", "vram_gb": round(int(m.group(1)) / 1024**3, 1), "source": "rocm-smi"})
    return sorted(found, key=lambda g: -g["vram_gb"])


def recommend(vram: float, ram: float) -> dict[str, Any]:
    """The best models for this PC, by job."""
    if vram >= 20:
        tier, picks = "24 GB+", {"assistant": "gpt-oss:20b", "study": "qwen3:14b", "code": "qwen3-coder:30b", "voice": "qwen3:14b", "vision": "qwen2.5vl:7b"}
    elif vram >= 15:
        # qwen3-coder:30b is a mixture-of-experts model: it spills a little past 16 GB but stays fast with 32 GB of RAM.
        # Voice shares qwen3:14b with Study, so switching between them doesn't reload a model.
        tier, picks = "16 GB", {"assistant": "gpt-oss:20b", "study": "qwen3:14b", "code": "qwen3-coder:30b" if ram >= 30 else "qwen2.5-coder:14b",
                                "voice": "qwen3:14b", "vision": "qwen2.5vl:7b"}
    elif vram >= 11:
        tier, picks = "12 GB", {"assistant": "qwen3:14b", "study": "qwen3:14b", "code": "qwen2.5-coder:14b", "voice": "qwen3:4b", "vision": "qwen2.5vl:7b"}
    elif vram >= 7:
        tier, picks = "8 GB", {"assistant": "qwen3:8b", "study": "qwen3:8b", "code": "qwen2.5-coder:7b", "voice": "qwen3:4b", "vision": "qwen2.5vl:7b"}
    elif vram >= 5 or ram >= 16:
        tier, picks = "6 GB / 16 GB RAM", {"assistant": "qwen3:4b", "study": "qwen3:4b", "code": "qwen2.5-coder:3b", "voice": "qwen3:4b", "vision": "gemma3:4b"}
    else:
        tier, picks = "basic", {"assistant": "qwen3:1.7b", "study": "qwen3:4b", "code": "qwen2.5-coder:1.5b", "voice": "qwen3:1.7b", "vision": "gemma3:4b"}
    sizes = {"gpt-oss:20b": 13.8, "qwen3:14b": 9.3, "qwen3:8b": 5.2, "qwen3:4b": 2.6, "qwen3:1.7b": 1.4,
             "qwen3-coder:30b": 18.6, "qwen2.5-coder:14b": 9.0, "qwen2.5-coder:7b": 4.7, "qwen2.5-coder:3b": 1.9,
             "qwen2.5-coder:1.5b": 1.0, "qwen2.5vl:7b": 6.0, "gemma3:4b": 3.3, "nomic-embed-text": 0.27}
    models = []
    for role, name in picks.items():
        existing = next((m for m in models if m["name"] == name), None)
        if existing:
            existing["roles"].append(role)
        else:
            models.append({"name": name, "roles": [role], "size_gb": sizes.get(name), "optional": role == "vision"})
    models.append({"name": "nomic-embed-text", "roles": ["documents"], "size_gb": 0.27, "optional": True})
    return {"tier": tier, "picks": picks, "models": models}


def hardware() -> dict[str, Any]:
    g = gpus()
    ram = ram_gb()
    vram = g[0]["vram_gb"] if g else 0.0
    return {"gpus": g, "vram_gb": vram, "ram_gb": ram, "platform": sys.platform, **recommend(vram, ram)}


# ------------------------------------------------------------------ self-test

def _check(name: str, fn) -> dict[str, Any]:
    t = time.time()
    try:
        status, detail = fn()
    except BaseException as exc:  # a broken optional library must not break the report
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            raise
        status, detail = "fail", f"{exc.__class__.__name__}: {exc}"[:300]
    return {"name": name, "status": status, "detail": detail, "ms": round((time.time() - t) * 1000)}


def local_checks() -> list[dict[str, Any]]:
    """Checks that don't need the network or Ollama (run in a worker thread)."""
    from . import files, speech, store, tts, wake

    s = store.get_settings()
    checks = []

    def whisper():
        if not speech.available():
            return "fail", "Not installed — run install-voice.bat"
        name = s.get("whisper_model", "base.en")
        cache = Path.home() / ".cache" / "huggingface" / "hub"
        have = any(name.replace(".", "") in p.name.replace(".", "").replace("-", "") or name in p.name for p in cache.glob("models--*")) if cache.exists() else False
        return ("ok", f"Installed · model {name} downloaded") if have else ("warn", f"Installed, but the '{name}' model may not be downloaded yet — run install-voice.bat while online")
    checks.append(_check("Speech recognition (Whisper)", whisper))

    def kokoro():
        if not tts.available():
            return "fail", "Not installed — run install-voice.bat (Athena will use Windows voices meanwhile)"
        wav = tts.synthesize("Test.", s.get("kokoro_voice") or "athena_silk")
        return "ok", f"Working · made {len(wav) // 1024} KB of audio"
    checks.append(_check("Athena's voice (Kokoro)", kokoro))

    def wakeword():
        if not s.get("wake_enabled"):
            return "skip", "Turned off (Settings → Voice)"
        if not wake.available():
            return "fail", "Needs install-voice.bat"
        st = wake.state
        return ("ok", "Listening for “Hey Athena”") if st.get("running") else ("fail", st.get("error") or "Not running")
    checks.append(_check("“Hey Athena” wake word", wakeword))

    def mic_device():
        try:
            import sounddevice as sd
        except Exception:
            return "skip", "Checked in the browser instead (voice add-on not installed)"
        dev = sd.query_devices(kind="input")
        return "ok", f"Found: {dev['name']}"
    checks.append(_check("Microphone (background)", mic_device))

    def file_access():
        if not s.get("files_enabled"):
            return "skip", "Turned off (Settings → Abilities)"
        roots = files.roots()
        if not roots:
            return "fail", "No folders found — add some in Settings → Abilities"
        with tempfile.NamedTemporaryFile(dir=roots[0], prefix=".athena-test-", delete=True):
            pass
        try:
            import send2trash  # noqa: F401
            bin_ok = "Recycle Bin ready"
        except ImportError:
            bin_ok = "send2trash missing — restart with start.bat"
        return "ok", f"{len(roots)} folders ({', '.join(r.name for r in roots)}) · {bin_ok}"
    checks.append(_check("Files", file_access))

    def screenshot():
        if not s.get("screen_enabled"):
            return "skip", "Turned off (Settings → Abilities)"
        from . import pc
        img = pc.screenshot(400)
        return "ok", f"Captured the screen ({len(img) * 3 // 4 // 1024} KB)"
    checks.append(_check("Screenshots", screenshot))

    def clipboard():
        if not s.get("pc_enabled"):
            return "skip", "Turned off (Settings → Abilities)"
        from . import pc
        r = pc.get_clipboard()
        return "ok", "Can read the clipboard" + (" (empty right now)" if r.get("empty") else "")
    checks.append(_check("Clipboard", clipboard))

    def pc_control():
        if not s.get("pc_enabled"):
            return "skip", "Turned off (Settings → Abilities)"
        if not WIN:
            return "warn", "Volume, media and power controls only work on Windows"
        from . import pc
        return "ok", f"Windows controls ready · {len(pc.installed_apps())} apps found for “open …”"
    checks.append(_check("PC controls", pc_control))

    def run_code():
        from . import pc
        r = pc.run_python("print(6 * 7)", timeout=20)
        return ("ok", "Python runs (6 × 7 = 42)") if r.get("stdout", "").strip() == "42" else ("fail", r.get("stderr") or "No output")
    checks.append(_check("Run Python", run_code))

    def node():
        path = shutil.which("node")
        return ("ok", f"Found {_run([path, '--version']).strip()}") if path else ("warn", "Not installed — install Node.js to run JavaScript code blocks (optional)")
    checks.append(_check("Run JavaScript (Node.js)", node))

    def documents():
        try:
            import pypdf  # noqa: F401
        except BaseException as exc:
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            return "fail", f"PDF reader problem ({exc.__class__.__name__}) — restart with start.bat"
        import docx  # noqa: F401
        return "ok", "Can read PDF, Word and PowerPoint files"
    checks.append(_check("Reading PDFs & Word files", documents))

    def desktop():
        from . import desktop as d
        if not WIN and not MAC:
            return "skip", "The tray app is for Windows/macOS"
        bits = []
        bits.append("browser found" if d.find_browser() else "no Edge/Chrome found")
        for mod in ("pystray", "pynput"):
            try:
                __import__(mod)
                bits.append(f"{mod} ok")
            except Exception:
                bits.append(f"{mod} missing")
        bad = any("missing" in b or "no Edge" in b for b in bits)
        state = "running now" if d.running["active"] else "not running (use start-desktop.bat)"
        return ("warn" if bad else "ok"), f"{state} · " + " · ".join(bits) + (" · starts with Windows" if d.autostart_enabled() else "")
    checks.append(_check("Desktop app", desktop))

    def storage():
        free = shutil.disk_usage(str(store.DATA_DIR if store.DATA_DIR.exists() else Path.home())).free / 1024**3
        return ("ok" if free > 15 else "warn"), f"{free:.0f} GB free" + ("" if free > 15 else " — AI models need 5–20 GB each")
    checks.append(_check("Disk space", storage))
    return checks
