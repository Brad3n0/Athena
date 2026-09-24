"""Optional integrations: image generation (Stable Diffusion WebUI / Forge) and Home Assistant."""
from __future__ import annotations

import base64
import difflib
import shutil
import time
from pathlib import Path
from typing import Any

import httpx

from . import store

IMAGES_DIR = store.DATA_DIR / "images"


# ------------------------------------------------------- image generation

async def generate_image(client: httpx.AsyncClient, prompt: str, negative: str = "", width: int = 1024,
                         height: int = 1024, steps: int = 25) -> dict[str, Any]:
    api = (store.get_settings().get("image_api") or "").rstrip("/")
    if not api:
        return {"error": "Image generation isn't set up. Add your Stable Diffusion WebUI / Forge address in Settings → Integrations."}
    body = {
        "prompt": prompt, "negative_prompt": negative or "blurry, low quality, deformed, watermark, text",
        "width": int(width), "height": int(height), "steps": int(steps), "cfg_scale": 6, "sampler_name": "Euler a",
    }
    try:
        resp = await client.post(f"{api}/sdapi/v1/txt2img", json=body, timeout=600)
    except httpx.HTTPError as exc:
        return {"error": f"Couldn't reach the image generator at {api} — is it running with --api? ({exc.__class__.__name__})"}
    if resp.status_code != 200:
        return {"error": f"Image generator returned HTTP {resp.status_code}. Start it with the --api option."}
    images = resp.json().get("images") or []
    if not images:
        return {"error": "The image generator returned no image"}
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    name = f"athena-{time.strftime('%Y%m%d-%H%M%S')}-{store.new_id()[:4]}.png"
    path = IMAGES_DIR / name
    path.write_bytes(base64.b64decode(images[0].split(",", 1)[-1]))
    saved = str(path)
    pictures = Path.home() / "Pictures"
    if pictures.is_dir():
        target = pictures / "Athena"
        target.mkdir(exist_ok=True)
        shutil.copy2(path, target / name)
        saved = str(target / name)
    return {"image": f"/api/images/{name}", "saved_to": saved, "prompt": prompt}


# ---------------------------------------------------------- Home Assistant

CONTROLLABLE = ("light", "switch", "fan", "climate", "media_player", "cover", "lock", "scene", "script", "vacuum", "input_boolean", "humidifier")


def _ha() -> tuple[str, dict[str, str]]:
    s = store.get_settings()
    url, token = (s.get("ha_url") or "").rstrip("/"), s.get("ha_token") or ""
    if not url or not token:
        raise ValueError("Home Assistant isn't set up. Add its address and a long-lived access token in Settings → Integrations.")
    return url, {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


async def list_devices(client: httpx.AsyncClient, query: str = "") -> dict[str, Any]:
    try:
        url, headers = _ha()
        resp = await client.get(f"{url}/api/states", headers=headers, timeout=15)
        resp.raise_for_status()
    except ValueError as exc:
        return {"error": str(exc)}
    except httpx.HTTPError as exc:
        return {"error": f"Couldn't reach Home Assistant ({exc.__class__.__name__})"}
    q = (query or "").lower().strip()
    devices = []
    for e in resp.json():
        domain = e["entity_id"].split(".")[0]
        if domain not in CONTROLLABLE:
            continue
        name = e.get("attributes", {}).get("friendly_name") or e["entity_id"]
        if q and q not in name.lower() and q not in e["entity_id"]:
            continue
        item = {"entity_id": e["entity_id"], "name": name, "state": e["state"]}
        attrs = e.get("attributes", {})
        if domain == "light" and attrs.get("brightness") is not None:
            item["brightness"] = f"{round(attrs['brightness'] / 2.55)}%"
        if domain == "climate":
            item["target_temperature"] = attrs.get("temperature")
            item["current_temperature"] = attrs.get("current_temperature")
        devices.append(item)
    return {"devices": devices[:80], "count": len(devices)}


async def _resolve_entity(client, url, headers, target: str) -> str:
    if "." in target and " " not in target:
        return target
    resp = await client.get(f"{url}/api/states", headers=headers, timeout=15)
    names = {}
    for e in resp.json():
        if e["entity_id"].split(".")[0] in CONTROLLABLE:
            names[(e.get("attributes", {}).get("friendly_name") or e["entity_id"]).lower()] = e["entity_id"]
    t = target.lower()
    hit = names.get(t) or next((v for k, v in names.items() if t in k), None)
    if not hit:
        close = difflib.get_close_matches(t, list(names), n=1, cutoff=0.5)
        hit = names[close[0]] if close else None
    if not hit:
        raise ValueError(f"No device called '{target}'")
    return hit


async def control_device(client: httpx.AsyncClient, device: str, action: str, value: float | None = None) -> dict[str, Any]:
    try:
        url, headers = _ha()
        entity = await _resolve_entity(client, url, headers, device)
    except ValueError as exc:
        return {"error": str(exc)}
    except httpx.HTTPError as exc:
        return {"error": f"Couldn't reach Home Assistant ({exc.__class__.__name__})"}
    domain = entity.split(".")[0]
    action = action.lower().strip()
    data: dict[str, Any] = {"entity_id": entity}
    service = {"on": "turn_on", "off": "turn_off", "toggle": "toggle", "open": "open_cover", "close": "close_cover",
               "lock": "lock", "unlock": "unlock", "activate": "turn_on", "play": "media_play", "pause": "media_pause",
               "start": "start", "stop": "stop", "return_home": "return_to_base"}.get(action)
    if action == "brightness":
        service, domain = "turn_on", "light"
        data["brightness_pct"] = max(0, min(100, float(value or 0)))
    elif action == "temperature":
        service, domain = "set_temperature", "climate"
        data["temperature"] = float(value or 0)
    elif action == "volume":
        service, domain = "volume_set", "media_player"
        data["volume_level"] = max(0, min(1, float(value or 0) / 100))
    if domain in ("scene", "script") and action in ("on", "activate"):
        service = "turn_on"
    if not service:
        return {"error": f"Unknown action '{action}'"}
    try:
        resp = await client.post(f"{url}/api/services/{domain}/{service}", headers=headers, json=data, timeout=15)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        return {"error": f"Home Assistant refused that ({exc.__class__.__name__})"}
    return {"device": entity, "action": action, **({"value": value} if value is not None else {}), "ok": True}
