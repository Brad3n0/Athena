"""Athena's own engine: runs her brain on this PC by herself, no Ollama needed.

- The engine is llama.cpp (the open-source engine Ollama is built on). The Vulkan build runs on AMD Radeon and NVIDIA
  cards on Windows. Athena downloads it once into the engine/ folder and runs it hidden.
- Her brain is ONE model file (plus a small "eyes" file for pictures) in the brain/ folder, downloaded once.
- To the rest of Athena the engine looks exactly like Ollama: a small translator on 127.0.0.1:11435 speaks Ollama's
  API and passes everything to llama.cpp's server. So every feature keeps working without changes.

If anything goes wrong (no internet for the first download, the engine won't start), Athena keeps using Ollama when
it's installed, and the status bar says what happened.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import tarfile
import sys
import threading
import time
import zipfile
from pathlib import Path
from typing import Any, AsyncIterator

import httpx
from fastapi import Request  # at module level: the shim's routes need it to read requests

from . import store

ENGINE_DIR = store.ROOT / "engine"
BRAIN_DIR = store.ROOT / "brain"
LOG_FILE = store.DATA_DIR / "engine.log"
SHIM_PORT = 11435  # Ollama-style address the rest of Athena talks to
LLAMA_PORT = 11436  # llama.cpp's own server, behind it
SHIM_URL = f"http://127.0.0.1:{SHIM_PORT}"
LLAMA_URL = f"http://127.0.0.1:{LLAMA_PORT}"
MODEL_NAME = "athena"
FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# The brains she can run. Each is one model file in GGUF format (Q4_K_M: a quarter of the size, nearly the same smarts).
BRAINS: dict[str, dict[str, Any]] = {
    "qwen3-vl-8b": {"name": "ATH-X", "label": "ATH-X: chat, code, tools and pictures, fast (about 6 GB, built on Qwen3-VL 8B)",
                    "repo": "Qwen/Qwen3-VL-8B-Instruct-GGUF", "repos": ["Qwen/Qwen3-VL-8B-Instruct-GGUF", "ggml-org/Qwen3-VL-8B-Instruct-GGUF"],
                    "params": "8B", "family": "qwen3vl"},
    "gemma3-12b": {"name": "Gemma 3 12B", "label": "Gemma 3 12B: chat, writing and pictures (about 8 GB)",
                   "repo": "ggml-org/gemma-3-12b-it-GGUF", "params": "12B", "family": "gemma3"},
    "qwen3-14b": {"name": "Qwen3 14B", "label": "Qwen3 14B: smartest at code, math and tools; can't see pictures (about 9 GB)",
                  "repo": "Qwen/Qwen3-14B-GGUF", "params": "14B", "family": "qwen3"},
}
DEFAULT_BRAIN = "qwen3-vl-8b"
# Brain upgrades: when a better brain comes out, an Athena update adds it above and sets "replaced_by" on the old one.
# She then offers the upgrade; memories, lessons, library and settings all stay, and the old brain is deleted once
# the new one works.
_cleanup_after_ready = [False]

_lock = threading.RLock()
_proc: subprocess.Popen | None = None
_state: dict[str, Any] = {"state": "off", "what": "", "done": 0, "total": 0, "error": "", "build": ""}
_ready_hooks: list = []
_shim_started = False
_last_used = [time.time()]


def _idle_limit() -> float | None:
    """Settings → Models → "Keep models loaded after use", in seconds (None = always)."""
    raw = str(store.get_settings().get("keep_alive") or "30m").strip()
    m = re.fullmatch(r"(-?\d+(?:\.\d+)?)([smh]?)", raw)
    if not m or float(m.group(1)) < 0:
        return None
    return float(m.group(1)) * {"s": 1, "m": 60, "h": 3600, "": 1}[m.group(2)]


def _idle_watch() -> None:
    """Unload the brain after it's been idle that long, so games get the graphics card back (it reloads on the next message)."""
    while True:
        time.sleep(30)
        limit = _idle_limit()
        if limit and ready() and time.time() - _last_used[0] > limit:
            _log("idle: unloading to free the graphics card")
            unload()


class EngineError(Exception):
    pass


# ------------------------------------------------------------------ status

def wanted() -> bool:
    """Is the built-in engine switched on (Settings → Models → Engine)?"""
    return store.get_settings().get("engine", "builtin") == "builtin"


def brain_key() -> str:
    key = store.get_settings().get("brain") or DEFAULT_BRAIN
    return key if key in BRAINS else DEFAULT_BRAIN


def status() -> dict[str, Any]:
    with _lock:
        s = dict(_state)
    s["mode"] = "builtin" if wanted() else "ollama"
    s["brain"] = brain_key()
    s["brain_label"] = BRAINS[brain_key()]["label"]
    running = s.get("running") if s.get("running") in BRAINS else brain_key()
    s["brain_name"] = BRAINS[running].get("name") or BRAINS[running]["label"].split(":")[0]
    s["brains"] = {k: v["label"] for k, v in BRAINS.items()}
    if s["total"]:
        s["percent"] = round(100 * s["done"] / s["total"])
    newer = BRAINS[brain_key()].get("replaced_by")
    if newer in BRAINS:
        s["upgrade"] = {"brain": newer, "label": BRAINS[newer]["label"]}
    return s


def ready() -> bool:
    with _lock:
        return _state["state"] == "ready" and _proc is not None and _proc.poll() is None


def _set(**kw: Any) -> None:
    with _lock:
        _state.update(kw)


def _log(text: str) -> None:
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {text}\n")
    except OSError:
        pass


# ------------------------------------------------------------------ downloads

def _download(client: httpx.Client, url: str, dest: Path, what: str) -> None:
    """Download with progress and resume (a dropped connection carries on where it stopped)."""
    part = dest.with_name(dest.name + ".part")
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(6):
        have = part.stat().st_size if part.exists() else 0
        headers = {"Range": f"bytes={have}-"} if have else {}
        try:
            with client.stream("GET", url, headers=headers, follow_redirects=True, timeout=httpx.Timeout(30, read=120)) as r:
                if r.status_code == 416:  # already complete
                    break
                if r.status_code not in (200, 206):
                    raise EngineError(f"Download of {what} failed (HTTP {r.status_code})")
                if r.status_code == 200:
                    have = 0
                total = have + int(r.headers.get("content-length") or 0)
                _set(what=what, done=have, total=total)
                with part.open("ab" if have else "wb") as f:
                    for chunk in r.iter_bytes(1 << 20):
                        f.write(chunk)
                        have += len(chunk)
                        _set(done=have)
            break
        except (httpx.HTTPError, OSError) as exc:
            _log(f"download {what}: {exc!r} (try {attempt + 1})")
            if attempt == 5:
                raise EngineError(f"Couldn't download {what}: check the internet connection and try again") from exc
            time.sleep(3 * (attempt + 1))
    part.replace(dest)


def _engine_asset() -> str:
    # Windows builds come as .zip; Mac and Linux builds as .tar.gz (older releases used .zip for all)
    if sys.platform.startswith("win"):
        return r"bin-win-vulkan-x64\.zip$"
    if sys.platform == "darwin":
        return r"bin-macos-arm64\.(?:zip|tar\.gz)$"
    return r"bin-ubuntu-vulkan-x64\.(?:zip|tar\.gz)$|bin-ubuntu-x64\.(?:zip|tar\.gz)$"


def _unpack(archive: Path, dest: Path) -> None:
    if archive.name.endswith(".tar.gz"):
        with tarfile.open(archive) as t:
            if hasattr(tarfile, "data_filter"):
                t.extractall(dest, filter="data")  # nothing may land outside the engine folder
            else:
                for m in t.getmembers():
                    target = (dest / m.name).resolve()
                    if not str(target).startswith(str(dest.resolve())):
                        raise EngineError("The engine download looks damaged")
                t.extractall(dest)
    else:
        with zipfile.ZipFile(archive) as z:
            z.extractall(dest)


def server_exe() -> Path | None:
    name = "llama-server.exe" if sys.platform.startswith("win") else "llama-server"
    hits = sorted(ENGINE_DIR.rglob(name)) if ENGINE_DIR.exists() else []
    return hits[0] if hits else None


def _releases_without_api(client: httpx.Client) -> list[dict[str, Any]]:
    """The newest release's engine file, found without GitHub's API (which allows only 60 checks an hour per PC)."""
    try:
        r = client.get("https://github.com/ggml-org/llama.cpp/releases/latest", timeout=30, follow_redirects=True)
        tag = str(r.url).rstrip("/").rsplit("/", 1)[-1]
        if not re.fullmatch(r"b\d+", tag):
            _log(f"engine lookup without the API: no release tag in {r.url} (HTTP {r.status_code})")
            return []
        assets = []
        for name in (f"llama-{tag}-bin-win-vulkan-x64.zip", f"llama-{tag}-bin-macos-arm64.tar.gz",
                     f"llama-{tag}-bin-ubuntu-vulkan-x64.tar.gz", f"llama-{tag}-bin-ubuntu-x64.tar.gz"):
            if not re.search(_engine_asset(), name):
                continue
            url = f"https://github.com/ggml-org/llama.cpp/releases/download/{tag}/{name}"
            # A real download request (the file server refuses HEAD checks), stopped as soon as it answers
            with client.stream("GET", url, timeout=30, follow_redirects=True) as check:
                ok = check.status_code == 200
            _log(f"engine lookup without the API: {name} -> {'found' if ok else check.status_code}")
            if ok:
                assets.append({"name": name, "browser_download_url": url})
        return [{"tag_name": tag, "assets": assets}]
    except httpx.HTTPError as exc:
        _log(f"engine lookup without the API failed: {exc!r}")
        return []


_lookup_cache: dict[str, Any] = {"time": 0.0, "found": None}
KNOWN_GOOD_ENGINE = "b11327"  # tested with Athena; used if the newest release can't be found


def _find_engine(client: httpx.Client) -> tuple[dict[str, Any], dict[str, Any]]:
    """The release and file of the engine for this PC. Remembered for 15 minutes, so retries don't use up
    GitHub's limit of 60 checks an hour."""
    if _lookup_cache["found"] and time.time() - _lookup_cache["time"] < 900:
        return _lookup_cache["found"]
    # The newest release is sometimes published before all its files have finished uploading, so if it doesn't
    # have this PC's engine yet, use the newest recent release that does.
    releases: list[dict[str, Any]] = []
    try:
        r = client.get("https://api.github.com/repos/ggml-org/llama.cpp/releases", params={"per_page": 15},
                       timeout=30, headers={"Accept": "application/vnd.github+json"})
        releases = r.json() if r.status_code == 200 and isinstance(r.json(), list) else []
        if not releases:
            _log(f"engine lookup: GitHub's API answered {r.status_code}")
    except (httpx.HTTPError, ValueError) as exc:
        _log(f"engine lookup: GitHub's API failed: {exc!r}")
    for attempt in (releases, None):
        for rel in attempt if attempt is not None else _releases_without_api(client):
            if rel.get("draft") or rel.get("prerelease"):
                continue
            asset = next((a for a in rel.get("assets") or [] if re.search(_engine_asset(), a.get("name", ""))), None)
            if asset:
                _lookup_cache.update(time=time.time(), found=(rel, asset))
                return rel, asset
        if attempt:
            _log("engine lookup: no recent release has this PC's engine file; trying the releases page")
    # Last resort: a release known to work, downloaded straight from its address (no lookups needed)
    tag = KNOWN_GOOD_ENGINE
    for name in (f"llama-{tag}-bin-win-vulkan-x64.zip", f"llama-{tag}-bin-macos-arm64.tar.gz",
                 f"llama-{tag}-bin-ubuntu-vulkan-x64.tar.gz", f"llama-{tag}-bin-ubuntu-x64.tar.gz"):
        if re.search(_engine_asset(), name):
            _log(f"engine lookup: using the known-good release {tag}")
            found = ({"tag_name": tag}, {"name": name,
                     "browser_download_url": f"https://github.com/ggml-org/llama.cpp/releases/download/{tag}/{name}"})
            _lookup_cache.update(time=time.time(), found=found)
            return found
    raise EngineError("Couldn't find an engine download for this PC right now. Try again in a few minutes")


def ensure_engine(client: httpx.Client) -> Path:
    exe = server_exe()
    if exe:
        return exe
    _set(state="downloading", what="the engine", done=0, total=0)
    release, asset = _find_engine(client)
    zpath = ENGINE_DIR / asset["name"]
    _download(client, asset["browser_download_url"], zpath, "the engine")
    _unpack(zpath, ENGINE_DIR)
    zpath.unlink(missing_ok=True)
    exe = server_exe()
    if not exe:
        raise EngineError("The engine download didn't contain llama-server")
    if not sys.platform.startswith("win"):
        exe.chmod(0o755)
    (ENGINE_DIR / "version.txt").write_text(str(release.get("tag_name", "")), encoding="utf-8")
    return exe


def brain_files(key: str | None = None) -> tuple[Path | None, Path | None]:
    folder = BRAIN_DIR / (key or brain_key())
    if not folder.exists():
        return None, None
    ggufs = [p for p in folder.glob("*.gguf")]
    model = next((p for p in ggufs if "mmproj" not in p.name.lower()), None)
    eyes = next((p for p in ggufs if "mmproj" in p.name.lower()), None)
    return model, eyes


def _pick(files: list[str]) -> tuple[str, str | None]:
    ggufs = [f for f in files if f.lower().endswith(".gguf") and "/" not in f]
    mains = [f for f in ggufs if "mmproj" not in f.lower()]
    model = next((f for q in ("q4_k_m", "q4_k_s", "q5_k_m", "q4_0", "q8_0") for f in mains if q in f.lower()), mains[0] if mains else "")
    projs = [f for f in ggufs if "mmproj" in f.lower()]
    eyes = next((f for q in ("f16", "bf16", "q8_0") for f in projs if q in f.lower()), projs[0] if projs else None)
    return model, eyes


def ensure_brain(client: httpx.Client, key: str) -> tuple[Path, Path | None]:
    model, eyes = brain_files(key)
    if model:
        return model, eyes
    _set(state="downloading", what="Athena's brain", done=0, total=0)
    # Try each place the brain is published (the official one first), so one moved or renamed copy doesn't matter
    model_name = eyes_name = None
    problems = []
    for repo in BRAINS[key].get("repos") or [BRAINS[key]["repo"]]:
        r = client.get(f"https://huggingface.co/api/models/{repo}", timeout=30)
        if r.status_code != 200:
            problems.append(f"{repo}: HTTP {r.status_code}")
            continue
        model_name, eyes_name = _pick([s.get("rfilename", "") for s in r.json().get("siblings") or []])
        if model_name:
            break
        problems.append(f"{repo}: no model file")
    _log(f"brain {key}: " + ("; ".join(problems) + "; " if problems else "") + (f"using {repo}/{model_name}" if model_name else "not found"))
    if not model_name:
        raise EngineError(f"Couldn't find the brain download ({'; '.join(problems)})")
    folder = BRAIN_DIR / key
    if eyes_name:
        _download(client, f"https://huggingface.co/{repo}/resolve/main/{eyes_name}", folder / eyes_name, "Athena's eyes (for pictures)")
    _download(client, f"https://huggingface.co/{repo}/resolve/main/{model_name}", folder / model_name, "Athena's brain")
    return brain_files(key)  # type: ignore[return-value]


def _brain_with_fallback(client: httpx.Client) -> tuple[Path, Path | None]:
    """The chosen brain; if its download can't be found (renamed or removed online), the next one on the list."""
    first = brain_key()
    order = [first] + [k for k in BRAINS if k != first]
    last: Exception | None = None
    for key in order:
        try:
            files = ensure_brain(client, key)
            # Your choice stays saved: if it couldn't be downloaded this time, she uses another brain for now and
            # tries yours again next start (instead of quietly switching your setting)
            _set(running=key, note="" if key == first else
                 f"{BRAINS[first].get('name', first)} couldn't be downloaded right now, so she's using {BRAINS[key].get('name', key)} for now.")
            if key != first:
                _log(f"brain {first} wasn't available; using {key} for now")
            return files
        except EngineError as exc:
            last = exc
            if "Couldn't find" not in str(exc) and "No model file" not in str(exc):
                raise  # a real download problem (internet): don't silently switch brains
    raise last or EngineError("No brain available")


# ------------------------------------------------------------------ running

def _launch(exe: Path, model: Path, eyes: Path | None, ctx: int | None = None, gpu_layers: int = 999) -> subprocess.Popen:
    ctx = ctx or int(store.get_settings().get("context_size") or 16384)
    args = [str(exe), "-m", str(model), "--host", "127.0.0.1", "--port", str(LLAMA_PORT), "-c", str(ctx),
            "-ngl", str(gpu_layers), "-np", "1", "--jinja", "--alias", MODEL_NAME]
    if eyes:
        args += ["--mmproj", str(eyes)]
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    log = LOG_FILE.open("a", encoding="utf-8")
    _log("starting: " + " ".join(args))
    return subprocess.Popen(args, cwd=str(exe.parent), stdout=log, stderr=subprocess.STDOUT, creationflags=FLAGS)


def _stop_leftovers() -> None:
    """Close engines left running by an earlier Athena (a crash, or a second Athena window): they hold the port
    and the graphics card memory, so a new one can't start."""
    try:
        import psutil
    except ImportError:
        return
    mine = _proc.pid if _proc and _proc.poll() is None else None
    # Any engine Athena started, from this folder or an older copy of Athena (it holds her port and graphics memory)
    for p in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            if p.info["pid"] == mine or "llama-server" not in (p.info["name"] or "").lower():
                continue
            cmd = " ".join(p.info["cmdline"] or [])
            if f"--alias {MODEL_NAME}" in cmd or f"--port {LLAMA_PORT}" in cmd:
                _log(f"closing a leftover engine (pid {p.info['pid']})")
                p.kill()
                p.wait(5)
        except (psutil.Error, OSError):
            continue


_FAIL_HINTS = ("error", "failed", "out of memory", "unable", "cannot", "can't", "bind", "exception", "abort")


def _failure_reason(since: int) -> str:
    """The lines the engine wrote about why it stopped (not just the command that started it)."""
    try:
        with LOG_FILE.open("rb") as f:
            f.seek(since)
            text = f.read().decode("utf-8", errors="replace")
    except OSError:
        return ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().split(" ", 2)[-1].startswith("starting:")]
    bad = [ln for ln in lines if any(h in ln.lower() for h in _FAIL_HINTS)]
    out = " | ".join((bad or lines)[-3:])[-300:]
    return out or "it closed without saying why (often a leftover engine, or the graphics driver)"


def _wait_healthy(proc: subprocess.Popen, seconds: float = 300) -> bool:
    end = time.time() + seconds
    while time.time() < end:
        if proc.poll() is not None:
            return False
        try:
            if httpx.get(f"{LLAMA_URL}/health", timeout=2).status_code == 200:
                return True
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    return False


def _tail_log(lines: int = 6) -> str:
    try:
        text = LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines()
        return " | ".join(ln.strip() for ln in text[-lines:] if ln.strip())[-400:]
    except OSError:
        return ""


def _start() -> None:
    """Download what's missing, start the engine and wait until her brain is loaded."""
    global _proc
    try:
        with httpx.Client(headers={"User-Agent": "AthenaAI"}) as client:
            exe = ensure_engine(client)
            model, eyes = _brain_with_fallback(client)
        _set(state="starting", what="Loading Athena's brain", done=0, total=0,
             build=(ENGINE_DIR / "version.txt").read_text(encoding="utf-8").strip() if (ENGINE_DIR / "version.txt").exists() else "")
        _stop_leftovers()
        # Try the full setup first; if the engine stops (usually not enough graphics memory), step down:
        # a shorter chat memory, then without her eyes for pictures, then part of the brain on the processor.
        ctx = int(store.get_settings().get("context_size") or 16384)
        attempts = [(ctx, eyes, 999), (min(ctx, 8192), eyes, 999), (min(ctx, 8192), None, 999), (8192, None, 24)]
        seen, reasons, ok = set(), [], False
        for a_ctx, a_eyes, a_ngl in attempts:
            if (a_ctx, a_eyes, a_ngl) in seen:
                continue
            seen.add((a_ctx, a_eyes, a_ngl))
            since = LOG_FILE.stat().st_size if LOG_FILE.exists() else 0
            with _lock:
                if _proc and _proc.poll() is None:
                    _proc.terminate()
                _proc = _launch(exe, model, a_eyes, a_ctx, a_ngl)
                proc = _proc
            if _wait_healthy(proc):
                ok = True
                note = []
                if a_ctx < ctx:
                    note.append(f"a shorter chat memory ({a_ctx // 1024}K)")
                if eyes and not a_eyes:
                    note.append("without seeing pictures")
                if a_ngl != 999:
                    note.append("partly on the processor (slower)")
                if note:
                    _set(note=(_state.get("note") or "") + " Her brain didn't fit on the graphics card with everything "
                         "else running, so she's using " + ", ".join(note) + ". Close games or other big apps and press "
                         "Try again for the full setup.")
                break
            reasons.append(_failure_reason(since))
            _log(f"engine stopped (ctx {a_ctx}, eyes {'on' if a_eyes else 'off'}, gpu layers {a_ngl}); trying a lighter setup")
            try:
                proc.kill()
            except OSError:
                pass
            _stop_leftovers()
        if not ok:
            raise EngineError("The engine stopped while loading her brain: " + (reasons[0] if reasons else "no reason given")
                              + ". Restarting the PC usually fixes this; if not, send the end of data\\engine.log.")
        _set(state="ready", what="", error="")
        _log("ready")
        if _cleanup_after_ready[0]:  # an upgrade worked: the old brain isn't needed any more
            _cleanup_after_ready[0] = False
            _log(f"upgrade done; freed {remove_other_brains() / 1e9:.1f} GB")
        for hook in list(_ready_hooks):
            try:
                hook()
            except Exception as exc:  # noqa: BLE001
                _log(f"ready hook: {exc!r}")
    except Exception as exc:  # never take Athena down over this
        _log(f"error: {exc!r}")
        msg = str(exc)
        if isinstance(exc, httpx.HTTPError):
            msg = (f"Couldn't reach the download site ({exc.__class__.__name__}: {exc}). Check the internet connection, "
                   "then press Try again.")
        _set(state="error", error=msg, what="")


_starting = threading.Lock()


def start(on_ready=None) -> None:
    """Get the engine going in the background (download first if needed). Safe to call repeatedly."""
    if on_ready and on_ready not in _ready_hooks:
        _ready_hooks.append(on_ready)
    start_shim()
    if ready() or not _starting.acquire(blocking=False):
        return

    def run() -> None:
        try:
            _start()
        finally:
            _starting.release()
    threading.Thread(target=run, daemon=True, name="athena-engine").start()


def ensure_running(timeout: float = 300) -> bool:
    """Make sure the brain is loaded (it's unloaded to give a game or the picture maker the graphics card)."""
    if ready():
        return True
    with _lock:
        if _state["state"] in ("downloading",):
            return False
    start()
    end = time.time() + timeout
    while time.time() < end:
        if ready():
            return True
        with _lock:
            if _state["state"] == "error":
                return False
        time.sleep(0.3)
    return False


def unload() -> None:
    """Free the graphics card (the brain loads again on the next message)."""
    global _proc
    with _lock:
        if _proc and _proc.poll() is None:
            _proc.terminate()
            try:
                _proc.wait(10)
            except subprocess.TimeoutExpired:
                _proc.kill()
        _proc = None
        if _state["state"] == "ready":
            _state.update(state="off", what="")


def restart() -> bool:
    """Restart the engine (it crashed or ran out of memory)."""
    unload()
    return ensure_running()


def stop() -> None:
    unload()


def switch_brain(key: str) -> None:
    if key not in BRAINS:
        raise EngineError("Unknown brain")
    store.update_settings({"brain": key})
    unload()
    _set(state="off", error="")
    start()


def upgrade() -> None:
    """Move to the newer brain (downloads once); the old one is deleted after the new one is running."""
    newer = BRAINS[brain_key()].get("replaced_by")
    if newer not in BRAINS:
        raise EngineError("Athena already has her newest brain")
    _cleanup_after_ready[0] = True
    switch_brain(newer)


def remove_other_brains() -> int:
    """Delete brains that aren't in use, to free disk space. Returns bytes freed."""
    freed = 0
    for folder in BRAIN_DIR.glob("*") if BRAIN_DIR.exists() else []:
        if folder.is_dir() and folder.name != brain_key():
            freed += sum(f.stat().st_size for f in folder.rglob("*") if f.is_file())
            shutil.rmtree(folder, ignore_errors=True)
    return freed


# ------------------------------------------------------------------ Ollama-style translator

def _merge_systems(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep one system message at the top: some models' chat templates reject system messages later in the chat, so
    later notes (the time, reminders) are folded into the next user message."""
    out: list[dict[str, Any]] = []
    carry: list[str] = []
    for i, m in enumerate(messages):
        if m.get("role") == "system" and i > 0:
            carry.append(str(m.get("content") or ""))
            continue
        if carry and m.get("role") == "user":
            m = {**m, "content": "(" + " ".join(carry) + ")\n\n" + str(m.get("content") or "")}
            carry = []
        out.append(m)
    if carry:
        if out and out[0].get("role") == "system":
            out[0] = {**out[0], "content": str(out[0].get("content") or "") + "\n\n" + " ".join(carry)}
        else:
            out.insert(0, {"role": "system", "content": " ".join(carry)})
    return out


def to_openai(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    pending: list[str] = []
    n = 0
    for m in _merge_systems(messages):
        role, content = m.get("role"), m.get("content") or ""
        if role == "assistant" and m.get("tool_calls"):
            calls = []
            for c in m["tool_calls"]:
                f = c.get("function") or {}
                n += 1
                cid = f"call_{n}"
                args = f.get("arguments")
                calls.append({"id": cid, "type": "function", "function": {
                    "name": f.get("name", ""), "arguments": args if isinstance(args, str) else json.dumps(args or {})}})
                pending.append(cid)
            out.append({"role": "assistant", "content": content, "tool_calls": calls})
        elif role == "tool":
            out.append({"role": "tool", "tool_call_id": pending.pop(0) if pending else f"call_{n}", "content": content})
        elif m.get("images") and role == "user":
            parts: list[dict[str, Any]] = [{"type": "text", "text": content}]
            for img in m["images"]:
                url = img if str(img).startswith("data:") else f"data:image/png;base64,{img}"
                parts.append({"type": "image_url", "image_url": {"url": url}})
            out.append({"role": "user", "content": parts})
        else:
            out.append({"role": role, "content": content})
    return out


def to_request(body: dict[str, Any], stream: bool) -> dict[str, Any]:
    req: dict[str, Any] = {"model": MODEL_NAME, "messages": to_openai(body.get("messages") or []), "stream": stream}
    if body.get("tools"):
        req["tools"] = body["tools"]
    opts = body.get("options") or {}
    for ollama_key, key in (("temperature", "temperature"), ("top_p", "top_p"), ("top_k", "top_k"), ("seed", "seed"),
                            ("repeat_penalty", "repeat_penalty"), ("repeat_last_n", "repeat_last_n"), ("stop", "stop"),
                            ("num_predict", "max_tokens"), ("min_p", "min_p"), ("presence_penalty", "presence_penalty")):
        if opts.get(ollama_key) is not None:
            req[key] = opts[ollama_key]
    # Everyday chat (no temperature chosen): the sampling settings each brain's makers recommend. Qwen's
    # presence penalty is what stops it repeating whole replies and catchphrases.
    if "temperature" not in opts:
        fam = BRAINS.get(brain_key(), {}).get("family", "")
        defaults = ({"temperature": 1.0, "top_k": 64, "top_p": 0.95, "presence_penalty": 0.6} if fam == "gemma3"
                    else {"temperature": 0.7, "top_k": 20, "top_p": 0.8, "presence_penalty": 1.5})
        for key, value in defaults.items():
            req.setdefault(key, value)
        req.pop("repeat_penalty", None)  # the presence penalty does this job better; both together garble words
    fmt = body.get("format")
    if fmt == "json":
        req["response_format"] = {"type": "json_object"}
    elif isinstance(fmt, dict):
        req["response_format"] = {"type": "json_schema", "json_schema": {"schema": fmt}}
    if body.get("think") is False:
        req["chat_template_kwargs"] = {"enable_thinking": False}
    if stream:
        req["stream_options"] = {"include_usage": True}
    return req


def _calls(acc: dict[int, dict[str, str]]) -> list[dict[str, Any]]:
    out = []
    for i in sorted(acc):
        raw = acc[i].get("arguments") or "{}"
        try:
            args = json.loads(raw)
        except ValueError:
            args = {}
        out.append({"function": {"name": acc[i].get("name", ""), "arguments": args if isinstance(args, dict) else {}}})
    return out


def _done(usage: dict[str, Any], timings: dict[str, Any], reason: str) -> dict[str, Any]:
    return {"model": MODEL_NAME, "done": True, "done_reason": reason or "stop",
            "eval_count": usage.get("completion_tokens"), "prompt_eval_count": usage.get("prompt_tokens"),
            "eval_duration": int(float(timings.get("predicted_ms") or 0) * 1e6) or None,
            "prompt_eval_duration": int(float(timings.get("prompt_ms") or 0) * 1e6) or None}


def build_shim():
    """A small web app that answers like Ollama and passes the work to llama.cpp."""
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse, StreamingResponse

    app = FastAPI()
    client = httpx.AsyncClient(timeout=httpx.Timeout(30, read=None))

    def not_ready() -> JSONResponse:
        s = status()
        if s["state"] == "downloading":
            msg = f"Athena is still downloading {s['what']} ({s.get('percent', 0)}%). She'll be ready by herself when it's done."
        elif s["state"] == "error":
            msg = f"Athena's engine couldn't start: {s['error']}"
        else:
            msg = "Athena's brain is loading, one moment…"
        return JSONResponse({"error": msg}, status_code=503)

    def model_entry() -> dict[str, Any] | None:
        model, eyes = brain_files()
        if not model:
            return None
        info = BRAINS[brain_key()]
        size = model.stat().st_size + (eyes.stat().st_size if eyes else 0)
        return {"name": MODEL_NAME, "model": MODEL_NAME, "size": size, "digest": brain_key(),
                "modified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(model.stat().st_mtime)),
                "details": {"family": info["family"], "parameter_size": info["params"], "quantization_level": "Q4_K_M",
                            "format": "gguf"}}

    @app.get("/")
    async def root():
        return "Athena's engine is running"

    @app.get("/api/version")
    async def version():
        return {"version": f"built-in {status().get('build') or ''}".strip()}

    @app.get("/api/tags")
    async def tags():
        entry = model_entry()
        return {"models": [entry] if entry else []}

    @app.get("/api/ps")
    async def ps():
        entry = model_entry()
        return {"models": [{**entry, "size_vram": entry["size"], "expires_at": "2099-01-01T00:00:00Z"}] if entry and ready() else []}

    @app.post("/api/show")
    async def show(request: Request):
        _model, eyes = brain_files()
        caps = ["completion", "tools"] + (["vision"] if eyes else [])
        info = BRAINS[brain_key()]
        return {"capabilities": caps, "details": {"family": info["family"], "parameter_size": info["params"]},
                "model_info": {"general.architecture": info["family"]}}

    async def openai_stream(req: dict[str, Any], key: str) -> AsyncIterator[bytes]:
        acc: dict[int, dict[str, str]] = {}
        usage: dict[str, Any] = {}
        timings: dict[str, Any] = {}
        reason = ""
        async with client.stream("POST", f"{LLAMA_URL}/v1/chat/completions", json=req) as resp:
            if resp.status_code != 200:
                text = (await resp.aread()).decode(errors="replace")
                try:
                    err = json.loads(text).get("error")
                    text = err.get("message") if isinstance(err, dict) else (err or text)
                except ValueError:
                    pass
                yield (json.dumps({"error": text}) + "\n").encode()
                return
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except ValueError:
                    continue
                usage = chunk.get("usage") or usage
                timings = chunk.get("timings") or timings
                for choice in chunk.get("choices") or []:
                    delta = choice.get("delta") or {}
                    reason = choice.get("finish_reason") or reason
                    for tc in delta.get("tool_calls") or []:
                        slot = acc.setdefault(int(tc.get("index") or 0), {"name": "", "arguments": ""})
                        f = tc.get("function") or {}
                        slot["name"] += f.get("name") or ""
                        slot["arguments"] += f.get("arguments") or ""
                    text, thinking = delta.get("content") or "", delta.get("reasoning_content") or ""
                    if text or thinking:
                        msg: dict[str, Any] = {"role": "assistant", "content": text}
                        if thinking:
                            msg["thinking"] = thinking
                        out = {"model": MODEL_NAME, "done": False}
                        out[key] = msg if key == "message" else text
                        yield (json.dumps(out) + "\n").encode()
        if acc:
            yield (json.dumps({"model": MODEL_NAME, "done": False,
                               "message": {"role": "assistant", "content": "", "tool_calls": _calls(acc)}}) + "\n").encode()
        final = _done(usage, timings, reason)
        if key == "message":
            final["message"] = {"role": "assistant", "content": ""}
        else:
            final["response"] = ""
        yield (json.dumps(final) + "\n").encode()

    async def openai_once(req: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        r = await client.post(f"{LLAMA_URL}/v1/chat/completions", json=req)
        try:
            data = r.json()
        except ValueError:
            return 502, {"error": r.text[:300]}
        if r.status_code != 200:
            err = data.get("error")
            return r.status_code, {"error": err.get("message") if isinstance(err, dict) else (err or r.text[:300])}
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        out_msg: dict[str, Any] = {"role": "assistant", "content": msg.get("content") or ""}
        if msg.get("reasoning_content"):
            out_msg["thinking"] = msg["reasoning_content"]
        if msg.get("tool_calls"):
            out_msg["tool_calls"] = _calls({i: {"name": (c.get("function") or {}).get("name", ""),
                                                "arguments": (c.get("function") or {}).get("arguments") or "{}"}
                                            for i, c in enumerate(msg["tool_calls"])})
        return 200, {**_done(data.get("usage") or {}, data.get("timings") or {}, choice.get("finish_reason") or ""),
                     "message": out_msg}

    async def run(body: dict[str, Any], key: str):
        from starlette.concurrency import run_in_threadpool

        _last_used[0] = time.time()
        if not await run_in_threadpool(ensure_running, 300):
            return not_ready()
        stream = body.get("stream", True) is not False
        req = to_request(body, stream)
        if stream:
            return StreamingResponse(openai_stream(req, key), media_type="application/x-ndjson")
        code, data = await openai_once(req)
        if code == 200 and key == "response":
            data["response"] = data.pop("message", {}).get("content", "")
        return JSONResponse(data, status_code=code)

    @app.post("/api/chat")
    async def chat(request: Request):
        body = await request.json()
        if not body.get("messages") and body.get("keep_alive") in (0, "0", "0s"):
            unload()
            return {"model": MODEL_NAME, "done": True, "done_reason": "unload"}
        return await run(body, "message")

    @app.post("/api/generate")
    async def generate(request: Request):
        body = await request.json()
        if not body.get("prompt") and not body.get("images"):
            if body.get("keep_alive") in (0, "0", "0s"):
                from starlette.concurrency import run_in_threadpool

                await run_in_threadpool(unload)  # "unload the model": free the graphics card
                return {"model": MODEL_NAME, "done": True, "done_reason": "unload", "response": ""}
            return {"model": MODEL_NAME, "done": True, "response": ""}
        messages = ([{"role": "system", "content": body["system"]}] if body.get("system") else []) + \
                   [{"role": "user", "content": body.get("prompt") or "", "images": body.get("images") or []}]
        return await run({**body, "messages": messages}, "response")

    @app.post("/api/embed")
    @app.post("/api/embeddings")
    async def embed(request: Request):
        return JSONResponse({"error": "Document search needs Ollama with nomic-embed-text (Settings → Models → Engine)."},
                            status_code=501)

    @app.post("/api/pull")
    @app.post("/api/delete")
    @app.post("/api/create")
    async def unsupported(request: Request):
        return JSONResponse({"error": "Athena's built-in engine has one brain. Change it in Settings → Models → Engine."},
                            status_code=400)

    return app


def start_shim() -> None:
    """Serve the Ollama-style translator on 127.0.0.1:11435 (once)."""
    global _shim_started
    with _lock:
        if _shim_started:
            return
        _shim_started = True
    import uvicorn

    server = uvicorn.Server(uvicorn.Config(build_shim(), host="127.0.0.1", port=SHIM_PORT, log_level="warning"))
    server.install_signal_handlers = lambda: None  # type: ignore[method-assign]  # it runs in a side thread
    threading.Thread(target=server.run, daemon=True, name="athena-engine-shim").start()
    threading.Thread(target=_idle_watch, daemon=True, name="athena-engine-idle").start()


def disk_use() -> int:
    total = 0
    for folder in (ENGINE_DIR, BRAIN_DIR):
        if folder.exists():
            total += sum(f.stat().st_size for f in folder.rglob("*") if f.is_file())
    return total

