"""Code projects: open a folder of code in a chat and Athena can read it, search it and edit it.

Every edit is shown to you as a diff first (unless you allowed everything in that chat), a backup
of the old file is kept, and "undo" puts it back.
"""
from __future__ import annotations

import difflib
import fnmatch
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

import httpx

from . import store

SKIP_DIRS = {".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv", "env", ".env", "dist", "build",
             ".next", ".nuxt", "target", ".idea", ".vs", ".gradle", ".pytest_cache", ".mypy_cache", ".ruff_cache",
             "coverage", ".cache", "bin", "obj", ".terraform", "vendor", "Pods", ".dart_tool", ".turbo", ".parcel-cache"}
BINARY_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip", ".gz", ".7z", ".rar", ".exe", ".dll",
              ".so", ".dylib", ".bin", ".class", ".jar", ".pyc", ".o", ".obj", ".woff", ".woff2", ".ttf", ".otf", ".mp3",
              ".mp4", ".mov", ".wav", ".db", ".sqlite", ".lock", ".psd", ".onnx", ".gguf", ".safetensors", ".pt"}
MAX_FILES = 5000
MAX_READ_CHARS = 24_000  # per read: big enough for a real chunk, small enough to keep a local model fast
READ_WINDOW = 250  # lines read when no range is given (search_code first, then read around the hit)
BACKUPS = store.DATA_DIR / "code_backups"
JOURNAL = store.DATA_DIR / "code_journal.json"


class WorkspaceError(Exception):
    pass


def open_root(path: str | None) -> Path | None:
    """The folder the user opened for this chat, checked. None if no folder is open."""
    if not path or not str(path).strip():
        return None
    p = Path(os.path.expandvars(os.path.expanduser(str(path).strip().strip('"')))).resolve()
    if not p.is_dir():
        raise WorkspaceError(f"Folder not found: {path}")
    if p == Path(p.anchor) or p == Path.home():
        raise WorkspaceError("Pick a project folder, not a whole drive or your home folder.")
    return p


def _inside(root: Path, rel: str) -> Path:
    rel = (rel or "").strip().strip('"').replace("\\", "/")
    p = (root / rel.lstrip("/")).resolve() if not Path(rel).is_absolute() else Path(rel).resolve()
    try:
        p.relative_to(root)
    except ValueError:
        raise WorkspaceError(f"'{rel}' is outside the project folder") from None
    return p


def _rel(root: Path, p: Path) -> str:
    return p.relative_to(root).as_posix()


def _gitignore(root: Path) -> list[str]:
    try:
        lines = (root / ".gitignore").read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    return [ln.strip().rstrip("/") for ln in lines if ln.strip() and not ln.startswith(("#", "!"))]


def _ignored(rel: str, name: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(name, pat) or fnmatch.fnmatch(rel, pat.lstrip("/")) for pat in patterns)


def walk(root: Path) -> list[Path]:
    patterns = _gitignore(root)
    out: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        base = Path(dirpath)
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")
                             and not _ignored(_rel(root, base / d), d, patterns))
        for f in sorted(filenames):
            p = base / f
            if p.suffix.lower() in BINARY_EXT or _ignored(_rel(root, p), f, patterns):
                continue
            out.append(p)
            if len(out) >= MAX_FILES:
                return out
    return out


def summary(root: Path) -> dict[str, Any]:
    files = walk(root)
    langs: dict[str, int] = {}
    for f in files:
        if f.suffix:
            langs[f.suffix.lower()] = langs.get(f.suffix.lower(), 0) + 1
    top = sorted(langs.items(), key=lambda kv: -kv[1])[:5]
    return {"path": str(root), "name": root.name, "files": len(files), "languages": [k for k, _ in top],
            "git": (root / ".git").exists()}


def _is_text(p: Path) -> bool:
    try:
        with p.open("rb") as fh:
            return b"\x00" not in fh.read(4096)
    except OSError:
        return False


def _read(p: Path) -> str:
    if not p.is_file():
        raise WorkspaceError(f"No such file: {p.name}")
    if p.stat().st_size > 2_000_000 or not _is_text(p):
        raise WorkspaceError(f"{p.name} isn't a text file (or is too big to read)")
    return p.read_text(encoding="utf-8", errors="replace")


# ------------------------------------------------------------------ tools

def project_tree(root: Path, a: dict[str, Any]) -> dict[str, Any]:
    sub = str(a.get("folder") or "").strip()
    base = _inside(root, sub) if sub else root
    files = [f for f in walk(root) if base in f.parents or f.parent == base]
    lines = []
    for f in files[:600]:
        size = f.stat().st_size
        lines.append(f"{_rel(root, f)}  ({size // 1024} KB)" if size >= 10_240 else _rel(root, f))
    return {"project": root.name, "files": len(files), "tree": "\n".join(lines),
            **({"note": f"Showing 600 of {len(files)} files. Pass a folder to see more."} if len(files) > 600 else {})}


def read_code(root: Path, a: dict[str, Any]) -> dict[str, Any]:
    p = _inside(root, str(a.get("path", "")))
    text = _read(p)
    lines = text.splitlines()
    start = max(1, int(a.get("start_line") or 1))
    end = min(len(lines), int(a.get("end_line") or (start + READ_WINDOW - 1)))
    numbered, size = [], 0
    for i in range(start, end + 1):
        row = f"{i:>5}  {lines[i - 1]}"
        size += len(row) + 1
        if size > MAX_READ_CHARS:
            end = i - 1
            break
        numbered.append(row)
    out = {"path": _rel(root, p), "lines": f"{start}-{end} of {len(lines)}", "content": "\n".join(numbered)}
    if end < len(lines):
        out["note"] = (f"File continues ({len(lines)} lines). To find a specific part, search_code is faster than reading on; "
                       f"otherwise call read_code with start_line={end + 1}.")
    return out


def search_code(root: Path, a: dict[str, Any]) -> dict[str, Any]:
    query = str(a.get("query", ""))
    if not query:
        raise WorkspaceError("Nothing to search for")
    try:
        rx = re.compile(query if a.get("regex") else re.escape(query), re.I)
    except re.error as exc:
        raise WorkspaceError(f"Bad pattern: {exc}") from None
    glob = str(a.get("file_pattern") or "")
    hits, files_hit = [], set()
    for f in walk(root):
        rel = _rel(root, f)
        if glob and not fnmatch.fnmatch(f.name, glob) and not fnmatch.fnmatch(rel, glob):
            continue
        if rx.search(rel):
            files_hit.add(rel)
        if f.stat().st_size > 1_000_000 or not _is_text(f):
            continue
        try:
            for n, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                if rx.search(line):
                    hits.append(f"{rel}:{n}: {line.strip()[:200]}")
                    files_hit.add(rel)
                    if len(hits) >= 80:
                        return {"matches": hits, "note": "Stopped at 80 matches; search more specifically."}
        except OSError:
            continue
    return {"matches": hits, "files": sorted(files_hit)[:50]} if hits or files_hit else {"matches": [], "message": "No matches."}


def _diff(rel: str, old: str, new: str) -> str:
    return "".join(difflib.unified_diff(old.splitlines(keepends=True), new.splitlines(keepends=True),
                                        fromfile=f"a/{rel}", tofile=f"b/{rel}", n=3))


def _normalize_ws(s: str) -> str:
    return "\n".join(line.rstrip() for line in s.replace("\r\n", "\n").split("\n"))


LINE_NO = re.compile(r"^\s*\d+(?:  |\t|: |\| ?|→)")


def _strip_line_numbers(text: str) -> str:
    """Remove read_code's line numbers ("  267  <section…") if every line has one."""
    lines = text.split("\n")
    filled = [ln for ln in lines if ln.strip()]
    if filled and all(LINE_NO.match(ln) for ln in filled):
        return "\n".join(LINE_NO.sub("", ln, count=1) if ln.strip() else ln for ln in lines)
    return text


def _indent(line: str) -> str:
    return line[:len(line) - len(line.lstrip())]


def _loose_block(text: str, find: str, replace: str) -> tuple[int, int, str] | None:
    """Find `find` in `text` ignoring line numbers and indentation. Returns (start, end, re-indented replacement)
    when exactly one place matches, else None."""
    find, replace = _strip_line_numbers(find), _strip_line_numbers(replace)
    want = [ln.strip() for ln in find.strip("\n").split("\n")]
    while want and not want[-1]:
        want.pop()
    if not want or not any(want):
        return None
    lines = text.split("\n")
    hits = [i for i in range(len(lines) - len(want) + 1)
            if all(lines[i + k].strip() == w for k, w in enumerate(want))]
    if len(hits) != 1:
        return None
    i = hits[0]
    start = sum(len(ln) + 1 for ln in lines[:i])
    end = start + sum(len(ln) + 1 for ln in lines[i:i + len(want)]) - 1
    # Shift the replacement's indentation by however much the model's copy was off
    file_first = next(lines[i + k] for k, w in enumerate(want) if w)
    have = _indent(file_first)
    rep_lines = replace.strip("\n").split("\n")
    base = _indent(next((ln for ln in rep_lines if ln.strip()), ""))
    out = []
    for ln in rep_lines:
        if not ln.strip():
            out.append("")
        elif ln.startswith(base):
            out.append(have + ln[len(base):])
        else:
            out.append(have + ln.lstrip())
    return start, end, "\n".join(out)


def plan_edit(root: Path, a: dict[str, Any]) -> tuple[Path, str, str]:
    """Work out the new file text for edit_code / write_code without touching the disk."""
    p = _inside(root, str(a.get("path", "")))
    if "content" in a:  # write_code: whole file
        old = _read(p) if p.exists() else ""
        return p, old, str(a.get("content") or "")
    old = _read(p)
    find, replace = str(a.get("find", "")), str(a.get("replace", ""))
    if not find:
        raise WorkspaceError("edit_code needs 'find': the exact text to replace")
    crlf = "\r\n" in old
    text = old.replace("\r\n", "\n")
    find_n, replace_n = find.replace("\r\n", "\n"), replace.replace("\r\n", "\n")
    count = text.count(find_n)
    if count == 0:  # forgive trailing-space differences
        loose = _normalize_ws(text)
        if _normalize_ws(find_n) in loose:
            text, find_n = loose, _normalize_ws(find_n)
            count = text.count(find_n)
    if count == 0:  # small models often copy read_code's line numbers, or lose the indentation: match line by line
        block = _loose_block(text, find_n, replace_n)
        if block:
            start, end, replace_n = block
            new = text[:start] + replace_n + text[end:]
            return p, old, new.replace("\n", "\r\n") if crlf else new
    if count == 0:
        raise WorkspaceError("Couldn't find that exact text in the file. Use search_code to find the line, read_code a few "
                             "lines around it, and copy them exactly into 'find' (without the line numbers).")
    if count > 1 and not a.get("replace_all"):
        raise WorkspaceError(f"That text appears {count} times. Include more surrounding lines so it's unique, or set replace_all.")
    new = text.replace(find_n, replace_n) if a.get("replace_all") else text.replace(find_n, replace_n, 1)
    if crlf:
        new = new.replace("\n", "\r\n")
    return p, old, new


def approval(root: Path, name: str, a: dict[str, Any]) -> dict[str, Any] | None:
    from . import selfedit

    if name in selfedit.RUNNERS:
        return selfedit.approval(name)
    if name in ("edit_code", "write_code"):
        p, old, new = plan_edit(root, a)
        rel = _rel(root, p)
        if old == new:
            return None
        verb = "Create" if not p.exists() else "Edit"
        added = sum(1 for ln in new.splitlines() if ln) if not p.exists() else None
        return {"summary": f"{verb} {rel} in {root.name}" + (f" ({added} lines)" if added else ""), "diff": _diff(rel, old, new)[:40_000]}
    if name == "upload_to_github":
        remote = _git(root, "remote").stdout.split() if (root / ".git").exists() else []
        where = a.get("repo_url") or ("its GitHub repository" if "origin" in remote else
                                      f"a new {'public' if a.get('private') is False else 'private'} GitHub repository")
        return {"summary": f"Upload {root.name} to {where}:\ncommit \"{a.get('message') or 'Update from Athena'}\" and push"}
    if name == "run_in_project":
        return {"summary": f"Run this command in {root.name}:\n{a.get('command', '')}"}
    if name == "undo_code_edit":
        return None
    return None


def apply_edit(root: Path, a: dict[str, Any]) -> dict[str, Any]:
    p, old, new = plan_edit(root, a)
    rel = _rel(root, p)
    if old == new:
        return {"message": "No change needed; the file already has that content."}
    existed = p.exists()
    backup = None
    if existed:
        BACKUPS.mkdir(parents=True, exist_ok=True)
        backup = BACKUPS / f"{int(time.time() * 1000)}-{p.name}"
        shutil.copy2(p, backup)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(new, encoding="utf-8", newline="")
    journal = store._read(JOURNAL, [])[-49:]
    journal.append({"root": str(root), "path": str(p), "backup": str(backup) if backup else None, "time": time.time()})
    store._write(JOURNAL, journal)
    diff = _diff(rel, old, new)
    plus = sum(1 for ln in diff.splitlines() if ln.startswith("+") and not ln.startswith("+++"))
    minus = sum(1 for ln in diff.splitlines() if ln.startswith("-") and not ln.startswith("---"))
    out = {"edited" if existed else "created": rel, "added_lines": plus, "removed_lines": minus, "diff": diff[:20_000]}
    from . import codecheck

    found = codecheck.check_file(root, p)  # real-time check: she sees mistakes straight away and can fix them
    if found:
        out["problems_now"] = found[:10]
        out["next_step"] = "This file now has the problems listed in problems_now. Fix them before moving on."
    elif p.suffix.lower() in (".py", ".js", ".mjs", ".cjs", ".json", ".html", ".htm"):
        out["check"] = "No problems found in this file."
    return out


def undo(root: Path, _a: dict[str, Any]) -> dict[str, Any]:
    journal = store._read(JOURNAL, [])
    for i in range(len(journal) - 1, -1, -1):
        entry = journal[i]
        if entry["root"] != str(root):
            continue
        p = Path(entry["path"])
        if entry.get("backup") and Path(entry["backup"]).exists():
            shutil.copy2(entry["backup"], p)
            msg = {"restored": _rel(root, p)}
        elif p.exists():
            from send2trash import send2trash
            send2trash(str(p))
            msg = {"removed_new_file": _rel(root, p)}
        else:
            msg = {"message": "That file is already gone."}
        journal.pop(i)
        store._write(JOURNAL, journal)
        return msg
    return {"message": "No edits to undo in this project."}


def run_in_project(root: Path, a: dict[str, Any]) -> dict[str, Any]:
    command = str(a.get("command", "")).strip()
    if not command:
        raise WorkspaceError("No command given")
    timeout = min(int(a.get("timeout") or 120), 600)
    try:
        r = subprocess.run(command, shell=True, cwd=root, capture_output=True, text=True, timeout=timeout,
                           encoding="utf-8", errors="replace", env={**os.environ, "NO_COLOR": "1", "CI": "1"},
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        return {"timed_out": True, "seconds": timeout}
    return {"exit_code": r.returncode, "stdout": r.stdout[-8000:], "stderr": r.stderr[-6000:]}


# ------------------------------------------------------------------ new projects, screenshots, GitHub

PROJECTS_HOME_NAME = "Athena Projects"


def projects_home() -> Path:
    home = Path.home()
    docs = next((d for d in (home / "Documents", home / "OneDrive" / "Documents") if d.is_dir()), home)
    return docs / PROJECTS_HOME_NAME


def new_project(name: str) -> Path:
    """A fresh folder for something Athena builds from scratch, e.g. Documents/Athena Projects/snake-game."""
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "project").lower()).strip("-")[:50] or "project"
    base = projects_home()
    folder, n = base / slug, 2
    while folder.exists() and any(folder.iterdir()):
        folder, n = base / f"{slug}-{n}", n + 1
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def find_browser() -> str | None:
    """Edge or Chrome for taking screenshots in the background (Edge comes with Windows)."""
    env = os.environ.get("ATHENA_BROWSER")
    if env and Path(env).exists():
        return env
    candidates = []
    for base in filter(None, (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA"))):
        candidates += [Path(base) / "Microsoft/Edge/Application/msedge.exe", Path(base) / "Google/Chrome/Application/chrome.exe"]
    candidates += [Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")]
    for c in candidates:
        if c.exists():
            return str(c)
    for name in ("msedge", "google-chrome", "chromium", "chromium-browser", "chrome"):
        found = shutil.which(name)
        if found:
            return found
    return None


def screenshot(root: Path, target: str = "", width: int = 1280, height: int = 800, phone: bool = False) -> dict[str, Any]:
    """Open a page from the project (or a local address like http://localhost:3000) in an invisible browser and
    save a screenshot of it."""
    from .integrations import IMAGES_DIR

    browser = find_browser()
    if not browser:
        raise WorkspaceError("Screenshots need Microsoft Edge or Google Chrome installed")
    target = (target or "").strip()
    if target.startswith(("http://localhost", "http://127.0.0.1")):
        url = target
    else:
        page = _inside(root, target or "index.html")
        if page.is_dir():
            page = page / "index.html"
        if not page.is_file():
            htmls = [f for f in walk(root) if f.suffix.lower() in (".html", ".htm")]
            if not htmls:
                raise WorkspaceError("There's no web page to screenshot yet (no .html file in the project)")
            page = htmls[0]
        url = page.as_uri()
    if phone:
        width, height = 390, 844
    width, height = max(320, min(int(width), 2560)), max(320, min(int(height), 2000))
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    name = f"shot-{time.strftime('%Y%m%d-%H%M%S')}-{'phone' if phone else 'desktop'}.png"
    out = IMAGES_DIR / name
    import tempfile

    with tempfile.TemporaryDirectory(prefix="athena-shot-") as profile:  # a throwaway profile: never touches your browser data
        cmd = [browser, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
               f"--user-data-dir={profile}", f"--window-size={width},{height}", "--virtual-time-budget=4000",
               f"--screenshot={out}", url]
        if hasattr(os, "geteuid") and os.geteuid() == 0:  # Linux as root only; Windows keeps the browser's normal sandbox
            cmd.insert(1, "--no-sandbox")
        if phone:
            cmd.insert(-1, "--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")
        try:
            subprocess.run(cmd, capture_output=True, timeout=60, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except subprocess.TimeoutExpired:
            raise WorkspaceError("The page took too long to load for a screenshot") from None
    if not out.is_file() or out.stat().st_size < 100:
        raise WorkspaceError("The browser couldn't take a screenshot of that page")
    _trim_blank_bottom(out)
    return {"image": f"/api/images/{name}", "file": str(out), "size": f"{width}x{height}", "view": "phone" if phone else "computer",
            "page": url if url.startswith("http") else _rel(root, page)}


def _trim_blank_bottom(path: Path) -> None:
    """Chrome's background mode can leave a white strip under the page (the window is a bit taller than the page
    area). Trim it, but only when it's a short strip under a non-white page, so white pages stay untouched."""
    try:
        from PIL import Image

        img = Image.open(path).convert("RGB")
        w, h = img.size
        px = img.load()
        y = h - 1
        while y > 0 and all(px[x, y] == (255, 255, 255) for x in range(0, w, max(1, w // 40))):
            y -= 1
        strip = h - 1 - y
        if 20 <= strip <= 160:
            img.crop((0, 0, w, y + 1)).save(path)
    except Exception:
        pass


def _git(root: Path, *args: str, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace",
                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def git_publish(root: Path, a: dict[str, Any]) -> dict[str, Any]:
    """Save the project with Git and upload it to GitHub (the user approves first)."""
    if not shutil.which("git"):
        raise WorkspaceError("Uploading needs Git. Run update.bat once (it installs Git), or get it from git-scm.com.")
    message = str(a.get("message") or "Update from Athena").strip()[:200]
    repo_url = str(a.get("repo_url") or "").strip()
    if not (root / ".git").exists():
        _git(root, "init", "-b", "main")
    if not (root / ".gitignore").exists():
        (root / ".gitignore").write_text("node_modules/\n__pycache__/\n.venv/\n.env\n*.log\ndist/\nbuild/\n", encoding="utf-8")
    remotes = _git(root, "remote").stdout.split()
    if repo_url:
        if not re.match(r"^(https://github\.com/|git@github\.com:)[\w.-]+/[\w.-]+?(\.git)?/?$", repo_url):
            raise WorkspaceError("That doesn't look like a GitHub repository address (https://github.com/you/project)")
        _git(root, "remote", "set-url" if "origin" in remotes else "add", "origin", repo_url.rstrip("/"))
        remotes = ["origin"]
    _git(root, "add", "-A")
    commit = _git(root, "commit", "-m", message)
    committed = commit.returncode == 0
    if "Please tell me who you are" in commit.stderr or "user.email" in commit.stderr:
        # Git doesn't know your name yet: use your GitHub account (its private no-reply address), so the
        # commits show up as yours on GitHub.
        from . import github

        try:
            acc = github.account() or {}
        except github.GitHubError:
            acc = {}
        login = acc.get("login")
        _git(root, "config", "user.name", acc.get("name") or login or "Athena User")
        _git(root, "config", "user.email", f"{acc['id']}+{login}@users.noreply.github.com" if login and acc.get("id") else "athena@localhost")
        committed = _git(root, "commit", "-m", message).returncode == 0
    created = None
    if "origin" not in remotes:
        # No GitHub repository yet: make one on your account (private unless you say otherwise) and connect it.
        from . import github, store

        private = a.get("private")
        private = store.get_settings().get("github_private", True) if private is None else bool(private)
        try:
            created = github.create_repo(str(a.get("repo_name") or root.name), private, str(a.get("description") or ""))
        except (github.GitHubError, httpx.HTTPError) as exc:
            return {"saved_locally": committed, "uploaded": False, "next_step": str(exc)}
        _git(root, "remote", "add", "origin", created["clone_url"])
        remotes = ["origin"]
    branch = _git(root, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip() or "main"
    push = _git(root, "push", "-u", "origin", branch, timeout=300)
    if push.returncode != 0:
        err = (push.stderr or push.stdout).strip().splitlines()[-3:]
        raise WorkspaceError("GitHub didn't accept the upload: " + " ".join(err) + " (If a GitHub sign-in window appeared, sign in and try again.)")
    url = _git(root, "remote", "get-url", "origin").stdout.strip().removesuffix(".git")
    out = {"saved_locally": committed, "uploaded": True, "url": url, "branch": branch, "commit_message": message}
    if created:
        out.update(new_repository=created["full_name"], private=created.get("private"), url=created["html_url"])
    return out


RUNNERS = {"project_tree": project_tree, "read_code": read_code, "search_code": search_code,
           "edit_code": apply_edit, "write_code": apply_edit, "undo_code_edit": undo, "run_in_project": run_in_project,
           "upload_to_github": git_publish}


def run(root: Path, name: str, args: dict[str, Any]) -> dict[str, Any]:
    from . import selfedit

    try:
        if name in selfedit.RUNNERS:
            if not selfedit.is_self(root):
                return {"error": f"{name} only works when Athena's own code is open."}
            return selfedit.RUNNERS[name](root, args)
        if name == "upload_to_github" and selfedit.is_self(root):
            return {"error": "Athena's own code isn't uploaded from here; it updates from GitHub instead."}
        if name in ("edit_code", "write_code") and selfedit.is_self(root):
            first = Path(str(args.get("path") or "")).parts[:1]
            if first and first[0].lower() in ("data", "backups", ".git", ".venv", ".venv-voiceclone"):
                return {"error": "That folder holds the user's own data (chats, settings, backups); I don't edit it."}
        return RUNNERS[name](root, args)
    except WorkspaceError as exc:
        return {"error": str(exc)}
    except (OSError, ValueError, TypeError) as exc:
        return {"error": str(exc)}


def prompt(root: Path) -> str:
    from . import selfedit

    info = summary(root)
    langs = ", ".join(info["languages"]) or "unknown"
    if selfedit.is_self(root):
        return (f"\n\nAthena's own code is open ({info['files']} files) at {root}. Use project_tree, search_code and read_code "
                "to look, and edit_code for small changes." + selfedit.SELF_PROMPT)
    return (
        f"\n\nThe user opened their code project \"{info['name']}\" ({info['files']} files, mostly {langs}) at {root}. "
        "Work like a careful senior engineer: look before you change anything. Use project_tree to see the layout, "
        "search_code to find where things are, and read_code to read files (with line numbers). To change code, use "
        "edit_code with 'find' copied EXACTLY from the file (a few lines, enough to be unique) and the 'replace' text; "
        "use write_code only for new files or complete rewrites. Keep each edit small and focused, match the existing "
        "style, and never invent file contents you haven't read. The user sees each change as a diff and approves it. "
        "Use run_in_project for tests or build commands when useful. "
        "For anything visual, CHECK YOUR WORK like a pro: after writing it, call screenshot_page (and phone=true for layouts), "
        "read the description, fix anything that looks wrong, and screenshot again. When done, give a short report: what you "
        "built, the files, what the screenshots show, and 1-2 ideas for next steps. Offer upload_to_github when it's finished."
    )


def S(desc: str) -> dict[str, Any]:
    return {"type": "string", "description": desc}


SPECS = [
    ("project_tree", "List the files in the open code project (skips node_modules, .git, build output…).",
     {"folder": S("Optional sub-folder to list")}, []),
    ("read_code", "Read a file from the open code project, with line numbers.",
     {"path": S("File path relative to the project, e.g. src/app.js"),
      "start_line": {"type": "integer", "description": "First line (optional)"},
      "end_line": {"type": "integer", "description": "Last line (optional)"}}, ["path"]),
    ("search_code", "Search every file in the open code project for text (case-insensitive). Returns path:line: text.",
     {"query": S("Text to find"), "regex": {"type": "boolean", "description": "Treat query as a regular expression"},
      "file_pattern": S("Only search files matching this, e.g. *.py")}, ["query"]),
    ("edit_code", "Change part of a file in the open code project by replacing an exact piece of text. The user approves the diff.",
     {"path": S("File path relative to the project"), "find": S("Exact existing text to replace, copied from the file"),
      "replace": S("The new text"), "replace_all": {"type": "boolean", "description": "Replace every occurrence"}}, ["path", "find", "replace"]),
    ("write_code", "Create a new file (or completely rewrite one) in the open code project. The user approves the diff.",
     {"path": S("File path relative to the project"), "content": S("The complete file content")}, ["path", "content"]),
    ("screenshot_page", "Take a screenshot of a web page in the project (default index.html) or a local address like "
     "http://localhost:3000, show it to the user, and get a description of how it looks so you can check your work. "
     "Use it after building or changing anything visual; set phone=true to check the phone layout too.",
     {"page": S("File in the project (e.g. index.html) or http://localhost:PORT"), "phone": {"type": "boolean", "description": "Phone-size view"},
      "check": S("What to look for, e.g. 'is the score visible and the layout centered?'")}, []),
    ("upload_to_github", "Save the project with Git and upload it to the user's GitHub (the user approves). If it has no "
     "repository yet, Athena creates one on their account (private unless they ask for public) and gives the link.",
     {"message": S("Short description of the changes"), "repo_name": S("Name for a new repository (optional; default: the folder name)"),
      "private": {"type": "boolean", "description": "New repository private (default) or public"},
      "description": S("One-line description for a new repository (optional)"),
      "repo_url": S("An existing repository address, only if the user gives one")}, []),
    ("undo_code_edit", "Undo the most recent code edit in this project (restores the previous version of the file).", {}, []),
    ("run_in_project", "Run a shell command in the project folder, e.g. tests or a build (the user approves it first).",
     {"command": S("The command, e.g. npm test or python -m pytest"), "timeout": {"type": "integer", "description": "Seconds (default 120)"}},
     ["command"]),
]


def specs(root: Path | None = None) -> list[dict[str, Any]]:
    from . import selfedit

    items = SPECS
    if selfedit.is_self(root):  # working on Athena herself: check/restart/undo, and no uploading her code anywhere
        items = [s for s in SPECS if s[0] != "upload_to_github"] + selfedit.SPECS
    return [{"type": "function", "function": {"name": n, "description": d,
             "parameters": {"type": "object", "properties": p, "required": r}}} for n, d, p, r in items]


NAMES = {n for n, *_ in SPECS} | {"check_athena", "restart_athena", "undo_self_changes", "save_self_changes"}
NEW_PROJECT_SPEC = {"type": "function", "function": {
    "name": "new_project", "description": "Create a new project folder (in Documents/Athena Projects) to build something real in: "
    "multiple files, running it, screenshots, uploading to GitHub. Gives you the project tools.",
    "parameters": {"type": "object", "properties": {"name": S("Short project name, e.g. snake-game")}, "required": ["name"]}}}


def pick_folder() -> str | None:
    """Show the PC's own folder picker (works when Athena runs on this computer)."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as exc:
        raise WorkspaceError("The folder picker isn't available. Type or paste the folder path instead.") from exc
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        chosen = filedialog.askdirectory(title="Open a code project folder", mustexist=True)
    finally:
        root.destroy()
    return chosen or None
