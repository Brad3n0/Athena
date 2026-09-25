"""Send messages through the apps on the PC: Discord, WhatsApp, texts (Phone Link) and email.

Athena works the real apps with the keyboard, like you would. She never uses hidden tricks that
could get an account banned, and every message is shown to you for approval first.
"""
from __future__ import annotations

import difflib
import os
import re
import sys
import time
from typing import Any
from urllib.parse import quote

from . import automation, store

CONTACTS_FILE = store.DATA_DIR / "contacts.json"
APPS = {"discord": "discord", "whatsapp": "whatsapp", "whats app": "whatsapp", "text": "sms", "sms": "sms", "texts": "sms",
        "message": "sms", "imessage": "sms", "phone": "sms", "email": "email", "mail": "email", "gmail": "email", "outlook": "email"}


class MessageError(Exception):
    pass


# ------------------------------------------------------------------ contacts

def list_contacts() -> list[dict[str, Any]]:
    return store._read(CONTACTS_FILE, [])


def save_contact(data: dict[str, Any], contact_id: str | None = None) -> dict[str, Any]:
    name = str(data.get("name", "")).strip()[:60]
    if not name:
        raise MessageError("A contact needs a name")
    contacts = list_contacts()
    existing = next((c for c in contacts if c["id"] == contact_id), None) or next((c for c in contacts if c["name"].lower() == name.lower()), None)
    fields = {k: str(data.get(k) or "").strip()[:120] for k in ("discord", "phone", "email", "notes")}
    if existing:
        existing.update({"name": name, **{k: v for k, v in fields.items() if v or k in data}})
        contact = existing
    else:
        contact = {"id": store.new_id()[:10], "name": name, **fields}
        contacts.append(contact)
    store._write(CONTACTS_FILE, contacts)
    return contact


def delete_contact(contact_id: str) -> bool:
    contacts = list_contacts()
    kept = [c for c in contacts if c["id"] != contact_id]
    store._write(CONTACTS_FILE, kept)
    return len(kept) != len(contacts)


def find_contact(name: str) -> dict[str, Any] | None:
    q = (name or "").strip().lower()
    if not q:
        return None
    contacts = list_contacts()
    for c in contacts:
        if q in (c["name"].lower(), c.get("discord", "").lower(), c.get("email", "").lower()):
            return c
    firsts = {c["name"].lower().split()[0]: c for c in contacts if c["name"].split()}
    if q in firsts:
        return firsts[q]
    close = difflib.get_close_matches(q, [c["name"].lower() for c in contacts], n=1, cutoff=0.8)
    return next((c for c in contacts if close and c["name"].lower() == close[0]), None)


def normalize_app(app: str) -> str:
    key = (app or "").strip().lower()
    if key not in APPS:
        raise MessageError(f"I can send messages with Discord, WhatsApp, texts or email, not '{app}'")
    return APPS[key]


def plan(app: str, to: str, text: str, subject: str = "") -> dict[str, Any]:
    """Work out exactly who and how, without sending anything (used for the approval card too)."""
    kind = normalize_app(app)
    text = str(text or "").strip()
    if not text:
        raise MessageError("What should the message say?")
    contact = find_contact(to)
    who = contact["name"] if contact else to.strip()
    target = {"discord": (contact or {}).get("discord") or who, "whatsapp": (contact or {}).get("phone", ""),
              "sms": (contact or {}).get("phone") or (to if re.fullmatch(r"[+\d][\d\s().-]{6,}", to.strip()) else ""),
              "email": (contact or {}).get("email") or (to if "@" in to else "")}[kind]
    if kind in ("sms", "email") and not target:
        raise MessageError(f"I don't have {'a phone number' if kind == 'sms' else 'an email address'} for {who}. "
                           f"Add it in Settings → Jarvis → Contacts, or tell me: 'add {who}'s {'number' if kind == 'sms' else 'email'}'.")
    return {"app": kind, "to": who, "target": target, "text": text, "subject": subject.strip()}


def describe(p: dict[str, Any]) -> str:
    label = {"discord": "a Discord message", "whatsapp": "a WhatsApp message", "sms": "a text", "email": "an email"}[p["app"]]
    via = f" ({p['target']})" if p["target"] and p["target"] != p["to"] else ""
    subject = f"\nSubject: {p['subject']}" if p.get("subject") else ""
    return f"Send {label} to {p['to']}{via}:{subject}\n\"{p['text']}\""


# ------------------------------------------------------------------ sending

def _open(app_name: str, wait: float = 15) -> None:
    from . import pc

    try:
        automation.focus_app(app_name)
    except automation.ControlError:
        try:
            pc.open_app(app_name)
        except pc.PCError as exc:
            raise MessageError(f"{app_name.title()} isn't installed (or I couldn't find it): {exc}") from exc
        automation.focus_app(app_name, wait=wait)
        time.sleep(2.5)  # let it finish loading


def discord_open_chat(target: str) -> None:
    """Open Discord and jump to a person or channel with the quick switcher (Ctrl+K)."""
    _open("discord")
    automation.press_keys("esc")  # close any popup that might be in the way
    automation.press_keys("ctrl+k")
    time.sleep(0.8)
    automation.type_text(target)
    time.sleep(1.4)  # let the results appear
    automation.press_keys("enter")
    time.sleep(1.6)


def whatsapp_open_chat(target_phone: str, name: str, text: str) -> bool:
    """Open a WhatsApp chat. With a phone number the message is filled in; returns True if it's ready to send."""
    if target_phone and sys.platform.startswith("win"):
        digits = re.sub(r"\D", "", target_phone)
        os.startfile(f"whatsapp://send?phone={digits}&text={quote(text)}")  # type: ignore[attr-defined]
        automation.focus_app("whatsapp", wait=15)
        time.sleep(2.5)
        return True
    _open("whatsapp")
    automation.press_keys("ctrl+f")
    time.sleep(0.6)
    automation.type_text(name)
    time.sleep(1.5)
    automation.press_keys("down, enter")
    time.sleep(1.2)
    return False


def type_and_send(text: str) -> None:
    automation.type_text(text, newline="shift+enter")
    time.sleep(0.3)
    automation.press_keys("enter")


def open_draft(p: dict[str, Any]) -> dict[str, Any]:
    """Texts and emails open as a ready draft; you press Send."""
    if not sys.platform.startswith("win"):
        raise MessageError("Texts and emails through your apps need Windows")
    if p["app"] == "sms":
        number = re.sub(r"[^\d+]", "", p["target"])
        try:
            os.startfile(f"sms:{number}?body={quote(p['text'])}")  # type: ignore[attr-defined]
        except OSError as exc:
            raise MessageError("Texting needs the Phone Link app connected to your phone (Start menu → Phone Link).") from exc
        return {"draft_opened": "Phone Link", "to": p["to"], "note": "The text is ready in Phone Link. Press Send there."}
    url = f"mailto:{quote(p['target'], safe='@')}?subject={quote(p.get('subject') or '')}&body={quote(p['text'])}"
    try:
        os.startfile(url)  # type: ignore[attr-defined]
    except OSError as exc:
        raise MessageError("No email app is set up on this PC (Windows Settings → Apps → Default apps → Email).") from exc
    return {"draft_opened": "email", "to": p["to"], "note": "The email is ready in your mail app. Press Send there."}
