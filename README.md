# ✦ Athena AI

A private, **fully offline** AI assistant for your home PC. It looks and works like ChatGPT, but it runs local AI models through [Ollama](https://ollama.com), so your chats never leave your computer.

- 💬 **Assistant mode**: everyday chat, writing, planning and questions
- 🧑‍💻 **Code mode**: a coding model with syntax-highlighted code blocks, one-click copy, and file attachments (attach your source files and ask about them)
- 🎙️ **Voice mode**: talk to Athena hands-free. She listens, answers out loud in a natural offline voice, and you can tap to interrupt
- 🟡 **Voice orb**: a living gold orb that reacts to her voice and yours
- 🧠 **Memory**: say *"remember that my sister's birthday is June 3rd"* and she knows it in every future chat
- 📁 **Files**: *"find my resume"*, *"organize my Downloads"*, *"move the PDFs on my Desktop into Documents/Taxes"*, *"write my shopping list to a file"*, *"undo that"*
- 🌐 **Web search** (when you're online): *"what's the weather in Chicago this weekend?"*, *"look up the newest Ollama models"*
- 👀 **Watch her work**: every step shows up live in the chat, and she opens folders in File Explorer and pages in your browser as she works
- ✅ **Tasks & timers**: say *"remind me to pay rent Friday"*, *"what's on my list?"*, *"I finished the laundry"* or *"set a 10 minute timer for the pasta"*
- 🗂️ Chat history with search, rename and delete, plus a model picker, dark/light themes, image understanding (with a vision model) and a phone-friendly layout

---

## 1. One-time setup (needs internet once)

1. **Install Ollama:** https://ollama.com/download. It runs quietly in your system tray.
2. **Install Python 3.10+:** https://www.python.org/downloads/. On Windows, tick **"Add python.exe to PATH"**.
3. **Get Athena:** download this repo (Code → Download ZIP) and unzip it, or `git clone` it.
4. **Download AI models:** double-click **`pull-models.bat`** and choose your graphics card size. You can also do this later inside Athena under **Settings → Models**.
5. **Enable offline voice (recommended):** double-click **`install-voice.bat`**. It installs [faster-whisper](https://github.com/SYSTRAN/faster-whisper) so Athena can hear you, and [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) so she can talk in a natural voice. Together they download about 500 MB.

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

## Desktop app, "Hey Athena" and more

- **Desktop app:** double-click **`start-desktop.bat`**. Athena opens in her own window and lives in the system tray. Press **Ctrl+Space** anywhere to bring her up, or **Ctrl+Shift+Space** to start talking. In **Settings → Desktop app** you can turn on **Start with Windows** and create Desktop/Start menu shortcuts.
- **"Hey Athena":** turn it on in **Settings → Voice**. Say *"Hey Athena"*, or *"Hey Athena, what's the weather?"*, and she starts listening. It needs `install-voice`. Everything is processed offline, and nothing is recorded or kept.
- **Reminders & morning briefing:** *"remind me at 6pm to call mom"* pops up and speaks at 6pm, even if the window was closed; the tray shows a notification. Set a **Morning briefing** time and your **home city** in **Settings → Integrations**, and she greets you with the weather, your tasks and your reminders.
- **"What's on my screen?":** ask her, or click the 🖥 button next to the paperclip to attach a screenshot. This needs a vision model like `qwen2.5vl:7b` or `gemma3:12b`.
- **Your documents:** in **Settings → Knowledge**, add folders of notes, PDFs and Word files, then click **Index now**. Ask things like *"what does my lease say about pets?"*
- **PC control:** *"open Spotify"*, *"volume to 30"*, *"pause the music"*, *"lock my PC"*, *"shut down in an hour"*, and *"rewrite what I copied to sound professional"* (clipboard).
- **Run code:** Python code blocks get a **▶ Run** button, and in chat she can run code to check her own work (she asks first).
- **Images:** connect Stable Diffusion WebUI Forge in **Settings → Integrations**, then say *"draw a gold owl on a night sky"*.
- **Smart home:** connect Home Assistant in **Settings → Integrations**: *"turn off the kitchen lights"*, *"set the thermostat to 70"*.
- **Personalities:** Assistant, Companion, Coach, Study Buddy and Chef, or create your own with its own voice (**Settings → General**).
- **PIN lock, export & backup:** **Settings → Privacy & data**. To export a single chat, hover over it in the sidebar and click ⤓ to save it as Markdown, Word or PDF.

## Abilities: files, web, memory

Turn these on or off in **Settings → Abilities**. They need a model that supports tools; `gpt-oss:20b` and `qwen3` work best.

- **Files:** Athena can only see and change files in the folders listed there. By default that's your Desktop, Documents, Downloads, Pictures, Music and Videos. Before she **moves, writes or deletes** anything, a pop-up shows exactly what she's about to do, with **Allow** / **Deny** buttons. Deleted files go to the **Recycle Bin**, and *"undo that"* reverses her last change, such as putting organized files back where they were.
- **Watching:** each step appears live in the chat (*"Searching your files for 'resume'…"*, *"Organized 42 files in ~/Downloads"*). Click a step to see the details. With **Show her work on my screen** turned on, she opens the folder in File Explorer before moving files, so you can watch them move, and opens the pages she reads in your browser.
- **Web:** uses DuckDuckGo, so no account or API key is needed. It only works while you're online; everything else keeps working offline.
- **Memory:** everything she remembers is listed in **Settings → Abilities → Memories**, where you can delete it.
- **PDFs:** to let her read PDFs, run `.venv\Scripts\pip install pypdf` once.

## Voice chat & companion mode

- In voice chat Athena appears as a **living gold orb**. It ripples with her voice, sends out rings while it listens to you, and swirls with orbiting arcs while she's thinking. Tap it to interrupt her.
- Her default voice is **Athena Silk**, which is soft, breathy and a little sultry. Try **Velvet** (warmer) or **Honey** (sweeter, more playful) in **Settings → Voice → Natural voice**. Lower the **Voice pitch** for sultrier or raise it for cuter, then press **▶ Test voice**.
- **Settings → General → Personality → Companion** makes her a playful, warm friend instead of a formal assistant.

## Voice tips

- Click the **waveform button** next to the message box to start a voice conversation. Just talk, and Athena replies when you pause. Tap the orb to interrupt her. Say *"goodbye"* or press **Esc** to end.
- The **microphone button** dictates into the message box instead.
- **Speech-to-text** runs locally with Whisper (`base.en` by default). If you have an NVIDIA GPU, switch to `small.en` or `large-v3-turbo` and "NVIDIA GPU" in **Settings → Voice** for better accuracy. After changing the model, run `.venv\Scripts\python.exe -m athena --preload-whisper small.en` once while online.
- **Athena's voice** uses the natural Kokoro voice once `install-voice` has run. Otherwise it uses the voices built into your PC, which also work offline. On Windows 11 you can add more natural voices under *Settings → Time & language → Speech → Manage voices*, then pick one in **Settings → Voice**. Voices marked "online" need internet.
- If you skip `install-voice`, voice mode falls back to the browser's recognizer, and in Chrome/Edge that needs internet.

## Good to know

- Everything is stored in the `data/` folder: chats, tasks and settings as plain JSON. Back it up or delete it anytime.
- Use Athena from your phone on the same Wi-Fi: `start.bat --host 0.0.0.0`, then open `http://<your-pc-ip>:8765`. Browsers only allow the microphone on `localhost`, so voice works on the PC itself.
- Other options: `--port 9000` changes the port, and `--no-browser` stops the browser opening. `OLLAMA_HOST` is respected if Ollama runs elsewhere.
- **Quick commands:** type **/** in the message box for a menu: `/remind`, `/timer`, `/weather`, `/search`, `/image`, `/find`, `/organize`, `/docs`, `/screen`, `/open`, `/remember`, `/run`, `/brief`, `/voice` and `/new`.
- **Drag & drop** files onto the chat, or paste screenshots with **Ctrl+V**.
- Chats name themselves with a short title and emoji; **pin** favourites to the top. Hover a message to see when it was sent, and click the suggestion chips under a reply to follow up. Press **?** for all keyboard shortcuts, pick one of 11 **accent colours** (gold, rose gold, silver, cyan, emerald, aurora, sunset, violet, sakura, ice, neon lime) in Settings → General, and see **Your stats** in Settings.
- **More small touches:** flip between regenerated answers (‹ 1/2 ›), ⭐ star replies to keep them under **Saved**, save code blocks as files, undo a deleted chat, a jump-to-latest button, a *"Waking up…"* note while a model loads, a different welcome line each time, text size and compact layout, optional soft sounds, and a **focus timer** (*"focus for 25 minutes on homework"* or `/focus`). Add your birthday in Settings for a surprise.
- In voice chat, captions light up word by word as she speaks, you can **interrupt her just by talking**, and she dozes after a minute of silence. Tap the orb or say *"Hey Athena"* to wake her. In voice chat, a soft chime tells you when she's listening and when she's heard you.
- Shortcuts: **Enter** sends, **Shift+Enter** adds a new line, **Ctrl+Shift+O** starts a new chat and **Esc** stops a reply.

## Project layout

```
athena/          Python server (FastAPI)
  server.py      API: streams chat from Ollama, runs tools, model downloads, speech-to-text
  tools.py       Tools the AI can call (tasks, timers, memory, files, web) + approval rules
  files.py       Safe file operations limited to allowed folders, with undo journal
  web.py         Web search (DuckDuckGo) and page reading
  scheduler.py   Reminders, timers and the morning briefing
  events.py      Live events to open windows (reminders, wake word)
  pc.py          Apps, volume/media keys, power, clipboard, screenshots, running code
  knowledge.py   Document indexing and search (Ollama embeddings)
  integrations.py  Image generation (Stable Diffusion) and Home Assistant
  weather.py     Weather (Open-Meteo)
  security.py    PIN lock
  exporter.py    Chat export and backup/restore
  wake.py        "Hey Athena" wake word
  desktop.py     Tray icon, hotkeys, app window, start with Windows
  speech.py      Offline Whisper transcription
  tts.py         Offline natural voice (Kokoro)
  store.py       JSON storage for chats, tasks, settings
static/          The web app (plain HTML/CSS/JS, no internet or build step needed)
  app.js         Chat UI, model picker, tasks, settings, voice mode
  voice.js       Microphone + voice activity detection, text-to-speech + lip-sync level
  orb.js         The animated voice orb
  markdown.js    Markdown + code highlighting
```
