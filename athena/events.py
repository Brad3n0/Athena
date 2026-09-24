"""Live events pushed from the server to every open Athena window (Server-Sent Events).

Used for reminders going off, the morning briefing, the wake word and the hotkey.
"""
from __future__ import annotations

import asyncio
import json
import threading
from typing import Any

_listeners: set[asyncio.Queue] = set()
_loop: asyncio.AbstractEventLoop | None = None
_lock = threading.Lock()


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def listener_count() -> int:
    return len(_listeners)


def publish(kind: str, /, **data: Any) -> None:
    """Send an event to all connected windows. Safe to call from any thread."""
    message = json.dumps({"type": kind, **data}, ensure_ascii=False)

    def deliver():
        for queue in list(_listeners):
            queue.put_nowait(message)

    if _loop is None:
        return
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is _loop:
        deliver()
    else:
        _loop.call_soon_threadsafe(deliver)


async def stream():
    queue: asyncio.Queue = asyncio.Queue()
    with _lock:
        _listeners.add(queue)
    try:
        yield "retry: 3000\n\n"
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=25)
                yield f"data: {message}\n\n"
            except asyncio.TimeoutError:
                yield ": ping\n\n"  # keep the connection alive
    finally:
        with _lock:
            _listeners.discard(queue)
