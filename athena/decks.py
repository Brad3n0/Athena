"""Flashcard decks with spaced repetition (a simplified SM-2, the method behind Anki).

Cards you miss come back in minutes; cards you know come back after days, then weeks.
"""
from __future__ import annotations

import threading
import time
from typing import Any

from . import store

DECKS_FILE = store.DATA_DIR / "decks.json"
DAY = 86400
_lock = threading.RLock()


def _load() -> list[dict[str, Any]]:
    return store._read(DECKS_FILE, [])


def _save(decks: list[dict[str, Any]]) -> None:
    store._write(DECKS_FILE, decks)


def _new_card(front: str, back: str) -> dict[str, Any]:
    return {"id": store.new_id()[:10], "front": front.strip()[:2000], "back": back.strip()[:4000],
            "due": time.time(), "interval": 0.0, "ease": 2.5, "reps": 0, "lapses": 0}


def summary(deck: dict[str, Any], now: float | None = None) -> dict[str, Any]:
    now = now or time.time()
    cards = deck.get("cards", [])
    due = sum(1 for c in cards if c["due"] <= now)
    upcoming = min((c["due"] for c in cards if c["due"] > now), default=None)
    return {"id": deck["id"], "name": deck["name"], "created": deck.get("created"), "total": len(cards), "due": due,
            "new": sum(1 for c in cards if c["reps"] == 0 and c["lapses"] == 0),
            "learned": sum(1 for c in cards if c["interval"] >= 21), "next_due": upcoming}


def list_decks() -> list[dict[str, Any]]:
    now = time.time()
    return [summary(d, now) for d in sorted(_load(), key=lambda d: -(d.get("created") or 0))]


def save_cards(name: str, cards: list[dict[str, str]], deck_id: str | None = None) -> dict[str, Any]:
    """Create a deck, or add cards to an existing one (by id or matching name). Duplicate fronts are skipped."""
    name = (name or "Flashcards").strip()[:80] or "Flashcards"
    with _lock:
        decks = _load()
        deck = next((d for d in decks if d["id"] == deck_id), None) or next((d for d in decks if d["name"].lower() == name.lower()), None)
        if not deck:
            deck = {"id": store.new_id()[:10], "name": name, "created": time.time(), "cards": []}
            decks.append(deck)
        have = {c["front"].strip().lower() for c in deck["cards"]}
        added = 0
        for c in cards:
            front, back = str(c.get("front", "")).strip(), str(c.get("back", "")).strip()
            if front and back and front.lower() not in have:
                deck["cards"].append(_new_card(front, back))
                have.add(front.lower())
                added += 1
        _save(decks)
        return {**summary(deck), "added": added}


def delete_deck(deck_id: str) -> bool:
    with _lock:
        decks = _load()
        kept = [d for d in decks if d["id"] != deck_id]
        _save(kept)
        return len(kept) != len(decks)


def rename_deck(deck_id: str, name: str) -> bool:
    with _lock:
        decks = _load()
        for d in decks:
            if d["id"] == deck_id and name.strip():
                d["name"] = name.strip()[:80]
                _save(decks)
                return True
    return False


def due_cards(deck_id: str | None = None, limit: int = 60) -> list[dict[str, Any]]:
    now = time.time()
    out = []
    for d in _load():
        if deck_id and d["id"] != deck_id:
            continue
        for c in d["cards"]:
            if c["due"] <= now:
                out.append({**c, "deck_id": d["id"], "deck": d["name"], "preview": preview_intervals(c)})
    out.sort(key=lambda c: c["due"])
    return out[:limit]


def _schedule(card: dict[str, Any], grade: str) -> dict[str, Any]:
    c = dict(card)
    now = time.time()
    if grade == "again":
        c.update(reps=0, lapses=c["lapses"] + 1, interval=0.0, ease=max(1.3, c["ease"] - 0.2), due=now + 10 * 60)
        return c
    if grade == "hard":
        c["interval"] = max(1.0, c["interval"] * 1.2) if c["reps"] else 0.5
        c["ease"] = max(1.3, c["ease"] - 0.15)
    elif grade == "good":
        c["interval"] = 1.0 if c["reps"] == 0 else 3.0 if c["reps"] == 1 else round(c["interval"] * c["ease"], 1)
    else:  # easy
        c["interval"] = 4.0 if c["reps"] == 0 else round(c["interval"] * c["ease"] * 1.3, 1)
        c["ease"] = c["ease"] + 0.15
    c["reps"] += 1
    c["due"] = now + c["interval"] * DAY
    return c


def preview_intervals(card: dict[str, Any]) -> dict[str, str]:
    """What each button would do, e.g. {"again": "10m", "good": "3d"}."""
    out = {}
    for g in ("again", "hard", "good", "easy"):
        secs = _schedule(card, g)["due"] - time.time()
        out[g] = "10m" if secs < 3600 else f"{round(secs / 3600)}h" if secs < 0.9 * DAY else f"{round(secs / DAY)}d" if secs < 60 * DAY else f"{round(secs / (30 * DAY))}mo"
    return out


def grade(deck_id: str, card_id: str, grade_name: str) -> dict[str, Any] | None:
    if grade_name not in ("again", "hard", "good", "easy"):
        raise ValueError("grade must be again, hard, good or easy")
    with _lock:
        decks = _load()
        for d in decks:
            if d["id"] != deck_id:
                continue
            for i, c in enumerate(d["cards"]):
                if c["id"] == card_id:
                    d["cards"][i] = _schedule(c, grade_name)
                    _save(decks)
                    return d["cards"][i]
    return None


def total_due() -> int:
    now = time.time()
    return sum(1 for d in _load() for c in d["cards"] if c["due"] <= now)
