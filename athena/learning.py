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


# Lessons about style (pet names, flirting, swearing, emojis...) older than per-personality lessons: treat them as
# belonging to the Companion personality, so they don't make the Assistant talk like her.
COMPANION_STYLE = re.compile(r"\b(flirt\w*|pet names?|baby|babe|good boy|handsome|sassy|sass|swear\w*|curs\w*|profan\w*|"
                             r"bad words?|uncensored|unfiltered|fuck\w*|shit|ass|bitch|emojis?|teas\w*|sultry|sexy|steamy|"
                             r"roast\w*|girlfriend|affection\w*|mommy)\b", re.I)


def lesson_persona(item: dict[str, Any]) -> str:
    """Which personality a lesson belongs to ('' = all of them). Style lessons (flirting, pet names, swearing...)
    are Companion's, whoever added them, so the Assistant keeps her own voice."""
    if item.get("persona"):
        return item["persona"]
    return "companion" if COMPANION_STYLE.search(item.get("text") or "") else ""


def add_lesson(text: str, source: str, persona: str = "") -> dict[str, Any] | None:
    """A lesson learned while a personality was active applies to that personality only ('' = all of them)."""
    text = re.sub(r"\s+", " ", (text or "").strip().strip('"'))[:240]
    if len(text) < 8:
        return None
    items = list_lessons()
    if any(_similar(text, x["text"]) and lesson_persona(x) == persona for x in items):
        return None
    item = {"id": store.new_id()[:10], "text": text, "source": source, "created": time.time(), "persona": persona}
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


def prompt_section(persona: str = "") -> str:
    lessons = [x for x in list_lessons() if lesson_persona(x) in ("", persona)][-25:]
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


async def learn_lesson(client, ollama: str, model: str, user: str, reply: str, kind: str, note: str, keep_alive: Any,
                       persona: str = "") -> str | None:
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
    item = add_lesson(text, {"up": "👍", "down": "👎", "correction": "correction"}.get(kind, kind), persona)
    return item["text"] if item else None


# ------------------------------------------------------------------ auto task manager

TASK_HINT = re.compile(
    r"\b(i\s*(have|need|got|gotta|must|should|'?ve got)\s*(to|ta)\b|i gotta|i need to|gotta\b|need to\b|have to\b|"
    r"don'?t (let me )?forget|due (on|by|tomorrow|today|next|this|mon|tue|wed|thu|fri|sat|sun)|deadline|"
    r"i have (a|an|my) (test|exam|quiz|essay|paper|project|meeting|appointment|game|shift|interview|practice)|"
    r"(finished|done with|completed|turned in|submitted|handed in|took care of)\b)", re.I)
EXPLICIT_TASK = re.compile(r"\b(add|put|make)\b.{0,40}\b(task|to-?do|list)\b|\bremind me\b|\bset a reminder\b", re.I)


def worth_checking_for_tasks(text: str) -> bool:
    """Sounds like a to-do or a finished to-do, and they didn't ask her directly (then she uses her task tools)."""
    return bool(text) and len(text) >= 8 and bool(TASK_HINT.search(text)) and not EXPLICIT_TASK.search(text)


def _json_obj(text: str) -> dict[str, Any]:
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S)
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return {}
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


async def learn_tasks(client, ollama: str, model: str, user: str, keep_alive: Any) -> dict[str, list[str]]:
    """Add to-dos the user mentions to their Tasks, and tick off the ones they say they finished."""
    from datetime import datetime

    open_tasks = [t for t in store.list_tasks() if not t.get("done")]
    now = datetime.now().strftime("%A %B %d, %Y")
    prompt = (
        f"Today is {now}. The user told their assistant:\n\"{user[:1200]}\"\n\n"
        f"Their open to-dos: {json.dumps([t['title'] for t in open_tasks][-40:])}\n\n"
        "1) Did they mention something THEY need to do later (homework, an exam to study for, an errand, a call, an "
        "appointment)? Only real, specific to-dos, not wishes, feelings or things happening right now.\n"
        "2) Did they say they FINISHED one of their open to-dos? Use its exact text from the list.\n"
        'Reply with ONLY JSON: {"add": [{"title": "Finish history essay", "due": "Fri Oct 3"}], "done": ["exact open to-do"]}. '
        'Titles are short, start with a verb. due is a short date like "Fri Oct 3" or "Tomorrow 3 PM", or "" if none. '
        'Use empty lists when nothing fits.')
    data = _json_obj(await _ask(client, ollama, model, prompt, keep_alive, 220))
    added, done = [], []
    titles = [t["title"] for t in open_tasks]
    for item in (data.get("add") or [])[:3]:
        title = str((item or {}).get("title") or "").strip()[:120] if isinstance(item, dict) else ""
        if len(title) < 4 or any(_similar(title, t) for t in titles + added):
            continue
        store.add_task(title, str(item.get("due") or "")[:40])
        added.append(title)
    for name in (data.get("done") or [])[:3]:
        hit = next((t for t in open_tasks if _similar(str(name), t["title"])), None)
        if hit:
            store.update_task(hit["id"], {"done": True})
            done.append(hit["title"])
    return {"added": added, "done": done}
