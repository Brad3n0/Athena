"""Athena learns: she picks up facts about you from chats, and lessons from your 👍/👎 and corrections.

No retraining: what she learns is saved here and added to her instructions, so every model benefits.
You can see, edit and delete all of it in Settings → About you.
"""
from __future__ import annotations

import difflib
import json
import re
import time
from typing import Any

from . import store

LESSONS_FILE = store.DATA_DIR / "lessons.json"
MAX_LESSONS = 60

FIRST_PERSON = re.compile(r"\b(i|i'm|im|i've|i'd|my|me|mine|we|our)\b", re.I)
CORRECTION = re.compile(r"^\s*(no[,.! ]|nope|not quite|that'?s (wrong|not (right|it|what))|wrong|incorrect|actually[, ]|i meant|i said|"
                        r"not what i (asked|meant|wanted)|you misunderstood|that'?s not|try again|stop )", re.I)


def list_lessons() -> list[dict[str, Any]]:
    return store._read(LESSONS_FILE, [])


def _similar(a: str, b: str) -> bool:
    a, b = a.lower().strip(" ."), b.lower().strip(" .")
    return a in b or b in a or difflib.SequenceMatcher(None, a, b).ratio() > 0.82


def add_lesson(text: str, source: str) -> dict[str, Any] | None:
    text = re.sub(r"\s+", " ", (text or "").strip().strip('"'))[:240]
    if len(text) < 8:
        return None
    items = list_lessons()
    if any(_similar(text, x["text"]) for x in items):
        return None
    item = {"id": store.new_id()[:10], "text": text, "source": source, "created": time.time()}
    store._write(LESSONS_FILE, (items + [item])[-MAX_LESSONS:])
    return item


def update_lesson(lesson_id: str, text: str) -> bool:
    items = list_lessons()
    for x in items:
        if x["id"] == lesson_id:
            x["text"] = text.strip()[:240]
            store._write(LESSONS_FILE, items)
            return True
    return False


def delete_lesson(lesson_id: str) -> bool:
    items = list_lessons()
    kept = [x for x in items if x["id"] != lesson_id]
    store._write(LESSONS_FILE, kept)
    return len(kept) != len(items)


def forget_everything() -> None:
    store._write(LESSONS_FILE, [])
    store._write(store.MEMORY_FILE, [])


def prompt_section() -> str:
    lessons = list_lessons()[-25:]
    if not lessons:
        return ""
    return ("Lessons from this user's feedback about how they like answers (follow them):\n"
            + "\n".join(f"- {x['text']}" for x in lessons))


def is_correction(text: str) -> bool:
    return bool(CORRECTION.search(text or ""))


def worth_checking_for_facts(text: str) -> bool:
    return len(text or "") >= 12 and bool(FIRST_PERSON.search(text))


def _json_list(text: str) -> list[str]:
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S)
    m = re.search(r"\[.*\]", text, re.S)
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    return [str(x).strip() for x in data if isinstance(x, str) and 6 <= len(str(x).strip()) <= 200][:4]


def _one_line(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()
    line = next((ln for ln in text.splitlines() if ln.strip()), "").strip().strip('"*-• ')
    return "" if line.upper().startswith("NONE") else line


def think_value(model: str, level: str) -> Any:
    """What to send as Ollama's `think` for Quick / Normal / Deep. None = leave it to the model."""
    name = (model or "").lower()
    if "gpt-oss" in name:  # gpt-oss always reasons; it takes an effort level instead
        return {"quick": "low", "voice": "low", "deep": "high"}.get(level)
    # Voice: think, but in the separate thinking channel. With thinking switched off, some models (qwen3)
    # still reason, just as plain text in the answer, and that would be read aloud.
    return {"quick": False, "voice": True, "deep": True}.get(level)


async def _ask(client, ollama: str, model: str, prompt: str, keep_alive: Any, tokens: int = 160) -> str:
    payload: dict[str, Any] = {"model": model, "stream": False, "keep_alive": keep_alive,
                               "options": {"temperature": 0, "num_predict": tokens}, "messages": [{"role": "user", "content": prompt}]}
    if (think := think_value(model, "quick")) is not None:
        payload["think"] = think
    resp = await client.post(f"{ollama}/api/chat", json=payload, timeout=120)
    if resp.status_code != 200 and "think" in payload and "think" in resp.text.lower():
        payload.pop("think")  # model can't change how it thinks; ask again without
        resp = await client.post(f"{ollama}/api/chat", json=payload, timeout=120)
    return (resp.json().get("message") or {}).get("content", "") if resp.status_code == 200 else ""


async def learn_facts(client, ollama: str, model: str, user: str, reply: str, keep_alive: Any) -> list[str]:
    """Pick out lasting facts about the user from one exchange and save the new ones as memories."""
    known = [m["text"] for m in store.list_memories()][-40:]
    prompt = (
        "Here is a message a user sent to their personal AI assistant, and the reply.\n\n"
        f"USER: {user[:1500]}\n\nASSISTANT: {reply[:800]}\n\n"
        "List NEW lasting facts about the USER worth remembering for future chats: their name, school/grade, job, hobbies, "
        "projects they're working on, goals, important people or dates, and preferences (likes, dislikes, how they want answers). "
        "Ignore one-off questions and requests, temporary moods, and anything about the assistant. "
        f"Already known (don't repeat): {json.dumps(known)}\n\n"
        'Reply with ONLY a JSON array of short third-person sentences starting with "User", e.g. ["User is studying calculus"], '
        "or [] if there's nothing new and lasting.")
    facts = _json_list(await _ask(client, ollama, model, prompt, keep_alive))
    saved = []
    for fact in facts:
        if not any(_similar(fact, k) for k in known + saved):
            store.add_memory(fact)
            saved.append(fact)
    return saved


async def learn_lesson(client, ollama: str, model: str, user: str, reply: str, kind: str, note: str, keep_alive: Any) -> str | None:
    """Turn a 👍, 👎 or a correction into one short rule for next time."""
    if kind == "up":
        ask = "The user gave this reply a thumbs UP. In one short sentence, what should the assistant keep doing for this user (about style, length, format or approach — not the topic)?"
    elif kind == "correction":
        ask = f"The user then corrected the assistant: \"{note[:500]}\". In one short sentence, what should the assistant do differently next time?"
    else:
        ask = "The user gave this reply a thumbs DOWN" + (f" and said: \"{note[:500]}\"" if note else "") + \
              ". In one short sentence, what should the assistant do differently next time?"
    prompt = (f"USER: {user[:1200]}\n\nASSISTANT: {reply[:1500]}\n\n{ask} Write it as an instruction to the assistant, "
              "e.g. \"Give step-by-step math with the final answer bolded.\" If there's no clear lesson, reply NONE.")
    text = _one_line(await _ask(client, ollama, model, prompt, keep_alive, 80))
    if not text:
        return None
    item = add_lesson(text, {"up": "👍", "down": "👎", "correction": "correction"}.get(kind, kind))
    return item["text"] if item else None
