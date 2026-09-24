# ✦ Athena AI

A private, **fully offline** AI assistant for your home PC. It looks and works like ChatGPT, but it runs local AI models through [Ollama](https://ollama.com), so your chats never leave your computer.

- 💬 **Assistant mode**: everyday chat, writing, planning and questions
- 🧑‍💻 **Code mode**: a coding model with syntax-highlighted code blocks, one-click copy, and file attachments (attach your source files and ask about them)
- 🎙️ **Voice mode**: talk to Athena hands-free. She listens, answers out loud, and you can tap to interrupt
- ✅ **Tasks & timers**: say *"remind me to pay rent Friday"*, *"what's on my list?"*, *"I finished the laundry"* or *"set a 10 minute timer for the pasta"*
- 🗂️ Chat history with search, rename and delete, plus a model picker, dark/light themes, image understanding (with a vision model) and a phone-friendly layout

---

## 1. One-time setup (needs internet once)

1. **Install Ollama:** https://ollama.com/download. It runs quietly in your system tray.
2. **Install Python 3.10+:** https://www.python.org/downloads/. On Windows, tick **"Add python.exe to PATH"**.
3. **Get Athena:** download this repo (Code → Download ZIP) and unzip it, or `git clone` it.
4. **Download AI models:** double-click **`pull-models.bat`** and choose your graphics card size. You can also do this later inside Athena under **Settings → Models**.
5. **Enable offline voice (recommended):** double-click **`install-voice.bat`**. It installs [faster-whisper](https://github.com/SYSTRAN/faster-whisper) and downloads its speech model.

Linux/macOS: use `./pull-models.sh`, `./install-voice.sh` and `./start.sh` instead.

## 2. Every day

Double-click **`start.bat`**. Athena opens in your browser at **http://localhost:8765**. After setup it works with your internet unplugged.

---

## Which models should I use?

These are the best Ollama models I'd pick right now for each job. Sizes are for the default 4-bit downloads. New models come out all the time, so check [ollama.com/library](https://ollama.com/library) and paste any model name into **Settings → Models → Download**.

| Your GPU (VRAM) | Assistant / chat | Code | Voice (needs to be fast) |
|---|---|---|---|
| No GPU / < 6 GB | `qwen3:4b` | `qwen2.5-coder:3b` | `qwen3:4b` |
| 8 GB | `qwen3:8b` | `qwen2.5-coder:7b` | `qwen3:4b` |
| 12–16 GB | `gpt-oss:20b` (16 GB) or `qwen3:14b` | `qwen2.5-coder:14b` | `qwen3:4b` |
| 24 GB+ | `gpt-oss:20b` | **`qwen3-coder:30b`** | `qwen3:4b` or `qwen3:8b` |

- **gpt-oss:20b**: OpenAI's open-weight reasoning model. A great all-rounder, and very good at using Athena's task tools.
- **qwen3**: smart, multilingual, great at tools. It "thinks" before answering, and you can expand the thinking in the chat. Athena turns thinking off in voice mode so replies come back quickly.
- **qwen3-coder:30b**: one of the strongest coding models you can run at home. It is a mixture-of-experts model, so it runs surprisingly fast, even partly on CPU with 32 GB of RAM.
- **gemma3:12b**: attach a picture and ask about it.

Athena picks sensible defaults automatically. You can choose a model per mode in **Settings → Models**, or switch for a single chat with the model name at the top.

> To find your VRAM on Windows, open Task Manager → Performance → GPU → "Dedicated GPU memory".

## Fewer refusals

Athena adds no filters of her own, but most models come with their makers' built-in safety training, so they still refuse some requests. You have two options:

- **Direct mode** (Settings → General) tells Athena to answer plainly, without lecturing or adding unneeded disclaimers. It works with any model.
- **Community "abliterated" or "uncensored" models** have the refusal behaviour removed. Athena lists a few under **Settings → Models → Fewer refusals** (`huihui_ai/qwen3-abliterated`, `dolphin3`), and more can be found by searching "abliterated" on [ollama.com](https://ollama.com/search?q=abliterated). They're made by the community rather than the original companies. They're usually a little less accurate, and they may not handle Athena's tasks and timers as reliably. After downloading one, pick it as your default in **Settings → Models**.

## Voice tips

- Click the **waveform button** next to the message box to start a voice conversation. Just talk, and Athena replies when you pause. Tap the orb to interrupt her. Say *"goodbye"* or press **Esc** to end.
- The **microphone button** dictates into the message box instead.
- **Speech-to-text** runs locally with Whisper (`base.en` by default). If you have an NVIDIA GPU, switch to `small.en` or `large-v3-turbo` and "NVIDIA GPU" in **Settings → Voice** for better accuracy. After changing the model, run `.venv\Scripts\python.exe -m athena --preload-whisper small.en` once while online.
- **Athena's voice** uses the voices built into your PC, which work offline. On Windows 11 you can add more natural voices under *Settings → Time & language → Speech → Manage voices*, then pick one in **Settings → Voice**. Voices marked "online" need internet.
- If you skip `install-voice`, voice mode falls back to the browser's recognizer, and in Chrome/Edge that needs internet.

## Good to know

- Everything is stored in the `data/` folder: chats, tasks and settings as plain JSON. Back it up or delete it anytime.
- Use Athena from your phone on the same Wi-Fi: `start.bat --host 0.0.0.0`, then open `http://<your-pc-ip>:8765`. Browsers only allow the microphone on `localhost`, so voice works on the PC itself.
- Other options: `--port 9000` changes the port, and `--no-browser` stops the browser opening. `OLLAMA_HOST` is respected if Ollama runs elsewhere.
- Shortcuts: **Enter** sends, **Shift+Enter** adds a new line, **Ctrl+Shift+O** starts a new chat and **Esc** stops a reply.

## Project layout

```
athena/          Python server (FastAPI)
  server.py      API: streams chat from Ollama, runs tools, model downloads, speech-to-text
  tools.py       Tools the AI can call (tasks, timers, date/time)
  speech.py      Offline Whisper transcription
  store.py       JSON storage for chats, tasks, settings
static/          The web app (plain HTML/CSS/JS, no internet or build step needed)
  app.js         Chat UI, model picker, tasks, settings, voice mode
  voice.js       Microphone + voice activity detection, text-to-speech
  markdown.js    Markdown + code highlighting
```
