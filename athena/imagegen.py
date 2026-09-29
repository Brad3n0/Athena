"""Image generation on this PC. Athena finds whichever image generator you have running, by itself:

- ComfyUI (the Desktop app supports AMD Radeon cards on Windows): ports 8000 and 8188. Works with all-in-one
  checkpoints (SDXL, SD 1.5, Flux fp8) and with the split-file models its newer templates download (Z-Image, Flux).
- Stable Diffusion WebUI Forge / AUTOMATIC1111 (started with --api): ports 7860 and 7861
- Ollama image models (e.g. x/z-image-turbo), where Ollama supports them

An address typed in Settings → Integrations is tried first.

The chat model and the picture model share one graphics card: before drawing, Athena unloads her chat model, and after
drawing she asks ComfyUI to let go of its model, so neither runs out of graphics memory.
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
              "(comfy.org/download; it supports AMD Radeon and NVIDIA cards), open it, go to Templates → Image and pick "
              "Z-Image Turbo (fast, and fits a 16 GB card) or an SDXL template, and let it download the model. Keep ComfyUI "
              "open (it can sit in the background) and Athena finds it automatically.")


async def _get(client: httpx.AsyncClient, url: str, timeout: float = 2.5) -> httpx.Response | None:
    try:
        r = await client.get(url, timeout=timeout)
        return r if r.status_code == 200 else None
    except (httpx.HTTPError, OSError):
        return None


def _json(r: httpx.Response | None) -> Any:
    try:
        return r.json() if r is not None else None
    except ValueError:  # some other program on that port answering with a web page
        return None


def _options(info: dict[str, Any], node: str, field: str) -> list[str]:
    """The choices ComfyUI offers for one input of a node (e.g. the model files it can load)."""
    req = (((info.get(node) or {}).get("input") or {}).get("required") or {}).get(field) or []
    if req and isinstance(req[0], list):
        return [str(x) for x in req[0]]
    if len(req) > 1 and isinstance(req[1], dict):  # newer format: ["COMBO", {"options": [...]}]
        return [str(x) for x in req[1].get("options") or []]
    return []


def _comfy_checkpoints(info: dict[str, Any]) -> list[str]:
    return _options(info, "CheckpointLoaderSimple", "ckpt_name")


# Split-file models (ComfyUI's newer templates put them in models/diffusion_models, not models/checkpoints):
# the families Athena knows how to wire up, and the text encoder / VAE files each one needs.
ZIMAGE = re.compile(r"z[-_ ]?image", re.I)
FLUX1 = re.compile(r"flux[-_.]?1|flux[-_.]?(?:dev|schnell|krea)", re.I)
SKIP_UNET = re.compile(r"kontext|fill|depth|canny|redux|inpaint|edit|controlnet", re.I)  # need a picture to start from


async def _comfy_models(client: httpx.AsyncClient, url: str) -> tuple[list[str], dict[str, dict[str, Any]]]:
    """Every picture model ComfyUI can use, and how to load the split-file ones."""
    info: dict[str, Any] = {}
    for node in ("CheckpointLoaderSimple", "UNETLoader", "CLIPLoader", "DualCLIPLoader", "VAELoader"):
        data = _json(await _get(client, f"{url}/object_info/{node}", 8))
        if isinstance(data, dict):
            info.update(data)
    checkpoints = _comfy_checkpoints(info)
    unets = _options(info, "UNETLoader", "unet_name")
    encoders = _options(info, "CLIPLoader", "clip_name") or _options(info, "DualCLIPLoader", "clip_name1")
    clip_types = _options(info, "CLIPLoader", "type")
    vaes = _options(info, "VAELoader", "vae_name")
    first = lambda names, pattern: next((n for n in names if re.search(pattern, n, re.I)), "")  # noqa: E731
    flux_vae = first(vaes, r"(^|[\\/])ae\.|flux.*vae|vae.*flux|^ae")
    split: dict[str, dict[str, Any]] = {}
    for unet in unets:
        if SKIP_UNET.search(unet):
            continue
        if ZIMAGE.search(unet):
            enc = first(encoders, r"qwen[-_.]?3[-_.]?4b") or first(encoders, r"qwen[-_.]?3")
            if enc and flux_vae and "lumina2" in clip_types:
                split[unet] = {"family": "zimage", "clip": enc, "vae": flux_vae}
        elif FLUX1.search(unet):
            t5, clip_l = first(encoders, r"t5xxl|t5-xxl|t5_xxl"), first(encoders, r"clip[-_]?l\b|clip_l")
            if t5 and clip_l and flux_vae:
                split[unet] = {"family": "flux", "clip": [t5, clip_l], "vae": flux_vae}
    return checkpoints + list(split), split


async def detect(client: httpx.AsyncClient, ollama: str = "", fresh: bool = False) -> dict[str, Any] | None:
    """The image generator to use: {kind, url, models}, or None if nothing is running."""
    if not fresh and _cache["found"] and time.time() - _cache["at"] < 60:
        return _cache["found"]
    configured = (store.get_settings().get("image_api") or "").strip().rstrip("/")
    found = None
    for url in dict.fromkeys([u for u in (configured,) if u] + [*COMFY_PORTS, *A1111_PORTS]):
        stats = _json(await _get(client, f"{url}/system_stats"))
        if isinstance(stats, dict) and "system" in stats:
            models, split = await _comfy_models(client, url)
            found = {"kind": "comfy", "name": "ComfyUI", "url": url, "models": models, "split": split}
            break
        sd = _json(await _get(client, f"{url}/sdapi/v1/sd-models"))
        if isinstance(sd, list):
            found = {"kind": "a1111", "name": "Stable Diffusion WebUI", "url": url,
                     "models": [m.get("title") or m.get("model_name") for m in sd if isinstance(m, dict)]}
            break
    if not found and ollama:
        tags = _json(await _get(client, f"{ollama}/api/tags"))
        names = [m["name"] for m in (tags.get("models") or [])] if isinstance(tags, dict) else []
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
    # Z-Image Turbo first (fast, sharp, fits a 16 GB card), then SDXL-class models, then Flux, then anything else
    rank = lambda m: (0 if ZIMAGE.search(m) else 1 if re.search(r"xl|juggernaut|dreamshaper|pony|illustrious", m, re.I)  # noqa: E731
                      else 2 if re.search(r"flux", m, re.I) else 3, m.lower())
    return sorted(models, key=rank)[0]


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


async def free_ollama(client: httpx.AsyncClient, ollama: str) -> None:
    """Unload the chat model so the picture model gets the whole graphics card (it reloads on the next message)."""
    if not ollama:
        return
    ps = _json(await _get(client, f"{ollama}/api/ps", 4))
    loaded = [m.get("name") or m.get("model") for m in (ps or {}).get("models", [])] if isinstance(ps, dict) else []
    loaded = [m for m in loaded if m and "embed" not in m]
    if not loaded:
        return
    for name in loaded:
        try:
            await client.post(f"{ollama}/api/generate", json={"model": name, "keep_alive": 0}, timeout=20)
        except httpx.HTTPError:
            pass
    for _ in range(30):  # Ollama frees the memory a moment after it answers
        await asyncio.sleep(0.5)
        ps = _json(await _get(client, f"{ollama}/api/ps", 4))
        still = [m.get("name") or m.get("model") for m in (ps or {}).get("models", [])] if isinstance(ps, dict) else []
        if not any(n in still for n in loaded):
            await asyncio.sleep(0.8)
            return


async def free_image_memory(client: httpx.AsyncClient) -> bool:
    """Ask a running ComfyUI to let go of its model, so the chat model fits on the graphics card again."""
    gen = _cache.get("found")
    urls = [gen["url"]] if gen and gen.get("kind") == "comfy" else list(COMFY_PORTS)
    freed = False
    for url in urls:
        try:
            r = await client.post(f"{url}/free", json={"unload_models": True, "free_memory": True}, timeout=5)
            freed = freed or r.status_code == 200
        except (httpx.HTTPError, OSError):
            pass
    return freed


def _comfy_error(resp: httpx.Response) -> str:
    """ComfyUI's reason for refusing a picture, in plain words."""
    data = _json(resp)
    if not isinstance(data, dict):
        return resp.text[:200]
    err = data.get("error") or {}
    parts = [err.get("message", "") if isinstance(err, dict) else str(err)]
    for node in (data.get("node_errors") or {}).values():
        for e in (node or {}).get("errors") or []:
            parts.append(f"{e.get('message', '')}: {e.get('details', '')}".strip(": "))
    return " ".join(p for p in parts if p)[:300] or resp.text[:200]


def _split_workflow(model: str, how: dict[str, Any], prompt: str, width: int, height: int) -> dict[str, Any]:
    """A workflow for the split-file models (Z-Image, Flux): model, text encoder and VAE are separate files."""
    zimage = how["family"] == "zimage"
    schnell = "schnell" in model.lower()
    wf: dict[str, Any] = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": model, "weight_dtype": "default"}},
        "2": ({"class_type": "CLIPLoader", "inputs": {"clip_name": how["clip"], "type": "lumina2"}} if zimage else
              {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": how["clip"][0], "clip_name2": how["clip"][1], "type": "flux"}}),
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": how["vae"]}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["4", 0]}},  # these models ignore negatives
        "6": {"class_type": "EmptySD3LatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "Athena", "images": ["8", 0]}},
    }
    model_ref: list[Any] = ["1", 0]
    positive: list[Any] = ["4", 0]
    if zimage:
        wf["10"] = {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": 3}}
        model_ref = ["10", 0]
        steps, sampler = 9, "res_multistep"
    else:
        if not schnell:
            wf["10"] = {"class_type": "FluxGuidance", "inputs": {"conditioning": ["4", 0], "guidance": 3.5}}
            positive = ["10", 0]
        steps, sampler = (4 if schnell else 20), "euler"
    wf["7"] = {"class_type": "KSampler", "inputs": {"seed": random.randint(0, 2**31), "steps": steps, "cfg": 1.0,
                                                    "sampler_name": sampler, "scheduler": "simple", "denoise": 1.0,
                                                    "model": model_ref, "positive": positive, "negative": ["5", 0],
                                                    "latent_image": ["6", 0]}}
    return wf


async def _comfy(client: httpx.AsyncClient, gen: dict[str, Any], prompt: str, negative: str, width: int, height: int) -> dict[str, Any]:
    if not gen["models"]:
        return {"error": "ComfyUI is running but has no picture model I can use yet. In ComfyUI, open Templates → Image, "
                         "pick Z-Image Turbo (or an SDXL template) and let it download the model files, then ask me again."}
    model = _pick_model(gen["models"])
    how = (gen.get("split") or {}).get(model)
    wf = _split_workflow(model, how, prompt, width, height) if how else _checkpoint_workflow(model, prompt, negative, width, height)
    resp = await client.post(f"{gen['url']}/prompt", json={"prompt": wf, "client_id": "athena"}, timeout=30)
    if resp.status_code != 200:
        return {"error": f"ComfyUI couldn't start the picture with {model}: {_comfy_error(resp)}"}
    return await _comfy_wait(client, gen, resp, prompt, model)


def _checkpoint_workflow(model: str, prompt: str, negative: str, width: int, height: int) -> dict[str, Any]:
    r = _recipe(model, width, height)
    return {
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


async def _comfy_wait(client: httpx.AsyncClient, gen: dict[str, Any], resp: httpx.Response, prompt: str, model: str) -> dict[str, Any]:
    pid = (_json(resp) or {}).get("prompt_id")
    if not pid:
        return {"error": "ComfyUI didn't accept the picture. Check the ComfyUI window for an error."}
    deadline = time.time() + 900  # the first picture also loads the model
    while time.time() < deadline:
        await asyncio.sleep(1.2)
        h = _json(await _get(client, f"{gen['url']}/history/{pid}", 10))
        item = h.get(pid) if isinstance(h, dict) else None
        if not item:
            continue
        status = item.get("status") or {}
        if status.get("status_str") == "error":
            msgs = [m for m in status.get("messages") or [] if m and m[0] == "execution_error"]
            why = (msgs[0][1] or {}).get("exception_message", "") if msgs else ""
            if re.search(r"out of memory|HIP|CUDA|allocat", why, re.I):
                why = "It ran out of graphics memory. Close games or other big apps and try again, or pick a smaller picture model."
            return {"error": f"ComfyUI hit a problem making the picture with {model}. {why}".strip()}
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
    if not gen or not gen["models"]:
        gen = await detect(client, ollama, fresh=True)  # it may have just been started, or just got a model
    if not gen:
        return {"error": SETUP_HELP}
    for attempt in range(2):
        try:
            if gen["kind"] == "comfy":
                await free_ollama(client, ollama)  # the chat model and the picture model don't both fit
                try:
                    return await _comfy(client, gen, prompt, negative, width, height)
                finally:
                    await free_image_memory(client)  # and give the card back for chatting
            if gen["kind"] == "a1111":
                await free_ollama(client, ollama)
                return await _a1111(client, gen, prompt, negative, width, height)
            return await _ollama(client, gen, prompt, width, height)
        except httpx.HTTPError as exc:
            _cache.update(found=None)
            fresh = await detect(client, ollama, fresh=True) if attempt == 0 else None
            if not fresh:  # closed, not just moved: say so
                return {"error": f"Lost the connection to {gen['name']} ({exc.__class__.__name__}). Is it still open?"}
            gen = fresh
    return {"error": "The image generator stopped answering. Is it still open?"}


async def status(client: httpx.AsyncClient, ollama: str = "") -> dict[str, Any]:
    gen = await detect(client, ollama, fresh=True)
    if not gen:
        return {"ok": False, "message": SETUP_HELP}
    models = gen["models"]
    if not models:
        return {"ok": False, "message": f"Found {gen['name']} at {gen['url']}, but it has no image models yet."}
    return {"ok": True, "message": f"Found {gen['name']} at {gen['url']} · {len(models)} model{'s' if len(models) != 1 else ''} "
                                   f"(using {_pick_model(models)})", "models": models, "kind": gen["kind"]}
