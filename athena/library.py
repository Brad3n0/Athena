"""Athena's knowledge library: what she has found out, kept on this PC so she gets smarter over time.

Everything she looks up (web searches, pages she read, deep research, sports stats) and every answer you rate 👍 is
saved here as short plain text. Before answering, she checks the library for anything related and uses it (with its
date, so old facts aren't treated as news). No model training and no extra download: plain keyword search, a few MB
even after a year. It never changes her personality. Clear it any time in Settings → About you.
"""
from __future__ import annotations

import json
import math
import re
import threading
import time
from typing import Any

from . import store

LIBRARY_FILE = store.DATA_DIR / "library.jsonl"
MAX_ENTRIES = 6000
MAX_TEXT = 1500
_lock = threading.Lock()
_cache: dict[str, Any] = {"mtime": -1.0, "items": []}
STOP = set("""a an the and or but if then of to in on at by for with from about into over after before is are was were be
been being it its this that these those i you he she they we me my your our their what which who whom how why when where
do does did can could should would will just so not no yes up down out as than too very also please tell show find
give get make""".split())

# Things that go stale fast: shown with a warning once they're this many days old
FRESH_DAYS = {"sports": 2, "search": 30, "page": 60, "research": 120, "answer": 365}


def _words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(w) > 1 and w not in STOP]


def _load() -> list[dict[str, Any]]:
    try:
        mtime = LIBRARY_FILE.stat().st_mtime
    except OSError:
        return []
    if _cache["mtime"] == mtime:
        return _cache["items"]
    items = []
    for line in LIBRARY_FILE.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            items.append(json.loads(line))
        except ValueError:
            continue
    _cache.update(mtime=mtime, items=items)
    return items


def add(kind: str, topic: str, text: str, source: str = "") -> bool:
    """Save something she found out. Skips near-duplicates (the newer copy replaces the older one)."""
    if not store.get_settings().get("library_enabled", True):
        return False
    topic = re.sub(r"\s+", " ", (topic or "").strip())[:200]
    text = re.sub(r"\s+", " ", (text or "").strip())[:MAX_TEXT]
    if len(text) < 40 or not topic:
        return False
    entry = {"id": store.new_id()[:10], "time": time.time(), "kind": kind, "topic": topic, "text": text, "source": source[:300]}
    with _lock:
        items = [x for x in _load() if not (x.get("topic", "").lower() == topic.lower() and x.get("kind") == kind)]
        items = (items + [entry])[-MAX_ENTRIES:]
        LIBRARY_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = LIBRARY_FILE.with_suffix(".tmp")
        tmp.write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in items), encoding="utf-8")
        tmp.replace(LIBRARY_FILE)
        _cache["mtime"] = -1.0
    return True


def search(query: str, limit: int = 3) -> list[dict[str, Any]]:
    """The saved entries most related to the question (keyword match, rarer words count more)."""
    q = set(_words(query))
    if len(q) < 1:
        return []
    items = _load()
    if not items:
        return []
    docs = [(x, _words(x.get("topic", "") + " " + x.get("topic", "") + " " + x.get("text", ""))) for x in items]
    df: dict[str, int] = {}
    for _x, words in docs:
        for w in set(words) & q:
            df[w] = df.get(w, 0) + 1
    n = len(docs)
    scored = []
    for x, words in docs:
        hits = set(words) & q
        if not hits:
            continue
        score = sum(math.log(1 + n / df[w]) for w in hits) / math.sqrt(1 + len(q))
        coverage = len(hits) / len(q)
        if coverage < 0.5 and len(q) > 2:
            continue
        score *= 0.5 + coverage
        score *= 1 + 0.1 * (x.get("kind") == "answer")  # answers you liked
        scored.append((score, x))
    scored.sort(key=lambda s: -s[0])
    return [x for s, x in scored[:limit] if s >= 1.2]


def prompt_note(query: str) -> str:
    """A short note for the model with what she already knows about this, or ''."""
    if not store.get_settings().get("library_enabled", True):
        return ""
    found = search(query)
    if not found:
        return ""
    lines = []
    for x in found:
        days = (time.time() - x.get("time", 0)) / 86400
        when = time.strftime("%b %d, %Y", time.localtime(x.get("time", 0)))
        stale = " (may be out of date now: check if it matters)" if days > FRESH_DAYS.get(x.get("kind", ""), 60) else ""
        lines.append(f"- [{when}{stale}] {x['topic']}: {x['text'][:700]}")
    return ("From your own library (things you found out earlier; use them if they help, and look things up again if "
            "they might have changed):\n" + "\n".join(lines))


def stats() -> dict[str, Any]:
    items = _load()
    kinds: dict[str, int] = {}
    for x in items:
        kinds[x.get("kind", "?")] = kinds.get(x.get("kind", "?"), 0) + 1
    size = LIBRARY_FILE.stat().st_size if LIBRARY_FILE.exists() else 0
    return {"entries": len(items), "kinds": kinds, "size_kb": round(size / 1024),
            "since": time.strftime("%b %d, %Y", time.localtime(items[0]["time"])) if items else None}


def remove(entry_id: str) -> bool:
    with _lock:
        items = _load()
        kept = [x for x in items if x.get("id") != entry_id]
        if len(kept) == len(items):
            return False
        tmp = LIBRARY_FILE.with_suffix(".tmp")
        tmp.write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in kept), encoding="utf-8")
        tmp.replace(LIBRARY_FILE)
        _cache["mtime"] = -1.0
    return True


def clear() -> None:
    with _lock:
        LIBRARY_FILE.unlink(missing_ok=True)
        _cache.update(mtime=-1.0, items=[])


# ------------------------------------------------------------------ what gets saved

def _brief(obj: Any, limit: int = MAX_TEXT) -> str:
    text = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
    return text[:limit]


def from_tool(name: str, args: dict[str, Any], result: Any) -> None:
    """Called after each tool runs: keep what's worth remembering."""
    if not isinstance(result, dict) or result.get("error") or result.get("denied"):
        return
    try:
        if name == "web_search" and result.get("results"):
            text = " | ".join(f"{r.get('title', '')}: {r.get('snippet', '')}" for r in result["results"][:5])
            add("search", str(args.get("query", "")), text, (result["results"][0] or {}).get("url", ""))
        elif name == "read_webpage" and (result.get("text") or result.get("content")):
            add("page", str(result.get("title") or args.get("url", "")), str(result.get("text") or result.get("content")),
                str(result.get("url") or args.get("url", "")))
        elif name.startswith("sports_"):
            topic = " ".join(str(args.get(k, "")) for k in ("player", "team", "league", "stat", "line", "opponent", "date") if args.get(k))
            add("sports", f"{name.replace('sports_', '')}: {topic}", _brief({k: v for k, v in result.items() if k != "recent_games"}))
        elif name == "get_weather":
            return  # changes hourly: not worth keeping
    except Exception:  # noqa: BLE001  # the library is a bonus; never break a reply over it
        pass


def from_answer(question: str, answer: str) -> bool:
    """A reply you rated 👍: keep the question and her answer."""
    return add("answer", question[:200], answer)


def from_research(question: str, report: str) -> bool:
    return add("research", question[:200], report)
