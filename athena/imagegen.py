"""Image generation on this PC. Athena finds whichever image generator you have running, by itself:

- ComfyUI (the Desktop app supports AMD Radeon cards on Windows): ports 8000 and 8188
- Stable Diffusion WebUI Forge / AUTOMATIC1111 (started with --api): ports 7860 and 7861
- Ollama image models (e.g. x/z-image-turbo), where Ollama supports them

An address typed in Settings → Integrations is tried first.
"""
from __future__ import annotations

import asyncio
import base64
import random
import re
import shutil
import time
from pathlib import Path
from typing import Any

import httpx

from . import store

IMAGES_DIR = store.DATA_DIR / "images"
COMFY_PORTS = ("http://127.0.0.1:8000", "http://127.0.0.1:8188")
A1111_PORTS = ("http://127.0.0.1:7860", "http://127.0.0.1:7861")
OLLAMA_IMAGE = re.compile(r"(z-image|flux2|flux\.?2|image-gen|imagegen|sdxl|stable-diffusion)", re.I)
_cache: dict[str, Any] = {"at": 0.0, "found": None}

SETUP_HELP = ("No image generator is running. The easiest on this PC: install the free ComfyUI Desktop app "
              "(comfy.org/download; it supports AMD Radeon and NVIDIA cards), open it, and download a model from its "
              "Templates (for example an SDXL or Flux template). Keep ComfyUI open and Athena finds it automatically.")


async def _get(client: httpx.AsyncClient, url: str, timeout: float = 2.5) -> httpx.Response | None:
    try:
        r = await client.get(url, timeout=timeout)
        return r if r.status_code == 200 else None
    except (httpx.HTTPError, OSError):
        return None


def _comfy_checkpoints(info: dict[str, Any]) -> list[str]:
    req = (((info.get("CheckpointLoaderSimple") or {}).get("input") or {}).get("required") or {}).get("ckpt_name") or []
    if req and isinstance(req[0], list):
        return [str(x) for x in req[0]]
    if len(req) > 1 and isinstance(req[1], dict):  # newer format: ["COMBO", {"options": [...]}]
        return [str(x) for x in req[1].get("options") or []]
    return []


async def detect(client: httpx.AsyncClient, ollama: str = "", fresh: bool = False) -> dict[str, Any] | None:
    """The image generator to use: {kind, url, models}, or None if nothing is running."""
    if not fresh and _cache["found"] and time.time() - _cache["at"] < 60:
        return _cache["found"]
    configured = (store.get_settings().get("image_api") or "").strip().rstrip("/")
    found = None
    for url in dict.fromkeys([u for u in (configured,) if u] + [*COMFY_PORTS, *A1111_PORTS]):
        if await _get(client, f"{url}/system_stats"):
            r = await _get(client, f"{url}/object_info/CheckpointLoaderSimple", 8)
            found = {"kind": "comfy", "name": "ComfyUI", "url": url, "models": _comfy_checkpoints(r.json()) if r else []}
            break
        r = await _get(client, f"{url}/sdapi/v1/sd-models")
        if r:
            found = {"kind": "a1111", "name": "Stable Diffusion WebUI", "url": url,
                     "models": [m.get("title") or m.get("model_name") for m in r.json()]}
            break
    if not found and ollama:
        r = await _get(client, f"{ollama}/api/tags")
        names = [m["name"] for m in (r.json().get("models") or [])] if r else []
        picks = [n for n in names if OLLAMA_IMAGE.search(n)]
        if picks:
            found = {"kind": "ollama", "name": "Ollama", "url": ollama, "models": picks}
    _cache.update(at=time.time(), found=found)
    return found


def _save(data: bytes, prompt: str) -> dict[str, Any]:
    from . import photos

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    name = f"athena-{time.strftime('%Y%m%d-%H%M%S')}-{store.new_id()[:4]}.png"
    path = IMAGES_DIR / name
    path.write_bytes(data)
    saved = str(path)
    pictures = Path.home() / "Pictures"
    if pictures.is_dir():
        target = pictures / "Athena"
        target.mkdir(exist_ok=True)
        shutil.copy2(path, target / name)
        saved = str(target / name)
    photos.remember(path)  # "now make it darker" edits this one
    return {"image": f"/api/images/{name}", "saved_to": saved, "prompt": prompt}


def _pick_model(models: list[str]) -> str:
    wanted = (store.get_settings().get("image_model") or "").strip()
    if wanted and wanted in models:
        return wanted
    ranked = sorted(models, key=lambda m: (not re.search(r"xl|flux|juggernaut|dreamshaper|z.?image", m, re.I), m.lower()))
    return ranked[0]


def _recipe(model: str, width: int, height: int) -> dict[str, Any]:
    """Good settings for the kind of model (fast turbo models need few steps and low guidance)."""
    low = model.lower()
    if re.search(r"1\.5|sd15|v1-5|1_5", low):  # older models draw best at 512
        scale = 512 / max(width, height)
        width, height = int(width * scale) // 8 * 8, int(height * scale) // 8 * 8
    if "schnell" in low:
        return {"steps": 4, "cfg": 1.0, "sampler": "euler", "scheduler": "simple", "width": width, "height": height}
    if re.search(r"turbo|lightning|hyper|lcm", low):
        return {"steps": 7, "cfg": 1.5, "sampler": "euler", "scheduler": "sgm_uniform", "width": width, "height": height}
    if "flux" in low:
        return {"steps": 20, "cfg": 1.0, "sampler": "euler", "scheduler": "simple", "width": width, "height": height}
    return {"steps": 28, "cfg": 6.0, "sampler": "dpmpp_2m", "scheduler": "karras", "width": width, "height": height}


async def _comfy(client: httpx.AsyncClient, gen: dict[str, Any], prompt: str, negative: str, width: int, height: int) -> dict[str, Any]:
    if not gen["models"]:
        return {"error": "ComfyUI is running but has no image model yet. In ComfyUI, open Templates, pick an image "
                         "template (e.g. SDXL or Flux) and let it download the model, then ask me again."}
    model = _pick_model(gen["models"])
    r = _recipe(model, width, height)
    wf = {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": model}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": r["width"], "height": r["height"], "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["4", 1]}},
        "3": {"class_type": "KSampler", "inputs": {"seed": random.randint(0, 2**31), "steps": r["steps"], "cfg": r["cfg"],
                                                   "sampler_name": r["sampler"], "scheduler": r["scheduler"], "denoise": 1.0,
                                                   "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "Athena", "images": ["8", 0]}},
    }
    resp = await client.post(f"{gen['url']}/prompt", json={"prompt": wf, "client_id": "athena"}, timeout=30)
    if resp.status_code != 200:
        detail = resp.text[:300]
        return {"error": f"ComfyUI couldn't start the picture: {detail}"}
    pid = resp.json().get("prompt_id")
    deadline = time.time() + 900  # the first picture also loads the model
    while time.time() < deadline:
        await asyncio.sleep(1.2)
        h = await _get(client, f"{gen['url']}/history/{pid}", 10)
        item = (h.json() if h else {}).get(pid) if h else None
        if not item:
            continue
        status = item.get("status") or {}
        if status.get("status_str") == "error":
            msgs = [m for m in status.get("messages") or [] if m and m[0] == "execution_error"]
            why = (msgs[0][1] or {}).get("exception_message", "") if msgs else ""
            return {"error": f"ComfyUI hit a problem making the picture. {why}".strip()}
        for out in (item.get("outputs") or {}).values():
            for img in out.get("images") or []:
                v = await client.get(f"{gen['url']}/view", params={"filename": img["filename"], "subfolder": img.get("subfolder", ""),
                                                                   "type": img.get("type", "output")}, timeout=60)
                if v.status_code == 200:
                    return {**_save(v.content, prompt), "model": model, "made_with": "ComfyUI"}
        if status.get("completed"):
            break
    return {"error": "ComfyUI took too long to make the picture. Check the ComfyUI window."}


async def _a1111(client: httpx.AsyncClient, gen: dict[str, Any], prompt: str, negative: str, width: int, height: int) -> dict[str, Any]:
    body = {"prompt": prompt, "negative_prompt": negative, "width": int(width), "height": int(height), "steps": 25,
            "cfg_scale": 6, "sampler_name": "Euler a"}
    resp = await client.post(f"{gen['url']}/sdapi/v1/txt2img", json=body, timeout=900)
    if resp.status_code != 200:
        return {"error": f"The image generator returned HTTP {resp.status_code}. Start it with the --api option."}
    images = resp.json().get("images") or []
    if not images:
        return {"error": "The image generator returned no image"}
    return {**_save(base64.b64decode(images[0].split(",", 1)[-1]), prompt), "made_with": "Stable Diffusion WebUI"}


async def _ollama(client: httpx.AsyncClient, gen: dict[str, Any], prompt: str, width: int, height: int) -> dict[str, Any]:
    model = _pick_model(gen["models"])
    resp = await client.post(f"{gen['url']}/api/generate", json={"model": model, "prompt": prompt, "stream": False,
                                                              "width": int(width), "height": int(height)}, timeout=900)
    data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
    b64 = data.get("image") or (data.get("images") or [None])[0]
    if resp.status_code != 200 or not b64:
        return {"error": data.get("error") or f"Ollama couldn't make the picture with {model}."}
    return {**_save(base64.b64decode(str(b64).split(",", 1)[-1]), prompt), "model": model, "made_with": "Ollama"}


async def generate(client: httpx.AsyncClient, prompt: str, negative: str = "", width: int = 1024, height: int = 1024,
                   ollama: str = "") -> dict[str, Any]:
    prompt = (prompt or "").strip()
    if not prompt:
        return {"error": "What should the picture show?"}
    width = max(256, min(int(width or 1024), 2048)) // 8 * 8
    height = max(256, min(int(height or 1024), 2048)) // 8 * 8
    negative = negative or "blurry, low quality, deformed, watermark, text, extra fingers"
    gen = await detect(client, ollama)
    if not gen:
        gen = await detect(client, ollama, fresh=True)  # it may have just been started
    if not gen:
        return {"error": SETUP_HELP}
    try:
        if gen["kind"] == "comfy":
            return await _comfy(client, gen, prompt, negative, width, height)
        if gen["kind"] == "a1111":
            return await _a1111(client, gen, prompt, negative, width, height)
        return await _ollama(client, gen, prompt, width, height)
    except httpx.HTTPError as exc:
        _cache.update(found=None)
        return {"error": f"Lost the connection to {gen['name']} ({exc.__class__.__name__}). Is it still open?"}


async def status(client: httpx.AsyncClient, ollama: str = "") -> dict[str, Any]:
    gen = await detect(client, ollama, fresh=True)
    if not gen:
        return {"ok": False, "message": SETUP_HELP}
    models = gen["models"]
    if not models:
        return {"ok": False, "message": f"Found {gen['name']} at {gen['url']}, but it has no image models yet."}
    return {"ok": True, "message": f"Found {gen['name']} at {gen['url']} · {len(models)} model{'s' if len(models) != 1 else ''} "
                                   f"(using {_pick_model(models)})", "models": models, "kind": gen["kind"]}
