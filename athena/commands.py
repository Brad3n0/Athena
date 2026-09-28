"""Everyday commands Athena runs straight away, like Jarvis, without waiting for the AI model to decide.

"open YouTube", "play lofi on YouTube", "message Jake on Discord: I'm on", "pause the music", "volume to 30"...
Anything that doesn't clearly match goes to the model as usual, so nothing is lost: this just makes the common
things instant and reliable. Actions that need your OK (like sending a message) still ask first.
"""
from __future__ import annotations

import re
from typing import Any

from .pc import SITES

Call = tuple[str, dict[str, Any]]

LEAD = r"^(?:hey |ok |okay )?(?:athena[, ]+)?(?:please |can you |could you |would you |will you |i want you to |go |just )*"
TAIL = r"(?:\s+(?:for me|please|now|real quick|rn))*[.!?]*$"
MSG_APPS = ("discord", "whatsapp", "whats app", "instagram", "insta", "messenger", "facebook", "telegram", "snapchat", "snap",
            "slack", "teams", "text", "email", "imessage", "sms", "x", "twitter", "reddit", "tiktok", "groupme", "signal")
APP_ALT = "|".join(sorted((re.escape(a) for a in MSG_APPS), key=len, reverse=True))
# Things that mean "open something on my PC" rather than an app or site; the model handles those.
NOT_A_TARGET = re.compile(r"\b(folder|file|files|document|documents|downloads|desktop|pictures|photos|settings|the|my|it|that|"
                          r"this|them|those|chat|conversation|tab|link|page|window|email from|message from)\b")
SEARCHABLE = {"youtube", "google", "spotify", "netflix", "twitch", "reddit", "amazon", "wikipedia", "maps", "google maps", "tiktok",
              "ebay", "github", "roblox", "pinterest", "soundcloud", "quizlet", "crunchyroll", "x", "twitter", "instagram", "facebook"}


def _site(name: str) -> str | None:
    key = re.sub(r"\s+", " ", name.lower().strip()).removesuffix(".com")
    return key if key in SITES else None


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def match(text: str) -> list[Call] | None:
    """The tool calls for a clear everyday command, or None to let the model handle it."""
    t = _clean(text)
    low = t.lower()
    if not low or len(low) > 300 or "\n" in text:
        return None

    # ---- messages: "message Jake on Discord saying I'm on", "tell the squad on discord that ...", "dm jake: yo"
    m = re.match(LEAD + r"(?:send\s+(?:a\s+)?(?:message|msg|text|dm)\s+to|message|msg|text|dm|tell|send)\s+(?P<who>.+?)\s+"
                 r"(?:on|in|through|via|over)\s+(?P<app>" + APP_ALT + r")\s*(?:saying|that says|to say|that|and say|and tell (?:them|him|her)|:|,|-)?\s+(?P<msg>.+)$",
                 low, re.I)
    if not m:
        m = re.match(LEAD + r"(?:send\s+(?:a\s+)?(?:message|msg|dm)\s+to|message|msg|dm)\s+(?P<who>.+?)\s*(?:saying|that says|to say|:|,)\s*(?P<msg>.+)$",
                     low, re.I)
    if m:
        who = t[m.start("who"):m.end("who")].strip(" ,:")  # as the user wrote it ("Jake", not "jake")
        who = re.sub(r"^(?:to|my friend)\s+", "", who, flags=re.I)
        who = re.sub(r"\s+(?:group ?chat|gc|group|chat|server|dms?)$", "", re.sub(r"^the\s+", "", who, flags=re.I), flags=re.I) or who
        app = (m.groupdict().get("app") or "discord").strip()
        start = m.start("msg")
        msg = t[start:].strip().strip('"“”')  # keep the user's capitals in the message itself
        vague = who.lower() in ("someone", "somebody", "anyone", "anybody", "people", "a friend", "my friends", "them", "him", "her")
        if who and msg and len(who.split()) <= 5 and not vague and msg.lower().strip(" .!?") not in ("for me", "please", "for me please"):
            return [("send_message", {"to": who, "app": app, "text": msg})]

    # ---- search Discord: "search discord for the minecraft ip", "find messages about the trip in the squad on discord",
    #      "search my dms with jake for that link", "look up tournament in discord"
    for pattern in (
        r"(?:search|look|check)\s+(?:through\s+)?(?:my\s+)?discord\s+(?:for|to find)\s+(?P<q>.+?)(?:\s+(?:in|from|with)\s+(?:the\s+|my\s+)?(?P<where>.+?))?",
        r"(?:search|look|check)\s+(?:through\s+)?(?:my\s+)?(?:dms?|chat|messages|server|group ?chat|gc)\s+(?:with|in)\s+(?P<where>.+?)\s+on\s+discord\s+for\s+(?P<q>.+?)",
        r"(?:search|look|check)\s+(?:through\s+)?(?:my\s+)?(?:dms?|chat|messages)\s+with\s+(?P<where>.+?)\s+for\s+(?P<q>.+?)(?:\s+on\s+discord)",
        r"(?:find|search(?:\s+for)?|look\s+(?:up|for))\s+(?:the\s+)?(?:messages?|stuff|posts?)?\s*(?:about|saying|with|mentioning)?\s*(?P<q>.+?)\s+(?:in|on)\s+(?:the\s+|my\s+)?(?P<where>.+?)\s+(?:on|in)\s+discord",
        r"(?:find|search(?:\s+for)?|look\s+(?:up|for))\s+(?:the\s+)?(?:messages?\s+)?(?:about|saying|mentioning\s+)?(?P<q>.+?)\s+(?:on|in)\s+(?:my\s+)?discord",
    ):
        m = re.match(LEAD + pattern + TAIL, low)
        if m and m.group("q").strip():
            q = re.sub(r"^(?:the|a|an)\s+", "", t[m.start("q"):m.end("q")].strip(" '\""), flags=re.I)
            where = t[m.start("where"):m.end("where")].strip() if m.groupdict().get("where") else ""
            where = re.sub(r"\s+(?:server|group ?chat|gc|chat|dms?)$", "", where, flags=re.I)
            return [("discord_search", {"query": q, **({"where": where} if where else {})})]

    # ---- play / search something on a site: "play lofi on spotify", "search youtube for cats", "look up x on amazon"
    m = re.match(LEAD + r"(?:play|put on|watch|listen to)\s+(?P<q>.+?)\s+on\s+(?P<site>spotify|soundcloud|twitch|netflix)" + TAIL, low)
    if m:
        return [("open_website", {"site": m.group("site"), "search": t[m.start("q"):m.end("q")]})]

    # ---- YouTube by name: "watch mrbeast", "put on markiplier's newest video", "pull up dream's channel",
    #      "play the latest mkbhd video", "play lofi on youtube"
    m = re.match(LEAD + r"(?:play|put on|watch|show me|pull up|bring up|open)\s+(?:the\s+)?(?P<q>.+?)(?:'s|s')\s+(?:latest|newest|new|last|most recent|recent)\s+(?:youtube\s+)?(?:video|upload|vid)(?:\s+on\s+youtube)?" + TAIL, low) or \
        re.match(LEAD + r"(?:play|put on|watch|show me|pull up|bring up|open)\s+(?:the\s+|a\s+)?(?:latest|newest|new|last|most recent|recent)\s+(?P<q>.+?)\s+(?:youtube\s+)?(?:video|upload|vid)(?:\s+on\s+youtube)?" + TAIL, low) or \
        re.match(LEAD + r"(?:play|put on|watch|show me|pull up)\s+(?:the\s+)?(?:latest|newest|last|most recent)\s+(?:youtube\s+)?(?:video|upload|vid)\s+(?:from|by)\s+(?P<q>.+?)(?:\s+on\s+youtube)?" + TAIL, low)
    if m:
        return [("watch_youtube", {"query": t[m.start("q"):m.end("q")], "what": "latest"})]
    m = re.match(LEAD + r"(?:open|pull up|show me|go to|bring up|take me to)\s+(?P<q>.+?)(?:'s|s')\s+(?:youtube\s+)?channel(?:\s+on\s+youtube)?" + TAIL, low) or \
        re.match(LEAD + r"(?:open|pull up|show me|go to|bring up)\s+(?:the\s+)?(?:youtube\s+)?channel\s+(?:of|for|called)\s+(?P<q>.+?)" + TAIL, low) or \
        re.match(LEAD + r"(?:pull up|bring up|show me|look up|find)\s+(?P<q>.+?)\s+on\s+youtube" + TAIL, low)
    if m and len(m.group("q").split()) <= 5:
        return [("watch_youtube", {"query": t[m.start("q"):m.end("q")], "what": "channel"})]
    m = re.match(LEAD + r"(?:play|put on|watch|listen to)\s+(?:some\s+)?(?P<q>.+?)\s+on\s+youtube" + TAIL, low)
    if m:
        return [("watch_youtube", {"query": t[m.start("q"):m.end("q")], "what": "auto"})]
    m = re.match(LEAD + r"(?:watch|put on)\s+(?:some\s+|a\s+(?:video|vid)\s+(?:from|by)\s+)?(?P<q>.+?)" + TAIL, low)
    if m and 0 < len(m.group("q").split()) <= 5 and not _site(m.group("q")) and not NOT_A_TARGET.search(m.group("q")) \
            and m.group("q") not in ("out", "tv", "a movie", "a show", "something", "youtube", "videos", "a video"):
        return [("watch_youtube", {"query": t[m.start("q"):m.end("q")], "what": "auto"})]

    m = re.match(LEAD + r"(?:search|look up|find)\s+(?P<site>[a-z ]+?)\s+for\s+(?P<q>.+?)" + TAIL, low) or \
        re.match(LEAD + r"(?:search(?: for)?|look up|find|look for)\s+(?P<q>.+?)\s+on\s+(?P<site>[a-z ]+?)" + TAIL, low)
    if m and _site(m.group("site")) in SEARCHABLE:
        return [("open_website", {"site": _site(m.group("site")), "search": t[m.start("q"):m.end("q")]})]

    # ---- find a game/app/file and open its folder: "find the folder my game crimson desert is in",
    #      "where is crimson desert installed", "open the crimson desert folder", "take me to my minecraft folder"
    for pattern in (
        r"(?:find|open|show(?: me)?|take me to|go to|pull up|bring up|locate)\s+(?:the\s+)?(?:folder|location|files?|install(?:ation)?(?: folder)?|directory)\s+(?:that\s+|where\s+)?(?:my\s+)?(?:game\s+|app\s+)?(?P<n>.+?)\s+(?:is|are)(?:\s+(?:in|installed|at|saved))?",
        r"(?:find|open|show(?: me)?|take me to|go to|locate)\s+(?:the\s+)?(?:folder|location|files?|install(?:ation)?(?: folder)?|directory)\s+(?:for|of)\s+(?:my\s+)?(?:game\s+|app\s+)?(?P<n>.+?)",
        r"(?:find|open|show(?: me)?|take me to|go to|locate)\s+(?:my\s+|the\s+)?(?P<n>.+?)\s+(?:game\s+)?(?:folder|files|install(?:ation)? folder|directory|location)",
        r"where(?:'s| is| are)\s+(?:my\s+)?(?:game\s+|app\s+)?(?P<n>.+?)\s+(?:installed|saved|located|at|on my (?:pc|computer))",
        r"(?:find|locate)\s+(?:my\s+)?(?:game|app)\s+(?P<n>.+?)",
        r"(?:show me|tell me|find|find out)\s+where\s+(?:my\s+)?(?:game\s+|app\s+)?(?P<n>.+?)\s+(?:is|are)(?:\s+(?:installed|saved|located|at))?",
    ):
        m = re.match(LEAD + pattern + TAIL, low)
        if m and 0 < len(m.group("n").split()) <= 5:
            n = t[m.start("n"):m.end("n")].strip(" '\"")
            return [("find_installed", {"name": n, "open": True})]

    # ---- open an app or site: "open youtube", "launch spotify", "pull up netflix", "open discord and spotify"
    m = re.match(LEAD + r"(?:open|launch|start|run|load|go to|pull up|bring up|fire up|boot up)\s+(?:up\s+)?(?P<what>.+?)" + TAIL, low)
    if m:
        what = m.group("what").strip()
        parts = [p.strip() for p in re.split(r"\s*(?:,|\band\b|&)\s*", what) if p.strip()]
        if 0 < len(parts) <= 4 and all(len(p.split()) <= 3 and not NOT_A_TARGET.search(p) for p in parts):
            # Installed apps first (Spotify, Discord, Roblox...); open_app falls back to the website for sites like YouTube.
            return [("open_website", {"site": p}) if re.search(r"\.[a-z]{2,}$", p) else ("open_app", {"name": p}) for p in parts]

    # ---- music and video
    if re.match(LEAD + r"(?:pause|resume|unpause|play)(?: the)?(?: music| song| video| spotify| it)?" + TAIL, low):
        return [("media_control", {"action": "play_pause"})]
    if re.match(LEAD + r"(?:next|skip)(?: this| the)?(?: song| track| video)?" + TAIL, low) or re.match(LEAD + r"play the next (?:song|track)" + TAIL, low):
        return [("media_control", {"action": "next"})]
    if re.match(LEAD + r"(?:previous|last|go back(?: a| one)?)(?: song| track)" + TAIL, low):
        return [("media_control", {"action": "previous"})]
    if re.match(LEAD + r"stop(?: the)? (?:music|song|video|playing)" + TAIL, low):
        return [("media_control", {"action": "stop"})]

    # ---- volume
    m = re.match(LEAD + r"(?:set |turn |put )?(?:the )?volume (?:to |at )?(?P<n>\d{1,3})(?: ?%| percent)?" + TAIL, low)
    if m:
        return [("set_volume", {"level": min(100, int(m.group("n")))})]
    if re.match(LEAD + r"(?:turn (?:it|the volume|the sound) up|volume up|louder|make it louder|turn up the volume)" + TAIL, low):
        return [("set_volume", {"change": 15})]
    if re.match(LEAD + r"(?:turn (?:it|the volume|the sound) down|volume down|quieter|make it quieter|turn down the volume)" + TAIL, low):
        return [("set_volume", {"change": -15})]
    if re.match(LEAD + r"(?:mute|unmute)(?: the)?(?: sound| volume| pc| computer)?" + TAIL, low):
        return [("set_volume", {"mute": True})]

    # ---- windows and PC
    if re.match(LEAD + r"(?:minimi[sz]e everything|show (?:me )?(?:the |my )?desktop|hide (?:all|everything))" + TAIL, low):
        return [("window_control", {"action": "minimize_all"})]
    m = re.match(LEAD + r"close\s+(?P<app>[a-z0-9 .+]+?)" + TAIL, low)
    if m and len(m.group("app").split()) <= 3 and not NOT_A_TARGET.search(m.group("app")):
        return [("window_control", {"action": "close", "app": m.group("app").strip()})]
    if re.match(LEAD + r"lock (?:my |the )?(?:pc|computer|screen)" + TAIL, low):
        return [("lock_computer", {})]
    if re.match(LEAD + r"(?:how(?:'s| is) my (?:pc|computer) (?:doing|running)|pc status|check my (?:pc|computer))" + TAIL, low):
        return [("pc_status", {})]
    return None


NICE = {"youtube": "YouTube", "tiktok": "TikTok", "github": "GitHub", "soundcloud": "SoundCloud", "x": "X", "ebay": "eBay",
        "google maps": "Google Maps", "disney plus": "Disney+"}


def _nice(name: str) -> str:
    key = str(name or "").strip().lower()
    return NICE.get(key) or (key if "." in key or "/" in key else " ".join(w.capitalize() for w in key.split()))


def confirm(results: list[tuple[str, dict[str, Any], Any]]) -> str:
    """A short, spoken-style reply for what just happened."""
    lines = []
    for name, args, r in results:
        r = r if isinstance(r, dict) else {}
        if r.get("denied"):
            lines.append("Okay, I won't." if name != "send_message" else "Okay, I didn't send it.")
        elif r.get("error"):
            lines.append(f"I couldn't do that: {r['error']}")
        elif name == "open_website":
            label = _nice(args.get("site", "it"))
            lines.append(f"Searching {label} for {args['search']}." if args.get("search") else f"Opening {label}.")
        elif name == "watch_youtube":
            if r.get("latest"):
                lines.append(f"Here's {r.get('channel')}'s newest video: {r.get('title')}.")
            elif r.get("title"):
                lines.append(f"Playing {r['title']}" + (f" by {r['channel']}." if r.get("channel") else "."))
            elif r.get("channel"):
                lines.append(f"Here's {r['channel']}'s channel.")
            else:
                lines.append(r.get("note") or f"Here's what YouTube has for {args.get('query')}.")
        elif name == "discord_search":
            lines.append(f"Searching Discord for {args.get('query')}" + (f" in {args['where']}." if args.get("where") else "."))
        elif name == "click_on_screen":
            if r.get("clicked") or r.get("found_by"):
                lines.append(f"Playing {r.get('clicked') or args.get('text')}.")
        elif name == "open_app":
            opened = str(r.get("opened") or "")
            if r.get("youtube_channel"):
                lines.append(f"Pulling up {r['youtube_channel']} on YouTube.")
            else:
                lines.append(f"Opening {_nice(args.get('name', '')) if opened.startswith('http') or not opened else opened}.")
        elif name == "send_message":
            lines.append(f"Sent to {r.get('to') or args.get('to')}." if r.get("sent") else str(r.get("note") or "Done."))
        elif name == "media_control":
            lines.append({"play_pause": "Done.", "next": "Skipping.", "previous": "Going back.", "stop": "Stopped."}.get(args.get("action"), "Done."))
        elif name == "set_volume":
            lines.append(f"Volume at {r['volume']}." if isinstance(r.get("volume"), (int, float)) else
                         "Muted." if r.get("mute_toggled") and args.get("mute") else "Done.")
        elif name == "window_control":
            lines.append("Done.")
        elif name == "find_installed":
            best = r.get("best") or {}
            if r.get("opened"):
                where = f" ({best.get('found_with')})" if best.get("found_with") and best.get("found_with") != "your files" else ""
                lines.append(f"Found {best.get('name') or args.get('name')}{where}. Opening its folder.")
            elif best:
                lines.append(f"{best.get('name')} is in {best.get('folder')}.")
            else:
                lines.append(f"I couldn't find {args.get('name')} on this PC.")
        elif name == "lock_computer":
            lines.append("Locking your PC.")
        elif name == "pc_status":
            cpu, mem = r.get("cpu") or {}, r.get("memory") or {}
            c, m_ = cpu.get("usage_percent"), mem.get("used_percent")
            busy = (r.get("busiest_apps_cpu") or [{}])[0].get("app")
            if c is None:
                lines.append("Here's your PC status.")
            else:
                lines.append(("Your PC's doing fine" if c < 85 and (m_ or 0) < 90 else "Your PC is working hard")
                             + f": CPU at {round(c)}%, memory at {round(m_ or 0)}%" + (f", mostly {busy}." if busy and c >= 40 else "."))
        else:
            lines.append("Done.")
    text = " ".join(dict.fromkeys(line for line in lines if line))
    return text or "Done."
