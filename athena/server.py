"""Athena AI — local web server.

Serves the chat UI and bridges it to Ollama running on this PC.
Run with:  python -m athena   (then open http://localhost:8765)
"""
from __future__ import annotations

import json
import os
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncIterator

import httpx
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import speech, store
from .tools import TOOLS, parse_args, run_tool

STATIC_DIR = store.ROOT / "static"


def _ollama_url() -> str:
    host = os.environ.get("OLLAMA_HOST", "127.0.0.1:11434").strip()
    if not host.startswith(("http://", "https://")):
        host = "http://" + host
    return host.replace("0.0.0.0", "127.0.0.1").rstrip("/")


OLLAMA = _ollama_url()
MAX_TOOL_ROUNDS = 6
_no_tool_models: set[str] = set()

client: httpx.AsyncClient


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global client
    client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=None))
    yield
    await client.aclose()


app = FastAPI(title="Athena AI", lifespan=lifespan)


# ------------------------------------------------------------------ prompts

def build_system_prompt(mode: str, settings: dict[str, Any], tools_on: bool) -> str:
    now = datetime.now().strftime("%A, %B %d, %Y, %I:%M %p")
    name = (settings.get("user_name") or "").strip()
    parts = [
        "You are Athena, a warm, sharp and capable AI assistant. You run fully offline on the "
        "user's own computer through Ollama, so their data never leaves the machine.",
        f"The current local date and time is {now}.",
    ]
    if name:
        parts.append(f"The user's name is {name}.")
    if mode == "code":
        parts.append(
            "You are in Code mode: act as an expert senior software engineer. Give correct, complete, "
            "runnable code in fenced code blocks with the language tag. Explain briefly and precisely, "
            "point out bugs and edge cases, and prefer simple, idiomatic solutions."
        )
    elif mode == "voice":
        parts.append(
            "You are in Voice mode: everything you write is read aloud by a text-to-speech voice. "
            "Reply like a friendly human assistant in natural spoken sentences. Keep answers short "
            "(usually one to three sentences) unless asked for detail. Never use markdown, bullet "
            "points, tables, emoji or code blocks. If code is needed, say you've put it in the chat."
        )
    else:
        parts.append("Format answers with Markdown when it helps readability. Be concise but thorough.")
    if tools_on:
        parts.append(
            "You can manage the user's task list and timers with your tools. When the user asks you to "
            "remember, remind, add, finish or remove something, use the tools, then confirm briefly."
        )
    custom = (settings.get("custom_instructions") or "").strip()
    if custom:
        parts.append("Additional instructions from the user:\n" + custom)
    return "\n\n".join(parts)


def _clean_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned = []
    for msg in messages[-60:]:  # keep the context window reasonable
        role = msg.get("role")
        content = msg.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            item: dict[str, Any] = {"role": role, "content": content}
            images = msg.get("images")
            if role == "user" and isinstance(images, list) and images:
                item["images"] = [i for i in images if isinstance(i, str)][:4]
            cleaned.append(item)
    return cleaned


def _event(kind: str, **data: Any) -> bytes:
    return (json.dumps({"type": kind, **data}, ensure_ascii=False) + "\n").encode()


# --------------------------------------------------------------------- chat

@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    model = str(body.get("model") or "")
    mode = body.get("mode") if body.get("mode") in ("assistant", "code", "voice") else "assistant"
    if not model:
        raise HTTPException(400, "No model selected")

    settings = store.get_settings()
    use_tools = mode != "code" and bool(settings.get("tools_enabled")) and model not in _no_tool_models
    history = _clean_messages(body.get("messages") or [])

    async def generate() -> AsyncIterator[bytes]:
        nonlocal use_tools
        think_off = True
        system = {"role": "system", "content": build_system_prompt(mode, settings, use_tools)}
        messages: list[dict[str, Any]] = [system, *history]

        for _round in range(MAX_TOOL_ROUNDS):
            payload: dict[str, Any] = {"model": model, "messages": messages, "stream": True}
            if use_tools:
                payload["tools"] = TOOLS
            if mode == "voice" and think_off:
                payload["think"] = False  # reasoning models answer much faster aloud without it
            content, calls, stats = "", [], {}
            try:
                async with client.stream("POST", f"{OLLAMA}/api/chat", json=payload) as resp:
                    if resp.status_code != 200:
                        text = (await resp.aread()).decode(errors="replace")
                        if "think" in payload and "think" in text.lower():
                            think_off = False
                            continue
                        if use_tools and "tool" in text.lower():
                            # Model can't use tools: remember that and retry as plain chat.
                            _no_tool_models.add(model)
                            use_tools = False
                            messages[0] = {"role": "system", "content": build_system_prompt(mode, settings, False)}
                            continue
                        yield _event("error", message=_ollama_error(text, resp.status_code))
                        return
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        chunk = json.loads(line)
                        if chunk.get("error"):
                            yield _event("error", message=chunk["error"])
                            return
                        msg = chunk.get("message") or {}
                        if msg.get("thinking"):
                            yield _event("thinking", content=msg["thinking"])
                        if msg.get("content"):
                            content += msg["content"]
                            yield _event("token", content=msg["content"])
                        if msg.get("tool_calls"):
                            calls.extend(msg["tool_calls"])
                        if chunk.get("done"):
                            stats = {
                                "eval_count": chunk.get("eval_count"),
                                "eval_duration": chunk.get("eval_duration"),
                                "total_duration": chunk.get("total_duration"),
                            }
            except httpx.ConnectError:
                yield _event("error", message=f"Can't reach Ollama at {OLLAMA}. Is the Ollama app running?")
                return

            if not calls:
                yield _event("done", stats=stats)
                return

            messages.append({"role": "assistant", "content": content, "tool_calls": calls})
            for call in calls:
                fn = call.get("function") or {}
                name = fn.get("name", "")
                args = parse_args(fn.get("arguments"))
                result = await run_in_threadpool(run_tool, name, args)
                yield _event("tool", name=name, args=args, result=result)
                messages.append({"role": "tool", "content": json.dumps(result), "tool_name": name})

        yield _event("done", stats={})

    return StreamingResponse(generate(), media_type="application/x-ndjson")


def _ollama_error(text: str, status: int) -> str:
    try:
        msg = json.loads(text).get("error", text)
    except json.JSONDecodeError:
        msg = text
    if status == 404 and "not found" in msg.lower():
        msg += " — download it in Settings → Models."
    return msg or f"Ollama returned HTTP {status}"


# ------------------------------------------------------------ ollama models

@app.get("/api/status")
async def status():
    info: dict[str, Any] = {"ollama_url": OLLAMA, "ollama": False, "whisper": speech.available()}
    try:
        resp = await client.get(f"{OLLAMA}/api/version", timeout=3)
        info["ollama"] = resp.status_code == 200
        info["ollama_version"] = resp.json().get("version")
    except Exception:
        pass
    return info


@app.get("/api/models")
async def models():
    try:
        resp = await client.get(f"{OLLAMA}/api/tags", timeout=5)
        resp.raise_for_status()
    except Exception:
        return {"models": [], "error": f"Can't reach Ollama at {OLLAMA}"}
    items = []
    for m in resp.json().get("models", []):
        details = m.get("details") or {}
        items.append({
            "name": m.get("name"),
            "size": m.get("size"),
            "family": details.get("family"),
            "parameters": details.get("parameter_size"),
            "quantization": details.get("quantization_level"),
        })
    items.sort(key=lambda m: m["name"] or "")
    return {"models": items}


@app.post("/api/models/pull")
async def pull_model(request: Request):
    name = str((await request.json()).get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Model name required")

    async def generate() -> AsyncIterator[bytes]:
        try:
            async with client.stream("POST", f"{OLLAMA}/api/pull", json={"model": name, "stream": True}) as resp:
                async for line in resp.aiter_lines():
                    if line.strip():
                        yield (line + "\n").encode()
        except httpx.ConnectError:
            yield _event("error", error=f"Can't reach Ollama at {OLLAMA}")

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@app.delete("/api/models/{name:path}")
async def delete_model(name: str):
    resp = await client.request("DELETE", f"{OLLAMA}/api/delete", json={"model": name})
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, _ollama_error(resp.text, resp.status_code))
    return {"ok": True}


# ----------------------------------------------------------------- speech

@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    if not speech.available():
        raise HTTPException(501, "Offline speech recognition not installed. Run install-voice.")
    settings = store.get_settings()
    suffix = Path(audio.filename or "audio.webm").suffix or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await audio.read())
        path = tmp.name
    try:
        text = await run_in_threadpool(
            speech.transcribe, path, settings.get("whisper_model", "base.en"), settings.get("whisper_device", "cpu")
        )
    except Exception as exc:
        raise HTTPException(500, f"Transcription failed: {exc}") from exc
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    return {"text": text}


# --------------------------------------------------------- settings/chats

@app.get("/api/settings")
async def get_settings():
    return store.get_settings()


@app.put("/api/settings")
async def put_settings(request: Request):
    return store.update_settings(await request.json())


@app.get("/api/conversations")
async def list_conversations():
    return store.list_conversations()


@app.get("/api/conversations/{chat_id}")
async def get_conversation(chat_id: str):
    chat = store.get_conversation(chat_id)
    if not chat:
        raise HTTPException(404, "Not found")
    return chat


@app.put("/api/conversations/{chat_id}")
async def save_conversation(chat_id: str, request: Request):
    if not store.valid_id(chat_id):
        raise HTTPException(400, "Bad id")
    return store.save_conversation(chat_id, await request.json())


@app.delete("/api/conversations/{chat_id}")
async def delete_conversation(chat_id: str):
    return {"ok": store.delete_conversation(chat_id)}


# ------------------------------------------------------------------ tasks

@app.get("/api/tasks")
async def list_tasks():
    return store.list_tasks()


@app.post("/api/tasks")
async def add_task(request: Request):
    body = await request.json()
    title = str(body.get("title", "")).strip()
    if not title:
        raise HTTPException(400, "Title required")
    return store.add_task(title, str(body.get("due", "")), str(body.get("priority", "normal")), str(body.get("notes", "")))


@app.patch("/api/tasks/{task_id}")
async def update_task(task_id: str, request: Request):
    task = store.update_task(task_id, await request.json())
    if not task:
        raise HTTPException(404, "Not found")
    return task


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: str):
    return {"ok": store.delete_task(task_id) is not None}


# The UI itself (mounted last so /api routes win)
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
