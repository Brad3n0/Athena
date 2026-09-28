"""Find where a game or app is installed: "find the folder my game Crimson Desert is in".

Looks where things really get installed on Windows, not just at file names:
installed-programs list (the same one as Settings → Apps), Steam libraries, Epic Games,
Xbox / Game Pass, and the usual game folders on every drive.
"""
from __future__ import annotations

import difflib
import json
import os
import re
import string
import sys
from pathlib import Path
from typing import Any, Iterator


def norm(text: str) -> str:
    """'Crimson Desert™', 'crimson_desert', 'CrimsonDesert' → 'crimsondesert'."""
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


FILLER = {"my", "the", "game", "games", "app", "apps", "program", "folder", "file", "files", "where", "is", "in", "of", "for",
          "installed", "install", "location", "a", "that", "its", "it"}


def initials(name: str) -> str:
    """'Counter-Strike 2' → 'cs2', 'Grand Theft Auto V' → 'gtav'."""
    return "".join(w[0] if not w.isdigit() else w for w in re.findall(r"[A-Za-z]+|\d+", name)).lower()


def score(query: str, name: str) -> float:
    """How well a name matches what the user said (0 = not at all, 1 = exactly)."""
    words = [w for w in re.split(r"\s+", (query or "").lower()) if w and w not in FILLER]
    query = " ".join(words) or query
    q, n = norm(query), norm(name)
    if not q or not n:
        return 0.0
    if q == n:
        return 1.0
    if len(q) >= 2 and q == initials(name):
        return 0.9
    if q in n:
        return 0.92 - min(0.2, (len(n) - len(q)) / 200)
    words = [norm(w) for w in re.split(r"\s+", query) if len(norm(w)) > 1]
    if words and all(w in n for w in words):
        return 0.85
    if n in q and len(n) >= 4:
        return 0.75
    return difflib.SequenceMatcher(None, q, n).ratio() * 0.9


def _drives() -> list[Path]:
    if not sys.platform.startswith("win"):
        return [Path("/")]
    return [Path(f"{d}:\\") for d in string.ascii_uppercase if os.path.exists(f"{d}:\\")]


# ------------------------------------------------------------------ sources

def _registry_apps() -> Iterator[tuple[str, str, str]]:
    """Installed programs: (name, folder, source)."""
    if not sys.platform.startswith("win"):
        return
    import winreg

    keys = [(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")]
    for hive, path in keys:
        try:
            root = winreg.OpenKey(hive, path)
        except OSError:
            continue
        for i in range(winreg.QueryInfoKey(root)[0]):
            try:
                sub = winreg.OpenKey(root, winreg.EnumKey(root, i))
                name = winreg.QueryValueEx(sub, "DisplayName")[0]
            except OSError:
                continue
            folder = ""
            for value in ("InstallLocation", "DisplayIcon", "InstallSource"):
                try:
                    raw = str(winreg.QueryValueEx(sub, value)[0]).strip().strip('"').split(",")[0]
                except OSError:
                    continue
                if raw:
                    p = Path(raw)
                    folder = str(p.parent if p.suffix.lower() in (".exe", ".ico", ".dll") else p)
                    break
            yield name, folder, "Installed apps"


def _steam_libraries() -> list[Path]:
    roots: list[Path] = []
    if sys.platform.startswith("win"):
        import winreg

        for hive, key in ((winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam"), (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam")):
            for value in ("SteamPath", "InstallPath"):
                try:
                    roots.append(Path(winreg.QueryValueEx(winreg.OpenKey(hive, key), value)[0]))
                except OSError:
                    pass
    roots += [Path(r"C:\Program Files (x86)\Steam"), Path.home() / ".steam" / "steam"]
    libs: list[Path] = []
    for root in roots:
        vdf = root / "steamapps" / "libraryfolders.vdf"
        if vdf.is_file():
            try:
                for m in re.finditer(r'"path"\s+"([^"]+)"', vdf.read_text(encoding="utf-8", errors="ignore")):
                    libs.append(Path(m.group(1).replace("\\\\", "\\")))
            except OSError:
                pass
        if (root / "steamapps").is_dir():
            libs.append(root)
    for d in _drives():  # libraries on other drives Steam might not list
        for guess in ("SteamLibrary", "Steam", "Games\\Steam", "Program Files (x86)\\Steam"):
            if (d / guess / "steamapps").is_dir():
                libs.append(d / guess)
    seen, out = set(), []
    for lib in libs:
        key = str(lib).lower()
        if key not in seen:
            seen.add(key)
            out.append(lib)
    return out


def _steam_games() -> Iterator[tuple[str, str, str]]:
    for lib in _steam_libraries():
        apps = lib / "steamapps"
        try:
            manifests = list(apps.glob("appmanifest_*.acf"))
        except OSError:
            continue
        for acf in manifests:
            try:
                text = acf.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            name = re.search(r'"name"\s+"([^"]+)"', text)
            folder = re.search(r'"installdir"\s+"([^"]+)"', text)
            if name and folder:
                yield name.group(1), str(apps / "common" / folder.group(1)), "Steam"


def _epic_games() -> Iterator[tuple[str, str, str]]:
    manifests = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "Epic" / "EpicGamesLauncher" / "Data" / "Manifests"
    try:
        items = list(manifests.glob("*.item"))
    except OSError:
        return
    for item in items:
        try:
            data = json.loads(item.read_text(encoding="utf-8", errors="ignore"))
        except (OSError, ValueError):
            continue
        if data.get("DisplayName") and data.get("InstallLocation"):
            yield data["DisplayName"], data["InstallLocation"], "Epic Games"


GAME_DIRS = ("XboxGames", "Games", "Program Files", "Program Files (x86)", "Program Files\\Epic Games", "Epic Games",
             "Program Files\\EA Games", "EA Games", "Riot Games", "Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games",
             "Program Files\\Rockstar Games", "Rockstar Games", "GOG Games", "Program Files (x86)\\GOG Galaxy\\Games",
             "Battle.net", "Program Files (x86)\\Battle.net", "SteamLibrary\\steamapps\\common",
             "Program Files (x86)\\Steam\\steamapps\\common")


def _folders_on_drives() -> Iterator[tuple[str, str, str]]:
    """Top-level folders in the usual game and app locations on every drive."""
    for d in _drives():
        for rel in GAME_DIRS:
            base = d / rel
            try:
                entries = list(os.scandir(base))
            except OSError:
                continue
            for e in entries:
                if e.is_dir(follow_symlinks=False) and not e.name.startswith((".", "$")):
                    label = "Xbox / Game Pass" if rel == "XboxGames" else f"{d}{rel}"
                    yield e.name, e.path, label


# ------------------------------------------------------------------ search

def find_installed(query: str, limit: int = 6) -> dict[str, Any]:
    query = (query or "").strip()
    if not query:
        return {"error": "What should I look for?"}
    found: dict[str, dict[str, Any]] = {}
    for source in (_steam_games, _epic_games, _registry_apps, _folders_on_drives):
        try:
            for name, folder, where in source():
                s = score(query, name)
                if s < 0.72:
                    continue
                key = folder.lower().rstrip("\\/") or name.lower()
                prev = found.get(key)
                exists = bool(folder) and os.path.isdir(folder)
                s += 0.05 if exists else -0.1
                if not prev or s > prev["score"]:
                    found[key] = {"name": name, "folder": folder, "found_with": where, "exists": exists, "score": round(s, 3)}
        except Exception:  # one broken source (odd registry entry, locked drive) shouldn't stop the others
            continue
    results = sorted(found.values(), key=lambda r: -r["score"])[:limit]
    if not results:
        return {"results": [], "note": f"I couldn't find anything called '{query}' installed on this PC. "
                                      "It may be named differently, or installed somewhere unusual; try find_files too."}
    return {"results": results, "best": results[0]}


def open_folder(folder: str) -> None:
    if sys.platform.startswith("win"):
        os.startfile(folder)  # type: ignore[attr-defined]


def reveal(path: str) -> None:
    """Open File Explorer at a file (with it selected) or inside a folder."""
    if not sys.platform.startswith("win"):
        return
    import subprocess

    if os.path.isdir(path):
        os.startfile(path)  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
