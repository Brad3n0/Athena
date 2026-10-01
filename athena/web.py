"""Web abilities: search the internet (DuckDuckGo, no account needed) and read pages."""
from __future__ import annotations

import html
import re
from html.parser import HTMLParser
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import httpx

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
MAX_PAGE = 12_000


def _clean(fragment: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()


def _real_url(href: str) -> str:
    href = html.unescape(href)
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    host = (parsed.hostname or "").lower()
    if (host == "duckduckgo.com" or host.endswith(".duckduckgo.com")) and parsed.path.startswith("/l/"):
        target = parse_qs(parsed.query).get("uddg", [""])[0]
        return unquote(target) or href
    return href


def parse_results(page: str, limit: int = 8) -> list[dict[str, str]]:
    results = []
    blocks = re.split(r'<div[^>]+class="[^"]*\bresult\b[^"]*"', page)[1:] or [page]
    for block in blocks:
        link = re.search(r'<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', block, re.S) or \
            re.search(r'<a[^>]+href="([^"]+)"[^>]+class="[^"]*result__a[^"]*"[^>]*>(.*?)</a>', block, re.S)
        if not link:
            continue
        url = _real_url(link.group(1))
        if "duckduckgo.com/y.js" in url or not url.startswith("http"):
            continue  # ads
        snippet = re.search(r'class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</(?:a|div|td)>', block, re.S)
        results.append({"title": _clean(link.group(2)), "url": url, "snippet": _clean(snippet.group(1)) if snippet else ""})
        if len(results) >= limit:
            break
    return results


def parse_lite(page: str, limit: int = 8) -> list[dict[str, str]]:
    results = []
    links = re.findall(r"<a[^>]+href=\"([^\"]+)\"[^>]+class='result-link'[^>]*>(.*?)</a>", page, re.S)
    links += re.findall(r'<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', page, re.S)
    snippets = re.findall(r"class=['\"]result-snippet['\"][^>]*>(.*?)</td>", page, re.S)
    for i, (href, title) in enumerate(links[:limit]):
        results.append({"title": _clean(title), "url": _real_url(href), "snippet": _clean(snippets[i]) if i < len(snippets) else ""})
    return results


async def search(client: httpx.AsyncClient, query: str, limit: int = 8) -> dict[str, Any]:
    query = (query or "").strip()
    if not query:
        return {"error": "No search query"}
    try:
        resp = await client.post("https://html.duckduckgo.com/html/", data={"q": query}, headers=UA, timeout=15, follow_redirects=True)
        results = parse_results(resp.text, limit)
        if not results:
            resp = await client.get("https://lite.duckduckgo.com/lite/", params={"q": query}, headers=UA, timeout=15, follow_redirects=True)
            results = parse_lite(resp.text, limit)
    except httpx.HTTPError as exc:
        return {"error": f"Web search failed — are you online? ({exc.__class__.__name__})"}
    if not results:
        return {"error": "No results (the search engine may be rate-limiting; try again in a minute)"}
    return {"query": query, "results": results}


class _TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "header", "form", "aside", "iframe"}
    BLOCK = {"p", "div", "section", "article", "li", "br", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "pre", "blockquote"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag == "title":
            self._in_title = True
        elif tag in self.BLOCK:
            self.parts.append("\n")
        if tag in ("h1", "h2", "h3"):
            self.parts.append("## ")
        elif tag == "li":
            self.parts.append("- ")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        elif tag == "title":
            self._in_title = False
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self.skip:
            self.parts.append(data)


def extract_text(page: str) -> tuple[str, str]:
    parser = _TextExtractor()
    parser.feed(page)
    text = "".join(parser.parts)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return parser.title.strip(), text.strip()


async def read_page(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        resp = await client.get(url, headers=UA, timeout=20, follow_redirects=True)
    except httpx.HTTPError as exc:
        return {"error": f"Couldn't open {url} ({exc.__class__.__name__})"}
    ctype = resp.headers.get("content-type", "")
    if "html" not in ctype and "text" not in ctype:
        return {"error": f"{url} is not a web page ({ctype or 'unknown type'})"}
    title, text = extract_text(resp.text) if "html" in ctype else ("", resp.text)
    return {"url": str(resp.url), "title": title, "content": text[:MAX_PAGE], "truncated": len(text) > MAX_PAGE}
