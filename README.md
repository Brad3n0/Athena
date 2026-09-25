# ✦ Athena AI

A private, **fully offline** AI assistant for your home PC. It looks and works like ChatGPT, but it runs local AI models through [Ollama](https://ollama.com), so your chats never leave your computer.

- 💬 **Assistant mode**: everyday chat, writing, planning and questions
- 🧑‍💻 **Code mode**: a coding model with syntax-highlighted code blocks, one-click copy, and file attachments (attach your source files and ask about them)
- 📘 **Study mode**: study guides, interactive **flashcards** (flip, shuffle, mark as known), clickable **practice quizzes** with scores, step-by-step homework help and study plans. Attach your notes as PDF, Word, PowerPoint or photos
- 🎙️ **Voice mode**: talk to Athena hands-free. She listens, answers out loud in a natural offline voice, and you can tap to interrupt
- 🟡 **Voice orb**: a living gold orb that reacts to her voice and yours
- 🧠 **Memory**: say *"remember that my sister's birthday is June 3rd"* and she knows it in every future chat
- 📁 **Files**: *"find my resume"*, *"organize my Downloads"*, *"move the PDFs on my Desktop into Documents/Taxes"*, *"write my shopping list to a file"*, *"undo that"*
- 🌐 **Web search** (when you're online): *"what's the weather in Chicago this weekend?"*, *"look up the newest Ollama models"*
- 👀 **Watch her work**: every step shows up live in the chat, and she opens folders in File Explorer and pages in your browser as she works
- ✅ **Tasks & timers**: say *"remind me to pay rent Friday"*, *"what's on my list?"*, *"I finished the laundry"* or *"set a 10 minute timer for the pasta"*
- 🗂️ Chat history with search inside every message (**Ctrl+K**, and she can look through past chats herself: *"what did we decide about my resume last week?"*), rename and delete, plus a model picker, dark/light themes, image understanding (with a vision model) and a phone-friendly layout

---

## 1. One-time setup (needs internet once)

1. **Install Ollama:** https://ollama.com/download. It runs quietly in your system tray.
2. **Install Python 3.10+:** https://www.python.org/downloads/. On Windows, tick **"Add python.exe to PATH"**.
3. **Get Athena:** download this repo (Code → Download ZIP) and unzip it, or `git clone` it.
4. **Download AI models:** double-click **`pull-models.bat`** and choose your graphics card size. You can also do this later inside Athena under **Settings → Models**.
5. **Enable offline voice (recommended):** double-click **`install-voice.bat`**. It installs [faster-whisper](https://github.com/SYSTRAN/faster-whisper) so Athena can hear you, and [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) so she can talk in a natural voice. Together they download about 500 MB.

Linux/macOS: use `./pull-models.sh`, `./install-voice.sh` and `./start.sh` instead.

## Updating Athena

Double-click **`update.bat`** to get the newest version. The first time, it installs Git and asks you to sign in to GitHub once (the repo is private). After that it just downloads what changed. Your chats, settings and installed parts stay exactly as they are. Close Athena's black window and double-click `start` afterwards.

## 2. Every day

Double-click **`start.bat`**. Athena opens in your browser at **http://localhost:8765**. After setup it works with your internet unplugged.

---

## Which models should I use?

These are the best Ollama models I'd pick right now for each job. Sizes are for the default 4-bit downloads. New models come out all the time, so check [ollama.com/library](https://ollama.com/library) and paste any model name into **Settings → Models → Download**.

| Your GPU (VRAM) | Assistant / chat | Code | Study / homework | Voice (needs to be fast) |
|---|---|---|---|---|
| No GPU / < 6 GB | `qwen3:4b` | `qwen2.5-coder:3b` | `qwen3:4b` | `qwen3:4b` |
| 8 GB | `qwen3:8b` | `qwen2.5-coder:7b` | `qwen3:8b` | `qwen3:4b` |
| 12–16 GB | `gpt-oss:20b` (16 GB) or `qwen3:14b` | `qwen2.5-coder:14b` | **`qwen3:14b`** | `qwen3:4b` |
| 24 GB+ | `gpt-oss:20b` | **`qwen3-coder:30b`** | **`qwen3:14b`** or `gpt-oss:20b` | `qwen3:4b` or `qwen3:8b` |

**For schoolwork**, `qwen3:14b` is the best pick. It's excellent at math and science and works problems out step by step; you can open "Thought for …" to see its reasoning. To use photos of worksheets or handwritten notes, also get `qwen2.5vl:7b`: Athena switches to it automatically when you attach a photo. Set these under **Settings → Models → Study model / Vision model**, or leave them on Automatic.

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

## Study mode

Click **Study** at the top, next to Assistant and Code.

- Tap a starter (**Study guide**, **Flashcards**, **Practice quiz**, **Homework help**, **Explain simply**, **Study plan** or **Summarize my notes**) and finish the sentence, or just ask: *"quiz me on the causes of World War I"*.
- **Flashcards** appear as real cards. Click (or press Space) to flip, use ← → to move, **✓ Got it** to track what you know, and ⤮ to shuffle.
- **Quizzes** are clickable. Each answer shows whether you were right, with an explanation, and you get a score at the end.
- **Math looks like a textbook:** fractions, exponents, square roots and equations are drawn properly, including on flashcards and quizzes, and she reads them aloud correctly ("x squared equals 9 over 3").
- **Attach your material** with 📎: PDFs, Word documents, PowerPoint slides, text files, or photos of worksheets and handwritten notes (photos need a vision model like `qwen2.5vl:7b`). Everything she makes is based on your material.
- **Explain my mistake:** get a quiz question wrong and press **🤔 Explain my mistake** for why your answer was wrong, why the right one is right, and a tip for next time.
- **🔥 Study streak:** every day you review flashcards or use the Study tab counts. See your streak in **Decks** and on the Study screen.
- **📄 Cheat sheet:** press the chip under a study reply (or type `/cheatsheet derivatives`) for a one-page sheet of formulas, methods and common mistakes in the canvas. Press 🖨 to print it or save it as a PDF.
- Combine it with other features: *"remind me to study biology every day at 7pm"*, `/focus 25 minutes on chemistry`, or ⭐ a study guide to keep it under **Saved**.

## Code projects

In **Code** mode, click the 📂 folder button under the message box (or type `/folder`) and pick your project folder. Now she can work on the real code:

- *"Explain how this project works"*, *"where is the login handled?"*: she browses the files, searches the code and reads what she needs.
- *"Add a dark mode toggle"*, *"fix the bug where the total is wrong"*: each change appears as a **diff** (green lines added, red removed) and nothing is saved until you press **Allow**.
- *"Run the tests"*: she runs commands like `npm test` or `pytest` in the project folder (after you OK them) and fixes what fails.
- *"Undo that"* puts the last changed file back. Copies of the old versions are kept in `data/code_backups`.

She skips `node_modules`, `.git`, build folders and anything in your `.gitignore`.

## Writing canvas

For essays, emails, cover letters and stories, click the 📄 button at the top (or type `/canvas cover letter for a barista job`). A document editor opens next to the chat.

- **Highlight some text** and press **Improve**, **Shorter**, **Longer**, **Simpler**, **Fix grammar** or pick a **Tone**. Only that part gets rewritten. With nothing highlighted, the whole document is rewritten.
- **Ask for bigger changes** in the box under the document (*"add a strong closing paragraph"*) or just in the chat (*"make it sound more confident"*). She rewrites the document in place.
- **Undo** (Ctrl+Z) takes back any change, including hers. 👁 shows the formatted version, and you can copy or download it as a file.
- Any reply can be moved into the canvas with the 📄 button under it. Each chat keeps its own document.

## Projects

Projects are folders for your chats, like one per class or per app you're building. Click **+** next to **Projects** in the sidebar, then give the project:

- a name and an emoji,
- **instructions** she follows in every chat inside it (*"I'm in Algebra 1, explain step by step"*),
- **files** she should always know about, such as notes, a syllabus, code, PDFs or Word documents.

While a project is open, new chats go into it, and the sidebar only shows that project's chats. Press ✕ to go back to all chats. To move an existing chat, hover over it and click the 📁 folder icon.

## Like Jarvis: run your PC

With PC control on (Settings → Abilities), just ask, typed or out loud:

- **"How's my PC doing?"** CPU, memory, graphics card load and memory, free space, network, battery and the busiest apps. There's also a live view in **Settings → Jarvis**. Temperatures show for NVIDIA cards; Windows doesn't share AMD or CPU temperatures with apps.
- **Windows:** *"put Discord on my second monitor"*, *"snap Chrome to the left"*, *"minimize everything"*, *"close Spotify"*.
- **Typing and clicking:** *"type my address into Notepad"*, *"press ctrl+s"*, *"click the Join button"*. Clicking uses a screenshot, so it needs a vision model like `qwen2.5vl:7b`.
- **Messages:** *"message Jake on Discord that I'm running 10 minutes late"*. She opens Discord, jumps to Jake with Ctrl+K, checks the right chat opened (with a vision model), and sends it. You see exactly who and what first and press **Allow**. WhatsApp works the same way (most reliable with a saved phone number). Texts (through Phone Link) and emails open as a ready draft for you to send. Add people in **Settings → Jarvis → Contacts** with their exact Discord username.
- **Routines:** one phrase, many steps. Make them in **Settings → Jarvis → Routines** or just ask: *"make a goodnight routine that closes Chrome and Discord, sets volume to 20 and locks my PC"*. Then say *"goodnight"* (or *"Hey Athena, game time"*) and it all happens instantly.
- **Heads-ups:** she speaks up when a download finishes, the CPU is maxed or memory is almost full (and says which app), a drive is nearly full, a laptop battery is low, or a reminder is 5 minutes away. Choose which ones in **Settings → Jarvis**.

She works your real apps with the keyboard and mouse like you would, so keep the PC unlocked while she's doing things, and keep your hands off the keyboard for those few seconds.

## Desktop app, "Hey Athena" and more

- **Desktop app:** double-click **`start-desktop.bat`**. Athena opens in her own window and lives in the system tray. Press **Ctrl+Space** anywhere to bring her up, or **Ctrl+Shift+Space** to start talking. In **Settings → Desktop app** you can turn on **Start with Windows** and create Desktop/Start menu shortcuts.
- **"Hey Athena":** turn it on in **Settings → Voice**. Say *"Hey Athena"*, or *"Hey Athena, what's the weather?"*, and she starts listening. It needs `install-voice`. Everything is processed offline, and nothing is recorded or kept.
- **Reminders & morning briefing:** *"remind me at 6pm to call mom"* pops up and speaks at 6pm, even if the window was closed; the tray shows a notification. Set a **Morning briefing** time and your **home city** in **Settings → Integrations**, and she greets you with the weather, your tasks and your reminders.
- **"What's on my screen?":** ask her, or click the 🖥 button next to the paperclip to attach a screenshot. This needs a vision model like `qwen2.5vl:7b` or `gemma3:12b`.
- **Your documents:** in **Settings → Knowledge**, add folders of notes, PDFs and Word files, then click **Index now**. Ask things like *"what does my lease say about pets?"*
- **PC control:** *"open Spotify"*, *"volume to 30"*, *"pause the music"*, *"lock my PC"*, *"shut down in an hour"*, and *"rewrite what I copied to sound professional"* (clipboard).
- **Run code:** Python, JavaScript, TypeScript, PowerShell and Bash code blocks get a **▶ Run** button, and in chat she can run code to check her own work (she asks first). Charts made with matplotlib show up right in the chat. JavaScript and TypeScript need [Node.js](https://nodejs.org).
- **See the finished product:** when you ask for anything visual (*"a pomodoro timer"*, *"a snake game"*, *"a landing page for my bakery"*), she builds it as a complete page and it **opens running in the chat** as soon as she finishes. Click around and play with it, switch between 🖥 computer and 📱 phone size, ↗ open it full size in its own tab, or ⛶ go full screen. If she splits it into HTML, CSS and JavaScript blocks, the preview puts them together. Previews run in a locked-down sandbox and can't touch your files or chats. Turn off automatic previews in **Settings → General** if you like.
- **Python games and apps** (pygame, tkinter, turtle) open in **their own window on your PC** when you press ▶ Run, and keep running until you close them.
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
- **Voice commands** work instantly, without waiting for the model: *"repeat that"*, *"slow down"* / *"talk faster"*, *"start over"* (new chat), *"switch to study mode"*, *"save that"*, *"copy that"*, *"open the canvas"*, *"never mind"*, *"take a break"* (she dozes until you tap the orb) and *"goodbye"*.
- **Other languages:** pick one in **Settings → Voice → Language**, or choose **auto-detect** and just speak. She hears it, replies in it and speaks it. Her natural voice speaks Spanish, French, Italian, Portuguese, Hindi, Japanese and Chinese. Other languages (German, Korean, Arabic…) use a Windows voice, and you can add more under *Windows Settings → Time & language → Speech*. In voice chat you can also say *"talk to me in Spanish"*.

## Good to know

- Everything is stored in the `data/` folder: chats, tasks and settings as plain JSON. Back it up or delete it anytime.
- Use Athena from your phone on the same Wi-Fi: `start.bat --host 0.0.0.0`, then open `http://<your-pc-ip>:8765`. If you reach it by a custom name (like a domain), add that name to the `ATHENA_ALLOWED_HOSTS` environment variable. Athena refuses unknown names and requests sent from other websites, so a web page can't secretly control her. Browsers only allow the microphone on `localhost`, so voice works on the PC itself.
- Other options: `--port 9000` changes the port, and `--no-browser` stops the browser opening. `OLLAMA_HOST` is respected if Ollama runs elsewhere.
- **Ready dot:** the dot next to the model name turns gold when that model is loaded and will answer right away. A hollow dot means the first reply takes a few seconds; click it to load the model now.
- **Reply length:** **Settings → General → Reply length** switches between Short, Normal and Detailed answers.
- **Look and feel:** the name and headings use Cinzel, a classical Greek-style font. The sidebar and message box are frosted glass over the night sky. A gold shooting star crosses the sky now and then, and seasons show up too: snow in December, falling leaves in autumn, and fireworks at New Year and on the Fourth of July. The message box glows gold while you type, and a gold cursor follows her words as she writes. Shooting stars and seasonal effects can be turned off in **Settings → General**.
- **Little touches:** the welcome screen notices holidays, Fridays, late nights and when you've been away, and the voice orb glows warmer when she's happy and calmer when she's being gentle.
- **Each mode keeps its own chat:** switch from Assistant to Study and you get your study chat (or a fresh one). Switch back and your Assistant chat is right where you left it. To take a conversation into another model without switching modes, pick a model from the menu at the top.
- **Branch a chat:** press ⑂ under any reply to start a new chat that continues from that point. The original stays as it was, which is handy for trying a different direction.
- **Compare models:** open the model menu and click ⚖ next to another model. Your next messages get two answers side by side (with speed and length), and you keep the better one. The other stays as a version (‹ ›). Press ✕ on the "Comparing" bar to stop. Two big models at once can be slow if your graphics card can only hold one.
- **Quick commands:** type **/** in the message box for a menu: `/remind`, `/timer`, `/weather`, `/search`, `/image`, `/find`, `/organize`, `/docs`, `/screen`, `/open`, `/remember`, `/run`, `/brief`, `/voice`, `/canvas`, `/folder` and `/new`.
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
  automation.py  Windows, monitors, typing, keys and clicks (Windows API)
  messaging.py   Discord / WhatsApp / text / email, and contacts
  routines.py    One phrase, many steps
  monitor.py     Heads-ups: downloads, PC health, reminders
  pcstatus.py    "How's my PC doing?"
  workspace.py   Code projects: read, search and edit a folder of code, with diffs and undo
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
  study.js       Study mode flashcards and quizzes
  markdown.js    Markdown + code highlighting
```
