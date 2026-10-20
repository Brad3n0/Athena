"""Humanize: rewrite stiff, AI-sounding text so it reads like a person wrote it, plus a rough "robot meter".

Everything here runs offline with Athena's own model. The meter is a home-made heuristic (sentence rhythm, stock AI
phrases, contractions, dashes), not a real AI detector, so treat its number as a hint, not a verdict.
"""
from __future__ import annotations

import re
import statistics
from typing import Any

SYSTEM = (
    "You are a sharp human editor who rewrites text so it sounds like a real person wrote it, not an AI. "
    "Reply with ONLY the rewritten text: no introduction, no quotes around it, no notes afterwards.\n\n"
    "How people actually write:\n"
    "- Sentence length varies a lot. Some are short. Others run on a bit longer because the thought needs room.\n"
    "- Plain, specific words beat impressive ones. Say 'use' not 'leverage', 'shows' not 'underscores'.\n"
    "- Contractions (it's, don't, you'll) unless the text is meant to be formal.\n"
    "- No stock AI phrases: delve, tapestry, testament, landscape, realm, crucial, pivotal, seamless, robust, foster, "
    "embark, unlock, elevate, showcase, vibrant, intricate, multifaceted, ever-evolving, a myriad of, "
    "'it's important to note', 'plays a vital role', 'in today's fast-paced world', 'not only… but also'.\n"
    "- Few transition words. Drop most 'Furthermore', 'Moreover', 'Additionally', 'In conclusion', 'Overall'.\n"
    "- Don't list things in neat threes every time, and don't end paragraphs with a tidy one-line moral.\n"
    "- Use em dashes rarely; commas, periods and parentheses work fine.\n\n"
    "Rules you never break: keep the meaning and every fact, name and number; never add new claims or made-up "
    "details; keep the same language; keep Markdown structure (headings, lists, code, links); stay within about "
    "15% of the original length."
)

STRENGTHS: dict[str, str] = {
    "light": ("Light touch: keep most sentences as they are. Swap stiff or stock-AI phrases for plain ones, add "
              "contractions, and vary the length of a few sentences."),
    "medium": ("Rewrite it so it sounds naturally human: vary sentence rhythm, use plain everyday words, cut filler "
               "transitions, and let a little personality through while keeping the original tone."),
    "strong": ("Rewrite it freely, like a person explaining this in their own words: restructure sentences and "
               "paragraphs, mix very short sentences with longer ones, be direct, and drop anything that sounds "
               "like a template. Still keep every fact."),
    "voice": ("Rewrite it so it sounds like the user wrote it themselves, matching the writing samples below: "
              "their word choice, sentence length, punctuation habits, how casual or formal they are, and their "
              "quirks. Don't copy sentences from the samples; copy the style."),
}

# Phrases that show up far more in AI text than in people's writing. (pattern, how it's shown)
TELLS: list[tuple[str, str]] = [
    (r"\bdelv(?:e|es|ed|ing)\b", "delve"),
    (r"\btapestry\b", "tapestry"),
    (r"\b(?:a |is a )?testament to\b", "testament to"),
    (r"\bit(?:'s| is) (?:important|worth|crucial) (?:to note|noting|to remember|to mention)\b", "it's important to note"),
    (r"\bfurthermore\b", "furthermore"),
    (r"\bmoreover\b", "moreover"),
    (r"^\s*additionally\b", "Additionally,"),
    (r"\bin conclusion\b", "in conclusion"),
    (r"\bin summary\b", "in summary"),
    (r"^\s*overall,", "Overall,"),
    (r"\bin today'?s (?:fast-paced|digital|modern|ever-changing|rapidly evolving) (?:world|age|landscape|era)\b", "in today's … world"),
    (r"\b(?:navigat(?:e|es|ing) (?:the )?)?(?:complex |ever-changing |digital )?landscape\b", "landscape"),
    (r"\brealm\b", "realm"),
    (r"\bcrucial\b", "crucial"),
    (r"\bpivotal\b", "pivotal"),
    (r"\bseamless(?:ly)?\b", "seamless"),
    (r"\brobust\b", "robust"),
    (r"\bleverag(?:e|es|ed|ing)\b", "leverage"),
    (r"\bfoster(?:s|ed|ing)?\b", "foster"),
    (r"\bembark(?:s|ed|ing)?\b", "embark"),
    (r"\bunlock(?:s|ed|ing)? (?:the|your|its|their) (?:full )?(?:potential|power)\b", "unlock the potential"),
    (r"\belevat(?:e|es|ed|ing)\b", "elevate"),
    (r"\bshowcas(?:e|es|ed|ing)\b", "showcase"),
    (r"\bunderscor(?:e|es|ed|ing)\b", "underscore"),
    (r"\bvibrant\b", "vibrant"),
    (r"\bintricate\b", "intricate"),
    (r"\bmultifaceted\b", "multifaceted"),
    (r"\bever-evolving\b", "ever-evolving"),
    (r"\ba myriad of\b", "a myriad of"),
    (r"\bplays? an? (?:vital|crucial|key|pivotal|significant|important) role\b", "plays a vital role"),
    (r"\bnot only\b[^.!?]{1,80}\bbut also\b", "not only… but also"),
    (r"\bwhether you'?re\b", "whether you're"),
    (r"\bharness(?:es|ed|ing)? the\b", "harness the"),
    (r"\bparamount\b", "paramount"),
    (r"\bmeticulous(?:ly)?\b", "meticulous"),
    (r"\bcomprehensive\b", "comprehensive"),
    (r"\bboasts?\b", "boasts"),
    (r"\bnotably\b", "notably"),
    (r"\bultimately\b", "ultimately"),
    (r"\bdive (?:deep )?into\b", "dive into"),
    (r"\bstands as\b", "stands as"),
    (r"\b(?:rich|diverse) (?:history|culture|heritage|array)\b", "rich/diverse …"),
]
_TELL_RES = [(re.compile(p, re.I | re.M), label) for p, label in TELLS]
# 's only after words where it's a contraction ("it's"), not a possessive ("today's").
_CONTRACTION = re.compile(r"\b(?:\w+(?:'|’)(?:t|re|ve|ll|d|m)|(?:it|that|there|here|what|who|he|she|let|where|how)(?:'|’)s)\b", re.I)
_WORD = re.compile(r"[A-Za-z0-9’']+")


def _sentences(text: str) -> list[str]:
    """Split prose into sentences. Headings, list markers and code blocks are left out of the rhythm check."""
    text = re.sub(r"```[\s\S]*?```", " ", text)
    out: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("|"):
            continue
        line = re.sub(r"^(?:[-*+]|\d+[.)])\s+", "", line)
        out += [s.strip() for s in re.split(r"(?<=[.!?])[\"”')\]]*\s+", line) if len(_WORD.findall(s)) >= 2]
    return out


def analyze(text: str) -> dict[str, Any]:
    """A rough 0-100 'sounds like AI' score with the reasons behind it."""
    text = text or ""
    words = _WORD.findall(text)
    n_words = len(words)
    sents = _sentences(text)
    if n_words < 25 or len(sents) < 3:
        return {"score": None, "label": "Too short to judge", "words": n_words, "sentences": len(sents),
                "tells": [], "tips": ["Give it at least a few sentences."]}

    lengths = [len(_WORD.findall(s)) for s in sents]
    mean = statistics.mean(lengths)
    variation = statistics.pstdev(lengths) / mean if mean else 0.0  # "burstiness": people swing between short and long

    tells: dict[str, int] = {}
    for rx, label in _TELL_RES:
        hits = len(rx.findall(text))
        if hits:
            tells[label] = tells.get(label, 0) + hits
    tell_count = sum(tells.values())
    per100 = 100 / n_words
    tell_density = tell_count * per100
    dashes = (text.count("—") + len(re.findall(r"\s--\s", text))) * per100
    contractions = len(_CONTRACTION.findall(text)) / len(sents)
    openers = [s.split()[0].lower().strip(",") for s in sents if s.split()]
    top_opener = max(openers.count(o) for o in set(openers)) / len(openers) if openers else 0

    # Each part adds up to its weight; together they make the 0-100 score.
    parts = {
        "phrases": min(1.0, tell_density / 2.5) * 40,                   # ~2.5 stock phrases per 100 words = maxed out
        "rhythm": min(1.0, max(0.0, (0.6 - variation) / 0.35)) * 25,     # even sentence lengths look machine-made
        "contractions": min(1.0, max(0.0, (0.25 - contractions) / 0.25)) * 15,
        "dashes": min(1.0, dashes / 1.2) * 10,
        "length": min(1.0, max(0.0, (mean - 17) / 10)) * 5,              # long sentence after long sentence
        "openers": min(1.0, max(0.0, (top_opener - 0.2) / 0.3)) * 5,
    }
    score = round(sum(parts.values()))

    tips = []
    if tells:
        tips.append("Swap the stock phrases for plain words.")
    if variation < 0.45:
        tips.append("Mix short sentences with longer ones; right now they're all about the same length.")
    if contractions < 0.15:
        tips.append("Use contractions (it's, don't, you'll) unless it has to be formal.")
    if dashes > 0.6:
        tips.append("Fewer em dashes.")
    if top_opener > 0.35:
        tips.append("Start sentences in different ways.")
    label = "Sounds human" if score < 30 else "Mixed" if score < 55 else "Sounds like AI"
    return {
        "score": score, "label": label, "words": n_words, "sentences": len(sents),
        "avg_sentence": round(mean, 1), "variation": round(variation, 2), "contractions": round(contractions, 2),
        "tells": sorted(({"phrase": k, "count": v} for k, v in tells.items()), key=lambda t: -t["count"]),
        "parts": {k: round(v, 1) for k, v in parts.items()}, "tips": tips,
    }


def instruction(strength: str, samples: str = "", text: str = "") -> str:
    """The rewrite instruction for a strength, pointing out the stock phrases this text actually uses."""
    strength = strength if strength in STRENGTHS else "medium"
    if strength == "voice" and not samples.strip():
        strength = "medium"
    parts = [STRENGTHS[strength]]
    found = [t["phrase"] for t in analyze(text).get("tells", [])][:12] if text else []
    if found:
        parts.append("This text uses these stock phrases; replace every one: " + ", ".join(found) + ".")
    if strength == "voice":
        parts.append(f"The user's own writing samples:\n<<<\n{samples.strip()[:6000]}\n>>>")
    return "\n\n".join(parts)


def options(strength: str) -> dict[str, Any]:
    """Sampling for the rewrite. A bit more randomness than normal editing breaks up the even, predictable rhythm."""
    temp = {"light": 0.7, "medium": 0.85, "strong": 0.95, "voice": 0.85}.get(strength, 0.85)
    return {"temperature": temp, "top_p": 0.92, "presence_penalty": 0.4}
