"""Watch YouTube by name: "watch MrBeast" plays their newest video, "pull up Markiplier's channel" opens it,
"play lofi on YouTube" plays the top video. Reads YouTube's public pages (no account or API key needed).
If anything goes wrong it falls back to opening the YouTube search results, so you always land somewhere useful.
"""
from __future__ import annotations

import difflib
import json
import re
import webbrowser
from typing import Any, Iterator
from urllib.parse import quote_plus

import httpx

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
           "Accept-Language": "en-US,en;q=0.9"}
COOKIES = {"CONSENT": "YES+1", "SOCS": "CAI"}  # skip the cookie-consent page in some countries
CHANNELS_ONLY = "EgIQAg%3D%3D"


def _page_data(url: str) -> dict[str, Any]:
    r = httpx.get(url, headers=HEADERS, cookies=COOKIES, timeout=12, follow_redirects=True)
    r.raise_for_status()
    m = re.search(r"(?:var ytInitialData|window\[\"ytInitialData\"\])\s*=\s*(\{.*?\});\s*</script>", r.text, re.S)
    if not m:
        raise ValueError("no page data")
    return json.loads(m.group(1))


def _walk(node: Any, key: str) -> Iterator[dict[str, Any]]:
    """Every object under `key`, in page order."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == key and isinstance(v, dict):
                yield v
            else:
                yield from _walk(v, key)
    elif isinstance(node, list):
        for item in node:
            yield from _walk(item, key)


def _text(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    return node.get("simpleText") or "".join(r.get("text", "") for r in node.get("runs") or [])


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _same_name(query: str, title: str, handle: str = "") -> bool:
    q, t, h = _norm(query), _norm(title), _norm(handle)
    if not q:
        return False
    return q in (t, h) or difflib.SequenceMatcher(None, q, t).ratio() >= 0.8 or (len(q) >= 4 and h.startswith(q))


def find_channel(name: str) -> dict[str, Any] | None:
    """The YouTube channel called `name` (e.g. "mr beast" → MrBeast), or None if no channel clearly matches."""
    data = _page_data(f"https://www.youtube.com/results?search_query={quote_plus(name)}&sp={CHANNELS_ONLY}")
    for ch in list(_walk(data, "channelRenderer"))[:5]:
        title = _text(ch.get("title"))
        base = ((ch.get("navigationEndpoint") or {}).get("browseEndpoint") or {}).get("canonicalBaseUrl") or ""
        handle = base.lstrip("/@") if base.startswith("/@") else _text(ch.get("subscriberCountText")).lstrip("@")
        if _same_name(name, title, handle):
            path = base or f"/channel/{ch.get('channelId')}"
            return {"title": title, "url": f"https://www.youtube.com{path}"}
    return None


def _videos(data: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Videos on a page, in order: the classic layout (videoRenderer) and the newer one (lockupViewModel)."""
    found = False
    for v in _walk(data, "videoRenderer"):
        if v.get("videoId") and not v.get("upcomingEventData"):
            found = True
            yield {"id": v["videoId"], "title": _text(v.get("title")), "channel": _text(v.get("ownerText"))}
    if found:
        return
    for v in _walk(data, "lockupViewModel"):
        if v.get("contentId") and "VIDEO" in str(v.get("contentType", "VIDEO")):
            meta = ((v.get("metadata") or {}).get("lockupMetadataViewModel") or {})
            yield {"id": v["contentId"], "title": ((meta.get("title") or {}).get("content") or ""), "channel": ""}


def latest_video(channel_url: str) -> dict[str, Any] | None:
    v = next(_videos(_page_data(channel_url.rstrip("/") + "/videos")), None)
    return {"title": v["title"], "url": f"https://www.youtube.com/watch?v={v['id']}"} if v else None


def top_video(query: str) -> dict[str, Any] | None:
    v = next(_videos(_page_data(f"https://www.youtube.com/results?search_query={quote_plus(query)}")), None)
    return {"title": v["title"], "channel": v["channel"], "url": f"https://www.youtube.com/watch?v={v['id']}"} if v else None


def watch(query: str, what: str = "auto") -> dict[str, Any]:
    """what: auto (a YouTuber's newest video, else the top video), latest, channel, or video (top video for a search)."""
    query = re.sub(r"\s+", " ", (query or "").strip(" '\"")).removesuffix("'s")
    if not query:
        return {"error": "What should I put on?"}
    fallback = f"https://www.youtube.com/results?search_query={quote_plus(query)}"
    result: dict[str, Any] = {}
    try:
        channel = find_channel(query) if what in ("auto", "latest", "channel") else None
        if channel and what == "channel":
            result = {"opened": channel["url"], "channel": channel["title"]}
        elif channel:
            vid = latest_video(channel["url"])
            result = ({"opened": vid["url"], "title": vid["title"], "channel": channel["title"], "latest": True} if vid
                      else {"opened": channel["url"], "channel": channel["title"]})
        elif what == "channel":
            result = {"opened": fallback, "note": f"I couldn't find a channel called {query}, so here are the results."}
        else:
            vid = top_video(query + (" latest video" if what == "latest" else ""))
            result = {"opened": vid["url"], "title": vid["title"], "channel": vid.get("channel")} if vid else {}
    except (httpx.HTTPError, ValueError, KeyError):
        result = {}
    if not result:
        result = {"opened": fallback, "search": query}
    webbrowser.open(result["opened"])
    return result
