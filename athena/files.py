"""File abilities: find, read, move, organize, write and delete files on this PC.

Athena may only touch folders listed in Settings → Abilities (by default your
Desktop, Documents, Downloads, Pictures, Music and Videos). Every batch of changes
is journaled so the last change can be undone; deletions go to the Recycle Bin.
"""
from __future__ import annotations

import fnmatch
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from . import store

HOME = Path.home()
DEFAULT_FOLDERS = ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos"]
JOURNAL_FILE = store.DATA_DIR / "file_journal.json"

CATEGORIES = {
    "Images": {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".svg", ".ico", ".raw", ".psd"},
    "Videos": {".mp4", ".mkv", ".mov", ".avi", ".wmv", ".webm", ".flv", ".m4v"},
    "Music": {".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma"},
    "Documents": {".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt", ".md", ".pages", ".epub"},
    "Spreadsheets": {".xls", ".xlsx", ".csv", ".ods", ".numbers"},
    "Presentations": {".ppt", ".pptx", ".odp", ".key"},
    "Archives": {".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".iso"},
    "Installers": {".exe", ".msi", ".dmg", ".pkg", ".deb", ".appimage", ".apk"},
    "Code": {".py", ".js", ".ts", ".html", ".css", ".json", ".java", ".c", ".cpp", ".cs", ".go", ".rs", ".php", ".rb", ".sh", ".bat", ".ps1", ".sql", ".xml", ".yml", ".yaml"},
}
TEXT_EXT = CATEGORIES["Code"] | {".txt", ".md", ".csv", ".log", ".ini", ".cfg", ".toml", ".env", ".tsv", ".srt"}
MAX_READ = 20_000
MAX_WALK = 30_000


class FileError(Exception):
    pass


# ------------------------------------------------------------- allowed folders

def default_roots() -> list[str]:
    roots = []
    for name in DEFAULT_FOLDERS:
        for base in (HOME, HOME / "OneDrive"):  # Windows often keeps these in OneDrive
            p = base / name
            if p.is_dir():
                roots.append(str(p))
                break
    return roots


def roots() -> list[Path]:
    configured = store.get_settings().get("file_folders") or default_roots()
    return [Path(os.path.expandvars(os.path.expanduser(r))).resolve() for r in configured if str(r).strip()]


def resolve(path: str, must_exist: bool = True) -> Path:
    """Turn what the model said ("Downloads/report.pdf", "~/Desktop", an absolute path) into a safe path."""
    raw = (path or "").strip().strip('"').strip("'")
    if not raw:
        raise FileError("No path given")
    allowed = roots()
    p = Path(os.path.expandvars(os.path.expanduser(raw)))
    if p.is_absolute():
        candidates = [p]
    else:
        first = p.parts[0].lower()
        candidates = [root.joinpath(*p.parts[1:]) for root in allowed if root.name.lower() == first]
        candidates += [HOME / p] + [root / p for root in allowed]
    inside = [c.resolve() for c in candidates if _inside(c.resolve(), allowed)]
    if not inside:
        raise FileError(f"'{raw}' is outside the folders Athena is allowed to use (Settings → Abilities)")
    for c in inside:
        if c.exists():
            return c
    if must_exist:
        raise FileError(f"Couldn't find '{raw}'")
    return inside[0]


def _inside(p: Path, allowed: list[Path]) -> bool:
    for root in allowed:
        try:
            p.relative_to(root)
            return True
        except ValueError:
            continue
    return False


def pretty(p: Path) -> str:
    try:
        return "~/" + p.relative_to(HOME).as_posix()
    except ValueError:
        return str(p)


def _unique(dest: Path) -> Path:
    if not dest.exists():
        return dest
    stem, suffix = dest.stem, dest.suffix
    for i in range(2, 1000):
        cand = dest.with_name(f"{stem} ({i}){suffix}")
        if not cand.exists():
            return cand
    raise FileError(f"Too many files named {dest.name}")


def _info(p: Path) -> dict[str, Any]:
    st = p.stat()
    item = {"name": p.name, "type": "folder" if p.is_dir() else "file", "modified": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M")}
    if p.is_file():
        item["size"] = _size(st.st_size)
    return item


def _size(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


# ---------------------------------------------------------------- journal

def _journal() -> list[dict[str, Any]]:
    return store._read(JOURNAL_FILE, [])


def _record(label: str, moves: list[tuple[Path, Path]], created: list[Path] | None = None) -> None:
    if not moves and not created:
        return
    batches = _journal()[-19:]
    batches.append({
        "label": label,
        "time": time.time(),
        "moves": [[str(a), str(b)] for a, b in moves],
        "created": [str(c) for c in (created or [])],
    })
    store._write(JOURNAL_FILE, batches)


# ------------------------------------------------------------------ tools

def list_folder(path: str = "", show_hidden: bool = False) -> dict[str, Any]:
    if not path:
        return {"allowed_folders": [pretty(r) for r in roots()]}
    folder = resolve(path)
    if not folder.is_dir():
        raise FileError(f"{pretty(folder)} is not a folder")
    items = []
    for child in sorted(folder.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower())):
        if not show_hidden and child.name.startswith((".", "~$")):
            continue
        try:
            items.append(_info(child))
        except OSError:
            continue
        if len(items) >= 300:
            break
    return {"folder": pretty(folder), "count": len(items), "items": items}


def find_files(query: str = "", folder: str = "", kind: str = "", contains: str = "", limit: int = 50) -> dict[str, Any]:
    bases = [resolve(folder)] if folder else roots()
    pattern = query.strip().lower()
    wildcard = any(ch in pattern for ch in "*?[")
    exts = CATEGORIES.get(kind.strip().capitalize()) if kind else None
    needle = contains.strip().lower()
    results, scanned = [], 0
    squashed = re.sub(r"[^a-z0-9]", "", pattern)  # "crimson desert" also finds "CrimsonDesert" and "crimson_desert"

    def matches(name: str) -> bool:
        low = name.lower()
        if wildcard:
            return fnmatch.fnmatch(low, pattern)
        return pattern in low or bool(squashed) and squashed in re.sub(r"[^a-z0-9]", "", low)

    for base in bases:
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if not d.startswith((".", "$")) and d not in ("node_modules", "__pycache__", "AppData")]
            if pattern and not exts and not needle:  # folders count too ("the folder my game is in")
                for d in dirnames:
                    if matches(d):
                        results.append({"path": pretty(Path(dirpath) / d), "type": "folder"})
            for name in filenames:
                scanned += 1
                if scanned > MAX_WALK:
                    break
                if pattern and not matches(name):
                    continue
                p = Path(dirpath) / name
                if exts is not None and p.suffix.lower() not in exts:
                    continue
                if needle:
                    if p.suffix.lower() not in TEXT_EXT or p.stat().st_size > 2_000_000:
                        continue
                    try:
                        if needle not in p.read_text(encoding="utf-8", errors="ignore").lower():
                            continue
                    except OSError:
                        continue
                try:
                    results.append({"path": pretty(p), **_info(p)})
                except OSError:
                    continue
                if len(results) >= min(int(limit or 50), 200):
                    return {"results": results, "count": len(results), "truncated": True}
    return {"results": results, "count": len(results)}


def read_file(path: str) -> dict[str, Any]:
    p = resolve(path)
    if p.is_dir():
        return list_folder(path)
    if p.suffix.lower() == ".pdf":
        try:
            from pypdf import PdfReader  # optional
            text = "\n".join((page.extract_text() or "") for page in PdfReader(str(p)).pages[:30])
        except ImportError:
            raise FileError("Reading PDFs needs the optional 'pypdf' package (pip install pypdf)")
    elif p.suffix.lower() in TEXT_EXT or p.stat().st_size < 200_000:
        text = p.read_text(encoding="utf-8", errors="replace")
        if "\x00" in text[:2000]:
            raise FileError(f"{p.name} is not a text file")
    else:
        raise FileError(f"{p.name} is not a text file")
    return {"path": pretty(p), "content": text[:MAX_READ], "truncated": len(text) > MAX_READ}


def create_folder(path: str) -> dict[str, Any]:
    p = resolve(path, must_exist=False)
    existed = p.exists()
    p.mkdir(parents=True, exist_ok=True)
    if not existed:
        _record(f"Create folder {p.name}", [], [p])
    return {"created": pretty(p), "already_existed": existed}


def move_file(source: str, destination: str) -> dict[str, Any]:
    src = resolve(source)
    dest = resolve(destination, must_exist=False)
    if dest.is_dir():
        dest = dest / src.name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest = _unique(dest)
    shutil.move(str(src), str(dest))
    _record(f"Move {src.name}", [(src, dest)])
    return {"moved": pretty(src), "to": pretty(dest)}


def copy_file(source: str, destination: str) -> dict[str, Any]:
    src = resolve(source)
    dest = resolve(destination, must_exist=False)
    if dest.is_dir():
        dest = dest / src.name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest = _unique(dest)
    (shutil.copytree if src.is_dir() else shutil.copy2)(str(src), str(dest))
    _record(f"Copy {src.name}", [], [dest])
    return {"copied": pretty(src), "to": pretty(dest)}


def write_file(path: str, content: str, overwrite: bool = False) -> dict[str, Any]:
    p = resolve(path, must_exist=False)
    if p.exists() and not overwrite:
        p = _unique(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content or "", encoding="utf-8")
    _record(f"Write {p.name}", [], [p])
    return {"written": pretty(p), "characters": len(content or "")}


def delete_file(path: str) -> dict[str, Any]:
    p = resolve(path)
    if p in roots():
        raise FileError("Athena won't delete one of your main folders")
    try:
        from send2trash import send2trash
    except ImportError:
        raise FileError("Deleting needs the 'send2trash' package — restart Athena with start.bat to install it")
    send2trash(str(p))
    return {"deleted": pretty(p), "note": "Moved to the Recycle Bin — restore it from there if needed."}


def plan_organize(folder: str, by: str = "type") -> tuple[Path, list[tuple[Path, Path]]]:
    base = resolve(folder)
    if not base.is_dir():
        raise FileError(f"{pretty(base)} is not a folder")
    moves = []
    for child in base.iterdir():
        if not child.is_file() or child.name.startswith((".", "~$")) or child.name.lower() == "desktop.ini":
            continue
        if by == "date":
            sub = datetime.fromtimestamp(child.stat().st_mtime).strftime("%Y-%m")
        else:
            ext = child.suffix.lower()
            sub = next((cat for cat, exts in CATEGORIES.items() if ext in exts), "Other")
        moves.append((child, base / sub / child.name))
    return base, moves


def organize_folder(folder: str, by: str = "type") -> dict[str, Any]:
    base, plan = plan_organize(folder, by)
    done, created = [], []
    for src, dest in plan:
        if not dest.parent.exists():
            dest.parent.mkdir(parents=True)
            created.append(dest.parent)
        final = _unique(dest)
        shutil.move(str(src), str(final))
        done.append((src, final))
    _record(f"Organize {base.name}", done, created)
    summary: dict[str, int] = {}
    for _, dest in done:
        summary[dest.parent.name] = summary.get(dest.parent.name, 0) + 1
    return {"organized": pretty(base), "moved_files": len(done), "into_folders": summary}


def undo_last_change() -> dict[str, Any]:
    batches = _journal()
    if not batches:
        return {"message": "There's nothing to undo."}
    batch = batches.pop()
    restored, skipped = 0, 0
    for src, dest in reversed(batch["moves"]):
        s, d = Path(src), Path(dest)
        if d.exists() and not s.exists():
            s.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(d), str(s))
            restored += 1
        else:
            skipped += 1
    removed = 0
    for c in reversed(batch.get("created", [])):
        p = Path(c)
        try:
            if p.is_dir() and not any(p.iterdir()):
                p.rmdir()
                removed += 1
            elif p.is_file() and not batch["moves"]:
                from send2trash import send2trash
                send2trash(str(p))
                removed += 1
        except Exception:
            skipped += 1
    store._write(JOURNAL_FILE, batches)
    return {"undid": batch["label"], "restored_files": restored, "removed": removed, "skipped": skipped}


# ------------------------------------------------------------- on screen

def open_on_screen(target: str) -> str:
    """Open a file/folder in its app (File Explorer for folders) or a URL in the browser."""
    if target.startswith(("http://", "https://")):
        import webbrowser

        webbrowser.open(target)
        return target
    p = resolve(target)
    if sys.platform.startswith("win"):
        os.startfile(str(p))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(p)])
    else:
        subprocess.Popen(["xdg-open", str(p)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return pretty(p)
