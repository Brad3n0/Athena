# Changelog

What's new in Athena, newest first. Most changes are built with [Claude Code](https://claude.ai/code).

## October 2026

- **Full code check**: if her engine can't start she answers with Ollama meanwhile (when it's installed); Health check has a new **Graphics card** check and shows her brain by name; screenshots fail with a clear message instead of an error; the engine log no longer grows forever.
- **Engine start-up fixes**: nothing can stop her brain while it's still loading (this caused "the engine stopped while loading her brain", mostly right after a PC restart); opening Athena twice shows the one that's running; she uses the tested engine version, repairs a crashing one, and falls back to the processor if the graphics driver crashes.
- **ATH-X**: Athena's brain has its own name, shown under her replies, in the model menu, in Settings and in Athena's Brain view.
- **Engine download** is more reliable: it uses the newest release that has your PC's file, remembers the lookup, and works even when GitHub's API is busy.
- **Security fixes** from GitHub's code scanning: safer chat and picture file paths, a stricter search link check, no error details sent to the page, faster text matching, and a safety net on the writing canvas.
- **Updates** use the branch's new name, `Athena-Ai`.
- **README** rewritten shorter, with the newer features added.
- **Athena's Brain view**
  - A 3D, Jarvis-style map of her mind in gold and night blue.
  - A see-through energy core with turning layers.
  - Lines coloured by section, with sparks drifting along them.
  - New memories always join the web of links.
  - It pauses while you're in another window or a game.
  - It's centred properly on phones and scaled screens.
- **Athena grows**
  - A library of everything she looks up.
  - Nightly reflection that writes her own lessons.
  - One-click brain upgrades.
- **Athena's own engine**
  - A built-in llama.cpp engine runs her brain, so Ollama isn't needed.
  - One brain model (Qwen3-VL 8B) handles chat, code and pictures.
  - Athena.exe opens her with no command windows.
- **Phone away from home**
  - A Tailscale address that works anywhere.
  - A clear "can't reach your PC" message.

## September 2026

- **Sports research**: scores, stats and pick checks (`/scores`, `/pick`).
- **Reliable picture making** and photo editing.
- **Self-editing** that can change her own UI, like adding a Settings section.
- **Game-safe hotkeys**: the desktop shortcut never pops up during games.
- **New features**: offline mode, emotion tracking, adaptive voice, an auto task manager and live code error checking.
- **Companion personality**: improved, and lessons stay with the personality they were learned in.
- **Read aloud**: more reliable.
