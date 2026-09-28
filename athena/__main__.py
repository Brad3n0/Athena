"""Start Athena AI:  python -m athena  [--port 8765] [--no-browser]"""
import argparse
import os
import threading
import webbrowser

import uvicorn


def main() -> None:
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

    host = args.host or _default_host()
    os.environ["ATHENA_LISTEN"] = host

    if args.desktop:
        from .desktop import main as desktop_main

        desktop_main(host, args.port, hidden=args.hidden)
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


def _default_host() -> str:
    """Only this PC can open Athena, unless phone access is on (and a PIN protects it)."""
    from . import store

    s = store.get_settings()
    return "0.0.0.0" if s.get("phone_access") and s.get("pin_hash") else "127.0.0.1"


if __name__ == "__main__":
    main()
