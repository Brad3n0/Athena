# ✦ Athena AI

A private, **fully offline** AI assistant for your home PC. Like Jarvis, but yours.

- 💬 **Assistant**: chat, writing, planning and questions
- 🧑‍💻 **Code**: writes, fixes and runs code, and can work on a whole project folder
- 📘 **Study**: study guides, flashcards, quizzes and homework help from your own notes
- 🎙️ **Voice**: talk to her hands-free. Ask her anything, or just chat if you're bored
- 🧠 **Memory**: she remembers what you tell her and gets smarter the more you use her
- 🖥️ **Runs your PC**: opens apps, sends messages, controls music, finds files
- 🌐 **Web search** when you're online, and everything else works offline

---

## Setup (needs internet once)

1. **Install Python 3.10+** from [python.org](https://www.python.org/downloads/). On Windows, tick **"Add python.exe to PATH"**.
2. **Get Athena:** Code → Download ZIP and unzip it, or `git clone` it.
3. **Double-click `start.bat`.** A short setup checks your graphics card and suggests settings. The first time, she downloads her engine and her brain (about 6 GB). Progress shows at the top.
4. **Voice (recommended):** double-click **`install-voice.bat`** (about 500 MB) so she can hear you and talk in a natural voice.

After the first run there's an **Athena.exe** in her folder and on your Desktop. Double-click it to open her with no command windows.

Linux/macOS: use `./start.sh` and `./install-voice.sh`.

**Updating:** click **Update now** when Athena says an update is available (or **Settings → General → Updates**, or `update.bat`). Your chats, memories and settings are kept.

---

## Athena's Brain

Athena runs her AI herself with a built-in engine that works on AMD and NVIDIA cards. One brain, **Qwen3-VL 8B**, handles chat, code, tools and pictures. Change it in **Settings → Models → Engine**, or switch to Ollama if you prefer. When a smarter brain comes out, a one-click **brain upgrade** keeps all her memories and settings.

**🧠 See her mind:** click **Athena's Brain** in the sidebar for a 3D, Jarvis-style map of what she knows: memories, lessons, library, reflections and skills, linked where related. It lights up live while she thinks. Drag to turn, scroll to zoom, click a star to read or delete it, and slide the timeline to watch her grow. It pauses while you're in a game.

## She learns and grows

- **Memory:** *"remember my mom's birthday is on June 10th"*. She also picks up things about you on her own.
- **Lessons:** rate answers 👍 / 👎 or correct her, and she follows it in every chat.
- **Library:** everything she looks up is saved, so next time she already knows it.
- **Nightly reflection:** when the PC is idle (never during games), she reviews the day and writes herself lessons.

All of it is on your PC, editable in **Settings → About you**, and never changes her personality.

## Study

- **Flashcards** you can flip and shuffle, saved into **Decks** that bring back the cards you miss (spaced repetition, like Anki).
- **Clickable quizzes** with scores, and **🤔 Explain my mistake** for wrong answers.
- **Math** displays like a textbook, and **graphs** of equations show right in the chat.
- Attach **PDFs, Word, PowerPoint or photos** of your notes. **📄 Cheat sheets** print to one page.
- A daily **🔥 study streak**.

## Code

- Open a project folder (📂) and ask her to explain it, fix bugs or add features. Every change shows as a **diff** and waits for **Allow**.
- She runs tests, **builds websites and apps from scratch**, screenshots them, fixes what looks broken, and can put them on **GitHub**.
- **▶ Run** code blocks; web pages and games **open live in the chat**.
- **Live error check** shows problems as you work.

## Like Jarvis: run your PC

Typed or spoken:

- **Apps & web:** *"open Discord and Spotify"*, *"watch (YouTubers name)"*, *"search Amazon for AA batteries"*
- **Windows & keys:** *"snap Chrome left"*, *"minimize everything"*, *"click Subscribe"*, *"type my address"*
- **Music & PC:** *"pause the music"*, *"volume to 30"*, *"lock my PC"*, *"how's my PC doing?"*
- **Messages:** Discord, WhatsApp, Instagram, Snapchat and more: *"message my brother on Discord I'm on"*. You see it and press **Allow** first.
- **Find things:** *"find the folder Crimson Desert is in"* (checks Steam, Epic and Xbox too)
- **Routines:** one phrase, many steps: *"goodnight"* closes apps, lowers the volume and locks the PC.
- **Heads-ups:** she speaks up when a download finishes, memory is full, or a reminder is close.
- **Tasks & reminders:** *"remind me at 12pm to call my professor"*, *"set a 10 minute timer"*. She also adds tasks you mention and ticks them off.

## Pictures

- **Edit photos:** *"crop it square and make it brighter"*, *"remove the background"*, or the **✏️ Edit** button.
- **Make pictures:** *"make a picture of a red fox at sunset"*. Install the free [ComfyUI Desktop](https://www.comfy.org/download) app (works on AMD) and she finds it by herself.

## Sports

Scores, schedules, standings, injuries and past seasons: `/scores NBA tonight`. Check a PrizePicks or Underdog pick: `/pick LeBron over 24.5 points` shows how often he has hit that line. These are facts, not guarantees.

## Voice

- Click the **waveform button** to talk. She replies when you pause; interrupt her just by talking.
- **"Hey Athena"** wake word (Settings → Voice).
- Her voice changes with your mood. Pick from several natural voices, or a **custom voice** from a recording of someone who gave permission.
- Speaks Spanish, French, Japanese and more.

## Use her on your phone

1. Set a PIN in **Settings → Privacy & data**.
2. Tick **Let my phone use Athena** in **Settings → Desktop app**, then restart Athena.
3. Scan the QR code. Tap **Advanced → Proceed** on the warning (it's your own PC's certificate). Then **Add to Home Screen**.

**Away from home:** install **Tailscale** (free app) on the PC and phone (same account) and use the **🌍 From anywhere** address. Voice works on the phone too.

## She can edit herself (some bugs still getting worked out)

*"Add a section to your settings for my workouts"* or *"fix the send button on my phone"*. She changes her own code, shows each change for **Allow**, checks it works, then restarts. Say *"undo your changes"* to go back.

## More

- **Writing canvas** for essays and emails, with Improve, Shorter, Tone and more.
- **Projects:** chat folders with their own instructions and files.
- **Deep research** with sources, and **Think harder** for tough problems.
- **Your documents:** ask about your own PDFs and notes (Settings → Knowledge).
- **Personalities:** Assistant, Companion, Study Buddy, or make your own.
- **Offline mode**, **PIN lock**, **daily backups**, and **Check everything** to test every part of her.
- **Desktop app** in the tray: **Ctrl+Alt+Space** opens her, ignored during fullscreen games.
- Themes, accent colours, chat search (**Ctrl+K**), branch chats and compare models side by side.

All your data stays in the `data/` folder on your PC.

## Project layout

```
athena/        Python server (FastAPI): chat, tools, engine, voice, PC control
  engine.py    Built-in AI engine (llama.cpp) and brain downloads
  library.py   What she's looked up, reflect.py nightly lessons, learning.py memory
static/        The app (plain HTML/CSS/JS, works offline)
  brain3d.js   Athena's Brain 3D view
launcher/      Athena.exe
```

## System requirements

| | **Minimum** | **Recommended** |
|---|---|---|
| **OS** | Windows 10 64-bit | Windows 11 64-bit |
| **Processor** | 4 cores (Ryzen 3 3100 / Core i3-10100) | 6–8 cores (Ryzen 5 5600 / Core i5-12400) |
| **Memory** | 16 GB RAM | 32 GB RAM |
| **Graphics** | 8 GB VRAM (Radeon RX 6600 / GeForce RTX 3050 8 GB) | 12–16 GB VRAM (Radeon RX 9060 XT 16 GB / GeForce RTX 4060 Ti 16 GB) |
| **Storage** | 15 GB free | 40 GB free on an SSD |
| **Network** | Internet for the first setup | Internet for web search, sports and updates |
| **Extras** | | Microphone and speakers for voice chat |

- **AMD and NVIDIA** cards both work. Intel Arc should too, but hasn't been tested.
- **No graphics card?** She still runs on the processor, but replies are much slower.
- **Recommended specs** run bigger brains like Qwen3 14B, and leave room for image generation.
- **Mac:** Apple Silicon (M1 or newer) with 16 GB memory. PC control features are Windows only.

## Athena Ai is not perfect, she is still under construction, so please post any problems or suggestion on the discussions page (https://github.com/Dominationdrago/Athena/discussions/1) -Thank You
