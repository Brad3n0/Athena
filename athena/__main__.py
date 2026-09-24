"""Start Athena AI:  python -m athena  [--port 8765] [--no-browser]"""
import argparse
import threading
import webbrowser

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="Athena AI — offline assistant powered by Ollama")
    parser.add_argument("--host", default="127.0.0.1", help="Use 0.0.0.0 to allow other devices on your network")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--preload-whisper", metavar="MODEL", help="Download a Whisper model for offline use and exit")
    args = parser.parse_args()

    if args.preload_whisper:
        from .speech import preload

        print(f"Downloading Whisper model '{args.preload_whisper}' for offline speech recognition...")
        preload(args.preload_whisper)
        print("Done.")
        return

    url = f"http://localhost:{args.port}"
    print(f"\n  Athena AI is running at {url}\n  Press Ctrl+C to stop.\n")
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    uvicorn.run("athena.server:app", host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
