"""Start Athena AI:  python -m athena  [--port 8765] [--no-browser]"""
import argparse
import os
import sys
import threading
import traceback
import webbrowser
from pathlib import Path

import uvicorn


LOG = Path(__file__).resolve().parent.parent / "data" / "athena-desktop.log"


def _no_console_safety() -> None:
    """Started from the desktop shortcut (no black window): there's nowhere to print, and printing would crash.
    Send everything to a log file instead."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    LOG.parent.mkdir(parents=True, exist_ok=True)
    f = open(LOG, "a", encoding="utf-8", errors="replace", buffering=1)  # noqa: SIM115 (kept open while Athena runs)
    sys.stdout = sys.stdout or f
    sys.stderr = sys.stderr or f


def _popup(text: str) -> None:
    """Show a message when there's no black window to show it in (Windows)."""
    if sys.platform.startswith("win"):
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(None, text, "Athena AI", 0x10)
            return
        except Exception:
            pass
    print(text)


def main() -> None:
    _no_console_safety()
    parser = argparse.ArgumentParser(description="Athena AI — offline assistant powered by Ollama")
    parser.add_argument("--host", default=None, help="Use 0.0.0.0 to allow other devices on your network "
                        "(or turn on Settings → Desktop app → Use on your phone)")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--preload-whisper", metavar="MODEL", help="Download a Whisper model for offline use and exit")
    parser.add_argument("--download-voice", action="store_true", help="Download the natural Kokoro voice and exit")
    parser.add_argument("--desktop", action="store_true", help="Run as a desktop app with a tray icon and hotkey")
    parser.add_argument("--hidden", action="store_true", help="With --desktop: start in the tray without opening a window")
    args = parser.parse_args()

    # Already open (a second double-click, or the desktop app is in the tray)? Show that one instead of starting a
    # second Athena: it can't get her address, and it would fight the first one over the brain and graphics card.
    # Checked before anything else loads, so the second copy never starts an engine of its own.
    if not (args.desktop or args.download_voice or args.preload_whisper) and _port_busy(args.port):
        url = f"http://localhost:{args.port}"
        if _is_athena(url):
            print(f"\n  Athena is already running. Opening {url}")
            if not args.no_browser:
                webbrowser.open(url)
            return
        print(f"\n  Another program is using port {args.port}, so Athena can't start there.\n"
              f"  Close it, or start Athena on another port: start.bat --port {args.port + 1}")
        sys.exit(4)
    # Load the server first: if a change Athena made to her own code broke it, say so clearly, and exit with
    # code 3 so start.bat can offer to undo those changes.
    try:
        import athena.server  # noqa: F401
    except Exception as exc:  # SyntaxError, ImportError, NameError…
        traceback.print_exc()
        print(f"\n  Athena couldn't start: {exc.__class__.__name__}: {exc}")
        from . import selfedit

        self_made = bool(selfedit.changed_files())
        if self_made:
            print("  This is probably from a change she made to her own code.")
        if args.desktop:
            _popup(f"Athena couldn't start: {exc.__class__.__name__}: {exc}\n\n"
                   + ("This is probably from a change she made to her own code. Double-click start.bat: it offers to undo "
                      "her changes.\n\n" if self_made else "Double-click start.bat to see more, or run update.bat.\n\n")
                   + f"Details: {LOG}")
        sys.exit(3)

    host = args.host or _default_host()
    os.environ["ATHENA_LISTEN"] = host

    if args.desktop:
        from .desktop import main as desktop_main

        try:
            desktop_main(host, args.port, hidden=args.hidden)
        except Exception as exc:  # never fail silently from the shortcut
            traceback.print_exc()
            _popup(f"Athena couldn't open: {exc.__class__.__name__}: {exc}\n\nDouble-click start.bat instead, or send "
                   f"this message to whoever helps you with Athena.\n\nDetails: {LOG}")
        return

    if args.download_voice:
        from .tts import download

        print("Downloading Athena's natural voice (about 350 MB)...")
        download()
        print("Done.")
        return

    if args.preload_whisper:
        from .speech import preload

        print(f"Downloading Whisper model '{args.preload_whisper}' for offline speech recognition...")
        preload(args.preload_whisper)
        print("Done.")
        return

    url = f"http://localhost:{args.port}"
    print(f"\n  Athena AI is running at {url}")
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    if host == "127.0.0.1":
        print("  Press Ctrl+C to stop.\n")
        uvicorn.run("athena.server:app", host=host, port=args.port, log_level="warning")
        return
    # Phone access: the normal address, plus a secure (https) one so the phone's microphone works.
    import asyncio

    from . import phone
    from .server import app

    secure = phone.https_server(app, host, args.port)
    for phone_url in phone.secure_urls() or phone.lan_urls(args.port):
        print(f"  On your phone (same Wi-Fi): {phone_url}")
    print("  Press Ctrl+C to stop.\n")
    servers = [uvicorn.Server(uvicorn.Config(app, host=host, port=args.port, log_level="warning"))]
    if secure:
        servers.append(secure)

    async def serve_all() -> None:
        await asyncio.gather(*(srv.serve() for srv in servers))

    asyncio.run(serve_all())


def _port_busy(port: int) -> bool:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def _is_athena(url: str) -> bool:
    try:
        import httpx

        return httpx.get(f"{url}/api/status", timeout=3).status_code in (200, 401, 403)
    except Exception:  # noqa: BLE001
        return False


def _default_host() -> str:
    """Only this PC can open Athena, unless phone access is on (and a PIN protects it)."""
    from . import store

    s = store.get_settings()
    return "0.0.0.0" if s.get("phone_access") and s.get("pin_hash") else "127.0.0.1"


if __name__ == "__main__":
    main()
