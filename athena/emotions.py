"""Emotion tracking: how the user seems, from each message they send (words, emoji, punctuation), and how that
changes over time. Instant and local (no AI call), so it never slows a reply down.

Athena gets a short note ("they seem stressed right now; earlier today they were tired") and reacts like a person
would. The mood history is in Settings → About you, and can be turned off or cleared there.
"""
from __future__ import annotations

import re
import time
from collections import Counter
from datetime import datetime
from typing import Any

from . import store

FILE = store.DATA_DIR / "moods.json"
MAX = 3000

MOODS = {  # mood: (emoji, words/phrases that suggest it)
    "excited": ("🤩", r"let'?s go+|hype[ds]?|can'?t wait|so excited|excited|lets goo|w+o+o+h*|yay+|finally!|pog|lfg|insane!"),
    "happy": ("😊", r"happy|great day|good day|awesome|amazing|love (it|this|that)|glad|nice!|thank(s| you) so much|feeling good|"
                    r"proud of|lol|lmao|haha+|😂|🤣|😄|😁|😊|🙂|😃"),
    "loving": ("🥰", r"love you|miss(ed)? you|ily|<3|❤️|💕|💖|😘|🥰|you'?re (the best|sweet|cute)"),
    "sad": ("😢", r"sad|depress|crying|cried|lonely|alone|hurt|heartbroken|miss (her|him|them)|down bad|feel(ing)? (down|low|empty)|"
                  r"😢|😭|💔|☹️|🙁|upset"),
    "stressed": ("😰", r"stress|anxious|anxiety|overwhelm|panic|worried|nervous|deadline|so much (work|homework)|freaking out|"
                       r"behind on|exam tomorrow|test tomorrow|can'?t focus|pressure"),
    "angry": ("😠", r"angry|mad at|pissed|furious|hate (this|it|that|my)|annoy|irritat|wtf|so done|fed up|😡|🤬|😠"),
    "tired": ("😴", r"tired|exhaust|sleepy|no sleep|didn'?t sleep|drained|worn out|burnt? out|burned out|😴|🥱|can'?t sleep"),
    "bored": ("😐", r"bored|boring|nothing to do|meh|so dull|😑|😐"),
}
PATTERNS = {m: re.compile(r"(?<!\w)(" + words + r")", re.I) for m, (_, words) in MOODS.items()}
NEGATION = re.compile(r"\b(not|n't|never|no longer|isn'?t|wasn'?t)\s+(\w+\s+)?$", re.I)


def detect(text: str) -> dict[str, Any]:
    """The strongest mood in a message, and how strongly it shows (0..1). 'neutral' when nothing stands out."""
    text = text or ""
    scores: Counter[str] = Counter()
    for mood, rx in PATTERNS.items():
        for m in rx.finditer(text):
            if NEGATION.search(text[max(0, m.start() - 20):m.start()]):
                continue  # "not tired", "I'm not sad"
            scores[mood] += 1
    shouting = len(re.findall(r"\b[A-Z]{3,}\b", text)) >= 2
    exclaim = text.count("!")
    if exclaim >= 2 and not scores:
        scores["excited"] += 1
    if not scores:
        return {"mood": "neutral", "intensity": 0.0}
    mood, n = scores.most_common(1)[0]
    intensity = min(1.0, 0.35 + 0.2 * n + (0.15 if shouting else 0) + 0.05 * min(exclaim, 3))
    return {"mood": mood, "intensity": round(intensity, 2)}


def record(mood: dict[str, Any]) -> None:
    items = store._read(FILE, [])
    items.append({"t": time.time(), "mood": mood["mood"], "intensity": mood.get("intensity", 0)})
    store._write(FILE, items[-MAX:])


def history() -> list[dict[str, Any]]:
    return store._read(FILE, [])


def clear() -> None:
    store._write(FILE, [])


def note(current: dict[str, Any]) -> str:
    """A line for Athena about how the user seems now and earlier today (empty if there's nothing worth saying)."""
    today = datetime.now().date()
    earlier = [x["mood"] for x in history()[:-1]
               if datetime.fromtimestamp(x["t"]).date() == today and x["mood"] != "neutral"][-12:]
    parts = []
    if current["mood"] != "neutral":
        how = "really " if current.get("intensity", 0) >= 0.7 else ""
        parts.append(f"The user seems {how}{current['mood']} right now.")
    if earlier:
        common = Counter(earlier).most_common(1)[0][0]
        if common != current["mood"]:
            parts.append(f"Earlier today they mostly seemed {common}.")
    if not parts:
        return ""
    return " ".join(parts) + " Let that shape your tone like a person who cares would (don't announce that you noticed unless it helps)."


def summary(days: int = 7) -> list[dict[str, Any]]:
    """Per day: the main mood and the counts, newest last (for Settings)."""
    out: dict[str, Counter] = {}
    cutoff = time.time() - days * 86400
    for x in history():
        if x["t"] >= cutoff and x["mood"] != "neutral":
            day = datetime.fromtimestamp(x["t"]).strftime("%a %b %d")
            out.setdefault(day, Counter())[x["mood"]] += 1
    return [{"day": d, "main": c.most_common(1)[0][0], "emoji": MOODS[c.most_common(1)[0][0]][0],
             "counts": dict(c)} for d, c in out.items()]


def emoji(mood: str) -> str:
    return MOODS.get(mood, ("🙂", ""))[0]
