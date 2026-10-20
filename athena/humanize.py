"""Humanize: rewrite stiff, AI-sounding text so it reads like a person wrote it, plus an AI detector.

Everything here runs offline with Athena's own model. There are two checks:

- The deep check works the way GPTZero describes its method: Athena's brain reads the text one token at a time and
  measures how predictable each one was (perplexity) and how much that swings from sentence to sentence (burstiness).
  AI text is very predictable and very even; people are more surprising and more uneven. It also counts how often
  each word was the brain's own first guess (like the GLTR research tool). It needs her built-in engine.
- The style meter is a quick heuristic (stock AI phrases, sentence rhythm, contractions, dashes) that works anywhere.

Turnitin and GPTZero use their own trained models, so their numbers won't match exactly. Treat the score as a guide.
"""
from __future__ import annotations

import asyncio
import math
import re
import statistics
import time
from typing import Any

import httpx

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


POLISH_SYSTEM = (
    "You are a sharp human editor doing a second read of a rewrite. Reply with ONLY the final text: no "
    "introduction, no notes, no quotes around it."
)


def polish_prompt(original: str, draft: str) -> str:
    """Second pass: reread the first rewrite and fix only what still reads stiff, keeping everything that works."""
    found = [t["phrase"] for t in analyze(draft).get("tells", [])][:12]
    parts = [
        "Here is the ORIGINAL text, then a DRAFT rewrite of it.",
        f"ORIGINAL:\n<<<\n{original}\n>>>",
        f"DRAFT:\n<<<\n{draft}\n>>>",
        "Reread the draft the way a careful human editor would. Find the sentences that still sound stiff, generic or "
        "template-like: the same sentence openings over and over, every sentence about the same length, tidy lists of "
        "three, a neat one-line moral at the end of a paragraph, filler transitions, vague words where a specific one "
        "would do. Rewrite only those sentences. Leave everything that already reads naturally exactly as it is.",
        "Keep the draft's tone and level of formality (a formal draft stays formal). Keep every fact, name and number "
        "from the ORIGINAL and add nothing new: no examples, stories, statistics or quotes that aren't in it.",
    ]
    if found:
        parts.append("These stock phrases are still in the draft; replace each one: " + ", ".join(found) + ".")
    parts.append("Reply with only the final text.")
    return "\n\n".join(parts)


COACH_SYSTEM = (
    "You are a friendly writing coach. You never rewrite the user's text for them; you point out what to improve and "
    "they make the changes themselves. Reply with ONLY a JSON array, no other text."
)


def coach_prompt(text: str) -> str:
    return (
        f"The user's text:\n<<<\n{text}\n>>>\n\n"
        "Find up to 8 sentences that sound the most stiff, generic or machine-written (stock phrases, filler "
        "transitions, vague wording, every sentence the same length, tidy summary lines). For each one give:\n"
        '- "quote": the sentence copied EXACTLY from the text, character for character\n'
        '- "why": one short reason it sounds stiff (under 15 words)\n'
        '- "tip": a concrete suggestion for how THEY could rewrite it (an idea or a direction, under 25 words, not a '
        "finished replacement sentence)\n"
        "Keep the tone they're going for (a formal paper stays formal). Most important first. If the writing already "
        "sounds natural, return an empty array []. Reply with only the JSON array."
    )


def parse_coach(raw: str, text: str) -> list[dict[str, Any]]:
    """Read the coach's JSON and keep only notes whose quote really is in the text (with where it is)."""
    import json as _json

    raw = re.sub(r"<think>[\s\S]*?</think>", "", raw or "")
    m = re.search(r"\[[\s\S]*\]", raw)
    if not m:
        return []
    try:
        items = _json.loads(m.group(0))
    except ValueError:
        return []
    out, used = [], set()
    squash = lambda t: re.sub(r"\s+", " ", t).strip()
    flat = squash(text)
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        quote = squash(str(it.get("quote") or "")).strip('"“”')
        if len(quote) < 12:
            continue
        start = text.find(quote)
        if start < 0:  # the model changed the spacing: find it ignoring whitespace differences
            pattern = r"\s+".join(re.escape(w) for w in quote.split())
            hit = re.search(pattern, text)
            if not hit:
                continue
            start, end = hit.start(), hit.end()
        else:
            end = start + len(quote)
        if start in used or quote not in flat and not re.search(r"\s+".join(re.escape(w) for w in quote.split()), text):
            continue
        used.add(start)
        out.append({"start": start, "end": end, "quote": text[start:end],
                    "why": str(it.get("why") or "").strip()[:160], "tip": str(it.get("tip") or "").strip()[:240]})
    return sorted(out, key=lambda x: x["start"])[:8]


def options(strength: str) -> dict[str, Any]:
    """Sampling for the rewrite. A bit more randomness than normal editing breaks up the even, predictable rhythm."""
    temp = {"light": 0.7, "medium": 0.85, "strong": 0.95, "voice": 0.85}.get(strength, 0.85)
    return {"temperature": temp, "top_p": 0.92, "presence_penalty": 0.4}


# ------------------------------------------------------------ deep check

# Where "predictable" turns into "probably AI", in nats per token (the average surprise; perplexity = e^this).
# Text Athena's brain itself would write scores about 0.8-1.4; people's writing usually lands around 2-3.5.
NLL_CENTER, NLL_SCALE = 1.9, 0.3
# Burstiness: how much the surprise swings between sentences (spread of each sentence's average). AI ≈ 0.3, people ≈ 0.6+.
BURST_CENTER, BURST_SCALE, BURST_WEIGHT = 0.5, 0.2, 0.7
DEEP_MAX_CHARS = 5000  # about 800 words; longer text is checked from the start (keeps it to well under a minute)
SCORE_PROMPT = "Write a few paragraphs."


def _sigmoid(z: float) -> float:
    return 1 / (1 + math.exp(-max(-30.0, min(30.0, z))))


def _gbnf_literal(text: str) -> str:
    """A grammar that only allows this exact text, so the brain 'writes' it and we can read how surprised it was."""
    out = []
    for ch in text:
        if ch in '"\\':
            out.append("\\" + ch)
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif ord(ch) < 32:
            out.append(f"\\x{ord(ch):02x}")
        else:
            out.append(ch)
    return 'root ::= "' + "".join(out) + '"'


def _sentence_spans(text: str) -> list[tuple[int, int]]:
    """Character spans of the prose sentences (skipping headings, tables and code)."""
    spans = []
    for m in re.finditer(r"[^.!?\n]+(?:[.!?]+[\"”')\]]*|\n|$)", text):
        chunk = m.group(0)
        stripped = chunk.strip()
        if len(_WORD.findall(stripped)) < 4 or stripped.startswith(("#", "|", "```")):
            continue
        lead = len(chunk) - len(chunk.lstrip())
        spans.append((m.start() + lead, m.start() + lead + len(stripped)))
    return spans


async def _prompt_prefix(client: httpx.AsyncClient, base: str) -> str:
    """The brain's own chat format up to where its reply starts, so the text is scored as if it were her answer."""
    marker = "⁣ATHENA_SCORE_MARKER⁣"
    r = await client.post(f"{base}/apply-template", timeout=30,
                          json={"messages": [{"role": "user", "content": SCORE_PROMPT}, {"role": "assistant", "content": marker}]})
    r.raise_for_status()
    rendered = r.json().get("prompt") or ""
    if marker not in rendered:
        raise RuntimeError("couldn't read the brain's chat format")
    return rendered.split(marker)[0]


async def deep_check(client: httpx.AsyncClient, text: str) -> dict[str, Any]:
    """Perplexity + burstiness, scored by Athena's own brain. Raises RuntimeError with a friendly reason if it can't run."""
    from fastapi.concurrency import run_in_threadpool

    from . import engine

    if not engine.wanted():
        raise RuntimeError("The deep check needs Athena's built-in engine (Settings → Brain & models → Engine). Showing the style check instead.")
    if not await run_in_threadpool(engine.ensure_running, 180):
        raise RuntimeError("Athena's brain isn't loaded right now (it may be downloading or paused for a game). Showing the style check instead.")
    engine._last_used[0] = time.time()

    original_len = len(text)
    offset = len(text) - len(text.lstrip())  # where the checked text starts inside what was sent
    text = text.strip()[:DEEP_MAX_CHARS]
    if len(text) < original_len - 5:  # cut at the end of a sentence, not mid-word
        cut = max(text.rfind(". "), text.rfind("\n"))
        text = text[: cut + 1] if cut > 1000 else text
    raw = text.encode("utf-8")
    base = engine.LLAMA_URL
    prefix = await _prompt_prefix(client, base)
    started = time.time()
    r = await client.post(f"{base}/completion", timeout=httpx.Timeout(15.0, read=300), json={
        "prompt": prefix, "grammar": _gbnf_literal(text), "n_predict": len(raw) + 16, "n_probs": 10,
        "temperature": 0, "cache_prompt": False, "stream": False,
    })
    if r.status_code != 200:
        raise RuntimeError(f"The brain couldn't score it ({r.text[:200] or r.status_code}).")
    probs = r.json().get("completion_probabilities") or []
    tokens = []  # (byte start, byte end, surprise in nats, rank of the real word among her guesses)
    pos = 0
    for item in probs:
        size = len(item.get("bytes") or str(item.get("token", "")).encode("utf-8"))
        if size == 0:
            continue  # end-of-text marker
        lp = item.get("logprob")
        if lp is None:
            continue
        rank = next((i for i, t in enumerate(item.get("top_logprobs") or []) if t.get("id") == item.get("id")), 10)
        tokens.append((pos, pos + size, -float(lp), rank))
        pos += size
    if len(tokens) < 20:
        raise RuntimeError("Too short for the deep check. Give it a few sentences.")

    nll = [t[2] for t in tokens]
    mean_nll = statistics.mean(nll)

    # Per sentence: map character spans to byte spans, then average the surprise of the tokens that start inside.
    sentences = []
    for a, b in _sentence_spans(text):
        ba, bb = len(text[:a].encode("utf-8")), len(text[:b].encode("utf-8"))
        vals = [t[2] for t in tokens if ba <= t[0] < bb]
        if len(vals) >= 5:
            s_nll = statistics.mean(vals)
            sentences.append({"text": text[a:b], "start": a, "end": b, "nll": s_nll,
                              "ai": _sigmoid((NLL_CENTER - s_nll) / NLL_SCALE)})
    burst = statistics.pstdev([s["nll"] for s in sentences]) if len(sentences) >= 3 else None

    # Per paragraph (like Turnitin's sections): the paragraph's own perplexity and burstiness.
    paragraphs = []
    for m in re.finditer(r"\S[\s\S]*?(?=\n\s*\n|\Z)", text):
        a, b = m.start(), m.start() + len(m.group(0).rstrip())
        ba, bb = len(text[:a].encode("utf-8")), len(text[:b].encode("utf-8"))
        vals = [t[2] for t in tokens if ba <= t[0] < bb]
        if len(vals) < 15:
            continue  # headings and one-liners are too short to judge
        inside = [x["nll"] for x in sentences if a <= x["start"] < b]
        pz = (NLL_CENTER - statistics.mean(vals)) / NLL_SCALE
        if len(inside) >= 3:
            pz += BURST_WEIGHT * (BURST_CENTER - statistics.pstdev(inside)) / BURST_SCALE
        paragraphs.append({"start": offset + a, "end": offset + b, "ai": round(_sigmoid(pz) * 100), "tokens": len(vals)})

    z = (NLL_CENTER - mean_nll) / NLL_SCALE
    if burst is not None:
        z += BURST_WEIGHT * (BURST_CENTER - burst) / BURST_SCALE
    ai = _sigmoid(z)
    whole = ai
    if len(paragraphs) >= 2:
        # Like Turnitin's number: how much of the text looks AI-written, paragraph by paragraph. (Scoring a mixed
        # document as one block hides AI paragraphs, because mixing in human ones makes the whole thing look bursty.)
        ai = sum(p["ai"] * p["tokens"] for p in paragraphs) / sum(p["tokens"] for p in paragraphs) / 100
    flagged = sorted((s for s in sentences if s["ai"] >= 0.6), key=lambda s: -s["ai"])[:6]
    return {
        "ai": round(ai * 100),
        "whole_text_ai": round(whole * 100),
        "perplexity": round(math.exp(mean_nll), 1),
        "burstiness": None if burst is None else round(burst, 2),
        "top1": round(100 * sum(1 for t in tokens if t[3] == 0) / len(tokens)),
        "top10": round(100 * sum(1 for t in tokens if t[3] < 10) / len(tokens)),
        "tokens": len(tokens),
        "checked_chars": len(text),
        "truncated": len(text) < original_len - 5,
        "seconds": round(time.time() - started, 1),
        "sentences": [{"text": s["text"][:220], "ai": round(s["ai"] * 100)} for s in flagged],
        # Every sentence and paragraph with its place in the text that was sent, for the highlight view.
        "spans": [{"start": offset + s["start"], "end": offset + s["end"], "ai": round(s["ai"] * 100)} for s in sentences],
        "paragraphs": paragraphs,
    }


_deep_lock = asyncio.Lock()  # one deep check at a time (her engine runs one job at a time anyway)


async def full_check(client: httpx.AsyncClient, text: str, deep: bool = True) -> dict[str, Any]:
    """The score the canvas shows: the deep check when it can run (80%) blended with the style meter (20%)."""
    style = analyze(text)
    out: dict[str, Any] = {**style, "style_score": style.get("score"), "deep": None, "note": ""}
    if not deep:
        return out
    try:
        async with _deep_lock:
            d = await deep_check(client, text)
    except RuntimeError as exc:
        out["note"] = str(exc)
        return out
    except httpx.HTTPError as exc:
        out["note"] = f"Couldn't reach Athena's brain for the deep check ({type(exc).__name__}). Showing the style check instead."
        return out
    out["deep"] = d
    blended = d["ai"] if style.get("score") is None else round(0.8 * d["ai"] + 0.2 * style["score"])
    out["score"] = blended
    out["label"] = "Likely human" if blended < 35 else "Mixed" if blended < 70 else "Likely AI"
    return out
