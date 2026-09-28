"""Photo editing, all on this PC: crop, rotate, brightness, filters, text, background removal and more.

Used by the chat ("make it black and white and crop it square") and by the photo editor (✏️ on any picture).
Edited pictures are saved like generated ones: in Athena's images folder and in Pictures/Athena.
"""
from __future__ import annotations

import base64
import io
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

from . import store

IMAGES_DIR = store.DATA_DIR / "images"
MAX_SIDE = 8000
last_output: dict[str, Any] = {"path": None, "time": 0.0}  # the newest picture Athena made or edited, for "now make it…"
_install_lock = threading.Lock()


class PhotoError(Exception):
    pass


# ------------------------------------------------------------------ in and out

def load(source: str) -> Image.Image:
    """A picture from a data URL, plain base64, one of Athena's images (/api/images/…) or a file path."""
    source = (source or "").strip()
    if not source:
        raise PhotoError("Which picture? Attach a photo first.")
    try:
        if source.startswith("/api/images/"):
            path = IMAGES_DIR / Path(source).name
        elif source.startswith("data:") or (len(source) > 200 and re.fullmatch(r"[A-Za-z0-9+/=\s]+", source[:400])):
            return _open(io.BytesIO(base64.b64decode(source.split(",", 1)[-1])))
        else:
            path = Path(source).expanduser()
        if not path.is_file():
            raise PhotoError(f"I couldn't find the picture {source}")
        return _open(path)
    except (OSError, ValueError) as exc:
        raise PhotoError(f"That doesn't look like a picture I can open ({exc.__class__.__name__})") from exc


def _open(fp: Any) -> Image.Image:
    img = Image.open(fp)
    img = ImageOps.exif_transpose(img)  # phone photos: stand them up the right way
    return img.convert("RGBA") if img.mode in ("RGBA", "LA", "P") else img.convert("RGB")


def save(img: Image.Image, fmt: str = "png", quality: int = 92, prefix: str = "edit", draft: bool = False) -> dict[str, Any]:
    fmt = {"jpeg": "jpg"}.get(fmt.lower(), fmt.lower())
    if fmt not in ("png", "jpg", "webp"):
        fmt = "png"
    if fmt == "jpg" and img.mode == "RGBA":  # JPG has no transparency: put it on white
        bg = Image.new("RGB", img.size, "white")
        bg.paste(img, mask=img.split()[3])
        img = bg
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    name = f"athena-{prefix}-{time.strftime('%Y%m%d-%H%M%S')}-{store.new_id()[:4]}.{fmt}"
    path = IMAGES_DIR / name
    img.save(path, "JPEG" if fmt == "jpg" else fmt.upper(), **({"quality": int(quality)} if fmt in ("jpg", "webp") else {}))
    saved = str(path)
    pictures = Path.home() / "Pictures"
    if draft:  # a step inside the photo editor: not a finished picture yet
        _tidy_drafts()
        return {"image": f"/api/images/{name}", "size": f"{img.width}×{img.height}", "draft": True}
    if pictures.is_dir():
        target = pictures / "Athena"
        target.mkdir(exist_ok=True)
        shutil.copy2(path, target / name)
        saved = str(target / name)
    remember(path)
    return {"image": f"/api/images/{name}", "saved_to": saved, "size": f"{img.width}×{img.height}"}


def _tidy_drafts() -> None:
    """Editor steps are temporary: keep the folder from filling up with them."""
    cutoff = time.time() - 24 * 3600
    for f in IMAGES_DIR.glob("athena-draft-*"):
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink()
        except OSError:
            pass


def remember(path: Path) -> None:
    last_output.update(path=Path(path), time=time.time())


# ------------------------------------------------------------------ edits

def _aspect(value: str) -> float | None:
    names = {"square": "1:1", "portrait": "4:5", "landscape": "16:9", "widescreen": "16:9", "story": "9:16", "phone": "9:16",
             "instagram": "1:1", "tiktok": "9:16", "youtube": "16:9", "thumbnail": "16:9", "wallpaper": "16:9"}
    v = names.get(str(value).lower().strip(), str(value))
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*", v)
    return float(m.group(1)) / float(m.group(2)) if m and float(m.group(2)) else None


def _crop(img: Image.Image, step: dict[str, Any]) -> Image.Image:
    w, h = img.size
    if box := step.get("box"):  # fractions 0-1 (or pixels) [left, top, right, bottom]
        l, t, r, b = (float(x) for x in box)
        if max(l, t, r, b) <= 1:
            l, t, r, b = l * w, t * h, r * w, b * h
        return img.crop((int(l), int(t), int(r), int(b)))
    ratio = _aspect(step.get("aspect") or "1:1") or 1.0
    if w / h > ratio:
        nw, nh = int(h * ratio), h
    else:
        nw, nh = w, int(w / ratio)
    where = str(step.get("position") or "center").lower()
    left = 0 if "left" in where else (w - nw) if "right" in where else (w - nw) // 2
    top = 0 if "top" in where else (h - nh) if "bottom" in where else (h - nh) // 2
    return img.crop((left, top, left + nw, top + nh))


def _tint(img: Image.Image, amount: float) -> Image.Image:
    """Warmer (amount > 0) or cooler (< 0)."""
    amount = max(-1.0, min(1.0, amount))
    rgb = img.convert("RGB")
    r, g, b = rgb.split()
    k = 1 + 0.18 * abs(amount)
    if amount > 0:
        r, b = r.point(lambda v: min(255, int(v * k))), b.point(lambda v: int(v / k))
    else:
        r, b = r.point(lambda v: int(v / k)), b.point(lambda v: min(255, int(v * k)))
    out = Image.merge("RGB", (r, g, b))
    return _keep_alpha(img, out)


def _keep_alpha(src: Image.Image, out: Image.Image) -> Image.Image:
    if src.mode == "RGBA":
        out = out.convert("RGBA")
        out.putalpha(src.split()[3])
    return out


def _font(size: int) -> ImageFont.ImageFont:
    for name in ("arialbd.ttf", "Arial Bold.ttf", "DejaVuSans-Bold.ttf", "segoeuib.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size) if hasattr(ImageFont, "load_default") else ImageFont.load_default()


def _text(img: Image.Image, step: dict[str, Any]) -> Image.Image:
    text = str(step.get("text") or "").strip()
    if not text:
        return img
    out = img.convert("RGBA")
    draw = ImageDraw.Draw(out)
    size = int(step.get("size") or max(18, out.width // 14))
    font = _font(size)
    box = draw.multiline_textbbox((0, 0), text, font=font, align="center")
    tw, th = box[2] - box[0], box[3] - box[1]
    where = str(step.get("position") or "bottom").lower()
    x = (out.width - tw) // 2
    y = int(out.height * 0.05) if "top" in where else (out.height - th) // 2 if "center" in where or "middle" in where \
        else out.height - th - int(out.height * 0.06)
    color = str(step.get("color") or "white")
    outline = "black" if color.lower() in ("white", "#fff", "#ffffff", "yellow") else "white"
    draw.multiline_text((x, y), text, font=font, fill=color, align="center", stroke_width=max(2, size // 14), stroke_fill=outline)
    return out if img.mode == "RGBA" else out.convert("RGB")


def _vignette(img: Image.Image, strength: float) -> Image.Image:
    strength = max(0.0, min(1.0, strength))
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse((-w * 0.15, -h * 0.15, w * 1.15, h * 1.15), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(max(w, h) * 0.12))
    dark = ImageEnhance.Brightness(img.convert("RGB")).enhance(1 - 0.75 * strength)
    return _keep_alpha(img, Image.composite(img.convert("RGB"), dark, mask))


def apply(img: Image.Image, steps: list[dict[str, Any]]) -> tuple[Image.Image, list[str]]:
    """Run edit steps in order. Returns the new picture and a short description of what was done."""
    done: list[str] = []
    for raw in steps or []:
        step = raw if isinstance(raw, dict) else {"op": str(raw)}
        op = str(step.get("op") or step.get("type") or "").lower().replace(" ", "_").replace("-", "_")
        amt = step.get("amount", step.get("value"))
        f = float(amt) if isinstance(amt, (int, float)) or (isinstance(amt, str) and re.fullmatch(r"-?\d+(\.\d+)?", amt)) else None
        if op in ("crop", "square"):
            img = _crop(img, step if op == "crop" else {"aspect": "1:1"})
            done.append("cropped")
        elif op in ("resize", "scale"):
            w, h = img.size
            if step.get("scale") or (op == "scale" and f):
                s = float(step.get("scale") or f)
                size = (int(w * s), int(h * s))
            else:
                nw, nh = step.get("width"), step.get("height")
                size = (int(nw), int(nh)) if nw and nh else (int(nw), int(h * int(nw) / w)) if nw else (int(w * int(nh) / h), int(nh)) if nh else (w, h)
            if max(size) > MAX_SIDE or min(size) < 1:
                raise PhotoError(f"That size is too big (max {MAX_SIDE} pixels a side).")
            img = img.resize(size, Image.LANCZOS)
            done.append(f"resized to {size[0]}×{size[1]}")
        elif op in ("rotate", "turn"):
            deg = f if f is not None else float(step.get("degrees") or 90)
            img = img.rotate(-deg, expand=True, resample=Image.BICUBIC, fillcolor=(0, 0, 0, 0) if img.mode == "RGBA" else "white")
            done.append(f"rotated {deg:g}°")
        elif op in ("flip", "mirror"):
            vertical = "vert" in str(step.get("direction") or "")
            img = ImageOps.flip(img) if vertical else ImageOps.mirror(img)
            done.append("flipped")
        elif op in ("brightness", "brighten", "brighter", "darken", "darker"):
            k = f if f is not None else (0.75 if op.startswith("dark") else 1.25)
            img = _keep_alpha(img, ImageEnhance.Brightness(img.convert("RGB")).enhance(k))
            done.append("brighter" if k >= 1 else "darker")
        elif op == "contrast":
            img = _keep_alpha(img, ImageEnhance.Contrast(img.convert("RGB")).enhance(f if f is not None else 1.25))
            done.append("contrast adjusted")
        elif op in ("saturation", "color", "vibrance", "saturate"):
            img = _keep_alpha(img, ImageEnhance.Color(img.convert("RGB")).enhance(f if f is not None else 1.3))
            done.append("colors adjusted")
        elif op in ("sharpness", "sharpen", "sharp"):
            img = _keep_alpha(img, ImageEnhance.Sharpness(img.convert("RGB")).enhance(f if f is not None else 2.0))
            done.append("sharpened")
        elif op in ("blur", "soften"):
            img = img.filter(ImageFilter.GaussianBlur(f if f is not None else 3))
            done.append("blurred")
        elif op in ("grayscale", "greyscale", "black_and_white", "bw", "b&w", "monochrome"):
            img = _keep_alpha(img, ImageOps.grayscale(img).convert("RGB"))
            done.append("black and white")
        elif op in ("sepia", "vintage", "old"):
            g = ImageOps.grayscale(img)
            img = _keep_alpha(img, ImageOps.colorize(g, black=(40, 26, 13), white=(255, 240, 200), mid=(170, 130, 85)))
            done.append("sepia")
        elif op in ("invert", "negative"):
            img = _keep_alpha(img, ImageOps.invert(img.convert("RGB")))
            done.append("inverted")
        elif op in ("warm", "warmer", "cool", "cooler", "temperature"):
            k = f if f is not None else (-0.5 if op.startswith("cool") else 0.5)
            img = _tint(img, k)
            done.append("warmer" if k > 0 else "cooler")
        elif op in ("auto", "enhance", "auto_enhance", "fix", "improve"):
            base = ImageOps.autocontrast(img.convert("RGB"), cutoff=1)
            base = ImageEnhance.Color(base).enhance(1.12)
            img = _keep_alpha(img, ImageEnhance.Sharpness(base).enhance(1.3))
            done.append("enhanced")
        elif op == "vignette":
            img = _vignette(img, f if f is not None else 0.5)
            done.append("vignette")
        elif op in ("text", "caption", "meme"):
            img = _text(img, step)
            done.append("text added")
        elif op in ("border", "frame"):
            size = int(f if f is not None else max(8, min(img.size) // 30))
            img = ImageOps.expand(img, border=size, fill=str(step.get("color") or "white"))
            done.append("border added")
        elif op in ("remove_background", "remove_bg", "cutout", "no_background", "transparent"):
            img = remove_background(img)
            done.append("background removed")
        elif op in ("format", "convert", "compress", "quality"):
            continue  # handled when saving
        elif op:
            raise PhotoError(f"I don't know the edit '{op}'. I can crop, resize, rotate, flip, brighten, darken, contrast, "
                             "saturation, sharpen, blur, black and white, sepia, invert, warm, cool, enhance, vignette, "
                             "text, border and remove the background.")
    return img, done


def edit(source: str, steps: list[dict[str, Any]], draft: bool = False) -> dict[str, Any]:
    img = load(source)
    img, done = apply(img, steps)
    fmt, quality = "png", 92
    for step in steps or []:
        if isinstance(step, dict) and str(step.get("op", "")).lower() in ("format", "convert", "compress", "quality"):
            fmt = str(step.get("format") or ("jpg" if str(step.get("op")).lower() in ("compress", "quality") else fmt))
            quality = int(step.get("quality") or (70 if str(step.get("op")).lower() == "compress" else quality))
            done.append(f"saved as {fmt.upper()}")
    if img.mode == "RGBA" and fmt == "png" and img.getextrema()[3][0] == 255:
        img = img.convert("RGB")  # nothing see-through: a normal picture
    return {**save(img, fmt, quality, prefix="draft" if draft else "edit", draft=draft), "edits": done}


# ------------------------------------------------------------------ background removal

def remover_installed() -> bool:
    try:
        import rembg  # noqa: F401
        return True
    except Exception:
        return False


def install_remover() -> None:
    """The background remover is an optional part (~150 MB with its model). Installed the first time it's needed."""
    with _install_lock:
        if remover_installed():
            return
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        r = subprocess.run([sys.executable, "-m", "pip", "install", "-q", "rembg[cpu]"], capture_output=True, text=True,
                           timeout=1200, creationflags=flags)
        if r.returncode != 0:
            raise PhotoError("I couldn't install the background remover: " + (r.stderr.strip().splitlines() or ["check your internet"])[-1])
        import importlib

        importlib.invalidate_caches()


_session: dict[str, Any] = {}


def remove_background(img: Image.Image) -> Image.Image:
    install_remover()
    try:
        from rembg import new_session, remove
    except Exception as exc:
        raise PhotoError(f"The background remover didn't load ({exc}). Restart Athena and try again.") from exc
    if "s" not in _session:  # a good general-purpose model (~170 MB, downloaded once), loaded once
        _session["s"] = new_session("isnet-general-use")
    return remove(img.convert("RGBA"), session=_session["s"])
