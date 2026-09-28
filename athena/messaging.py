"""Send messages through the apps on the PC: Discord, WhatsApp, texts (Phone Link), email, Instagram,
Messenger, Telegram, and any other app or website (found on screen with the vision model).

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
        "message": "sms", "imessage": "sms", "phone": "sms", "email": "email", "mail": "email", "gmail": "email", "outlook": "email",
        "instagram": "instagram", "insta": "instagram", "ig": "instagram", "messenger": "messenger", "facebook": "messenger",
        "facebook messenger": "messenger", "fb": "messenger", "telegram": "telegram"}
# Apps with a link that opens a chat with someone directly (in the browser, or the app if it's installed).
CHAT_LINKS = {"instagram": "https://ig.me/m/{user}", "messenger": "https://m.me/{user}", "telegram": "https://t.me/{user}"}
# Where to find other messaging apps on the web when the app isn't installed.
WEB_APPS = {"instagram": "https://www.instagram.com/direct/inbox/", "messenger": "https://www.messenger.com",
            "telegram": "https://web.telegram.org", "snapchat": "https://web.snapchat.com", "snap": "https://web.snapchat.com", "slack": "https://app.slack.com",
            "teams": "https://teams.microsoft.com", "microsoft teams": "https://teams.microsoft.com", "x": "https://x.com/messages",
            "twitter": "https://x.com/messages", "reddit": "https://chat.reddit.com", "linkedin": "https://www.linkedin.com/messaging",
            "tiktok": "https://www.tiktok.com/messages", "groupme": "https://web.groupme.com", "signal": "", "skype": "https://web.skype.com",
            "google chat": "https://chat.google.com", "steam": "", "twitch": "https://www.twitch.tv/whispers"}
LABELS = {"discord": "Discord", "whatsapp": "WhatsApp", "sms": "a text", "email": "an email", "instagram": "Instagram",
          "messenger": "Messenger", "telegram": "Telegram"}
HANDLE_FIELDS = ("discord", "instagram", "snapchat", "telegram", "phone", "email")


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
    fields = {k: str(data.get(k) or "").strip()[:120] for k in (*HANDLE_FIELDS, "notes")}
    fields["nicknames"] = ", ".join(n.strip() for n in str(data.get("nicknames") or "").split(",") if n.strip())[:200]
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


def nicknames(contact: dict[str, Any]) -> list[str]:
    return [n.strip() for n in (contact.get("nicknames") or "").split(",") if n.strip()]


def _plain(text: str) -> str:
    """'My Brother' → 'brother', '@Jay!' → 'jay'."""
    t = re.sub(r"^(my|our)\s+", "", (text or "").strip().lower())
    return re.sub(r"[^\w\s.]", "", t).strip()


def find_contact(name: str) -> dict[str, Any] | None:
    q = (name or "").strip().lower().lstrip("@")
    if not q:
        return None
    contacts = list_contacts()
    for c in contacts:
        if q in (c["name"].lower(), *(c.get(k, "").lower().lstrip("@") for k in HANDLE_FIELDS if c.get(k))):
            return c
    plain = _plain(q)
    for c in contacts:  # nicknames: "Jay", "my brother", "bro"
        if plain and plain in (_plain(n) for n in nicknames(c)):
            return c
    firsts = {c["name"].lower().split()[0]: c for c in contacts if c["name"].split()}
    if q in firsts:
        return firsts[q]
    close = difflib.get_close_matches(q, [c["name"].lower() for c in contacts], n=1, cutoff=0.8)
    return next((c for c in contacts if close and c["name"].lower() == close[0]), None)


def normalize_app(app: str) -> str:
    """A known app, or 'screen' for anything else (Athena finds the chat on screen)."""
    key = (app or "discord").strip().lower().removesuffix(" app").removesuffix(".com")
    return APPS.get(key, "screen")


def app_name(app: str) -> str:
    """The name to show and open for an app that isn't built in, e.g. 'Snapchat'."""
    name = re.sub(r"\s+", " ", (app or "").strip()).removesuffix(".com")
    return name[:1].upper() + name[1:] if name else "the app"


def plan(app: str, to: str, text: str, subject: str = "") -> dict[str, Any]:
    """Work out exactly who and how, without sending anything (used for the approval card too)."""
    kind = normalize_app(app)
    text = str(text or "").strip()
    if not text:
        raise MessageError("What should the message say?")
    if not str(to or "").strip():
        raise MessageError("Who should I message?")
    contact = find_contact(to) or {}
    who = contact.get("name") or to.strip()
    handle = lambda key: (contact.get(key) or "").lstrip("@")  # noqa: E731
    if kind == "screen":
        label = app_name(app)
        target = handle(label.lower()) or who
    elif kind in CHAT_LINKS:
        label = LABELS[kind]
        raw = to.strip()
        looks_like_username = raw.startswith("@") or (re.fullmatch(r"[\w.]+", raw) and re.search(r"[._\d]", raw))
        target = handle(kind) or (raw.lstrip("@") if looks_like_username else who)
        if not handle(kind) and not looks_like_username:
            kind = "screen"  # a name, not a username: search for the chat on screen instead of guessing a link
    else:
        label = LABELS[kind]
        target = {"discord": handle("discord") or who, "whatsapp": contact.get("phone", ""),
                  "sms": contact.get("phone") or (to if re.fullmatch(r"[+\d][\d\s().-]{6,}", to.strip()) else ""),
                  "email": contact.get("email") or (to if "@" in to else "")}[kind]
    if kind in ("sms", "email") and not target:
        raise MessageError(f"I don't have {'a phone number' if kind == 'sms' else 'an email address'} for {who}. "
                           f"Add it in Settings → Jarvis → Contacts, or tell me: 'add {who}'s {'number' if kind == 'sms' else 'email'}'.")
    aliases = [a for a in dict.fromkeys([target, who, *nicknames(contact), *(contact.get(k, "") for k in HANDLE_FIELDS[:4])]) if a]
    return {"app": kind, "label": label, "to": who, "target": target, "text": text, "subject": subject.strip(), "aliases": aliases}


def describe(p: dict[str, Any]) -> str:
    name = p.get("label") or "chat"
    label = {"sms": "a text", "email": "an email"}.get(p["app"], f"{'an' if name[:1].lower() in 'aeiou' else 'a'} {name} message")
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


def open_link_chat(p: dict[str, Any]) -> None:
    """Instagram, Messenger, Telegram: open the chat with that person from its link."""
    from urllib.parse import quote as q

    url = CHAT_LINKS[p["app"]].format(user=q(p["target"], safe=""))
    _open_url(url)


def _open_url(url: str) -> None:
    if not sys.platform.startswith("win"):
        raise MessageError("Messaging through your apps needs Windows")
    os.startfile(url)  # type: ignore[attr-defined]
    time.sleep(6)  # the page or app needs a moment to load the chat


def open_any_app(name: str) -> None:
    """Open an app by name, or its website if it isn't installed."""
    from . import pc

    key = name.lower()
    try:
        automation.focus_app(name)
        time.sleep(0.8)
        return
    except automation.ControlError:
        pass
    url = WEB_APPS.get(key)
    if url is None or url == "":
        try:
            pc.open_app(name)
            automation.focus_app(name, wait=15)
            time.sleep(3)
            return
        except (pc.PCError, automation.ControlError):
            if url == "":
                raise MessageError(f"{name} isn't open or installed on this PC.") from None
            url = f"https://{re.sub(r'[^a-z0-9-]', '', key)}.com"
    _open_url(url)


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
