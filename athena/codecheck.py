"""Real-time code analysis for Code mode: find mistakes in the open project as it changes.

Python: syntax errors, plus undefined names and other real bugs (pyflakes, if installed).
JavaScript: syntax errors (when Node.js is installed). JSON: invalid files. HTML: unclosed tags.
Checked when a project opens, after every edit Athena makes (she sees the problems and fixes them), and every few
seconds while the project is open (so edits made in another editor show up too).
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)
MAX_FILES = 300
MAX_BYTES = 400_000
# pyflakes messages worth showing (real bugs, not style)
SERIOUS = ("undefined name", "local variable", "referenced before assignment", "redefinition of unused", "import *",
           "duplicate argument", "is not defined", "unable to detect undefined names", "syntax")


def _py(path: Path, text: str) -> list[dict[str, Any]]:
    try:
        compile(text, str(path), "exec")
    except SyntaxError as exc:
        return [{"line": exc.lineno or 1, "message": f"Syntax error: {exc.msg}", "severity": "error"}]
    try:
        from pyflakes.api import check
        from pyflakes.reporter import Reporter
    except ImportError:
        return []
    import io

    out, err = io.StringIO(), io.StringIO()
    check(text, str(path), Reporter(out, err))
    problems = []
    for line in out.getvalue().splitlines():
        m = re.match(r".*?:(\d+):(?:\d+:)?\s*(.*)", line)
        if m and any(k in m.group(2).lower() for k in SERIOUS):
            problems.append({"line": int(m.group(1)), "message": m.group(2), "severity": "error" if "undefined" in m.group(2) else "warning"})
    return problems


def _js(path: Path) -> list[dict[str, Any]]:
    node = shutil.which("node")
    if not node:
        return []
    try:
        r = subprocess.run([node, "--check", str(path)], capture_output=True, text=True, timeout=20, creationflags=FLAGS)
    except (OSError, subprocess.TimeoutExpired):
        return []
    if r.returncode == 0:
        return []
    err = r.stderr or ""
    m = re.search(r":(\d+)\n", err)
    msg = next((ln for ln in err.splitlines() if "Error" in ln), err.strip().splitlines()[-1] if err.strip() else "Syntax error")
    return [{"line": int(m.group(1)) if m else 1, "message": msg.strip()[:200], "severity": "error"}]


def _json(text: str) -> list[dict[str, Any]]:
    try:
        json.loads(text)
        return []
    except json.JSONDecodeError as exc:
        return [{"line": exc.lineno, "message": f"Invalid JSON: {exc.msg}", "severity": "error"}]


class _Tags(HTMLParser):
    IMPORTANT = {"div", "section", "main", "script", "style", "body", "html", "head", "table", "form", "ul", "ol", "template",
                 "nav", "header", "footer", "article", "aside", "button", "select", "textarea", "span", "a", "canvas", "svg"}
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "param"}

    def __init__(self) -> None:
        super().__init__()
        self.stack: list[tuple[str, int]] = []
        self.problems: list[dict[str, Any]] = []

    def handle_starttag(self, tag, attrs):
        if tag not in self.VOID:
            self.stack.append((tag, self.getpos()[0]))

    def handle_endtag(self, tag):
        if tag in self.VOID:
            return
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                for skipped, line in self.stack[i + 1:]:  # tags left open inside this one
                    if skipped in self.IMPORTANT:
                        self.problems.append({"line": line, "message": f"<{skipped}> is never closed", "severity": "warning"})
                del self.stack[i:]
                return
        self.problems.append({"line": self.getpos()[0], "message": f"</{tag}> closes a tag that was never opened", "severity": "warning"})


def _html(text: str) -> list[dict[str, Any]]:
    p = _Tags()
    try:
        p.feed(text)
    except Exception:
        return []
    open_left = [{"line": ln, "message": f"<{tag}> is never closed", "severity": "warning"} for tag, ln in p.stack if tag in p.IMPORTANT]
    return (p.problems + open_left)[:10]


def check_file(root: Path, path: Path) -> list[dict[str, Any]]:
    ext = path.suffix.lower()
    if ext not in (".py", ".js", ".mjs", ".cjs", ".json", ".html", ".htm"):
        return []
    try:
        if path.stat().st_size > MAX_BYTES:
            return []
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    if ext == ".py":
        found = _py(path, text)
    elif ext in (".js", ".mjs", ".cjs"):
        found = _js(path)
    elif ext == ".json":
        found = _json(text)
    else:
        found = _html(text)
    rel = path.relative_to(root).as_posix() if root in path.parents else path.name
    return [{"file": rel, **p} for p in found]


_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}  # file -> (modified time, problems): only re-check what changed


def check_project(root: Path, files: list[Path]) -> dict[str, Any]:
    problems: list[dict[str, Any]] = []
    checked = 0
    for f in files:
        if f.suffix.lower() in (".py", ".js", ".mjs", ".cjs", ".json", ".html", ".htm"):
            checked += 1
            try:
                mtime = f.stat().st_mtime
            except OSError:
                continue
            hit = _cache.get(str(f))
            if not hit or hit[0] != mtime:
                hit = _cache[str(f)] = (mtime, check_file(root, f))
            problems += hit[1]
            if checked >= MAX_FILES:
                break
    errors = sum(1 for p in problems if p["severity"] == "error")
    return {"problems": problems[:100], "errors": errors, "warnings": len(problems) - errors, "checked": checked,
            "js_checked": bool(shutil.which("node"))}
