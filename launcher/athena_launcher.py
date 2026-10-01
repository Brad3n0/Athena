"""Athena.exe: double-click to open Athena. No command windows.

Built from this file by Athena herself (Settings → Desktop app, or make-athena-exe.bat) with PyInstaller. It lives in
the Athena folder and just starts Athena's desktop app from there; the first time, it runs the normal setup.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(sys.executable if getattr(sys, "frozen", False) else __file__).resolve().parent
if not (HERE / "athena").is_dir() and (HERE.parent / "athena").is_dir():
    HERE = HERE.parent  # run from launcher/ while testing
NO_WINDOW = 0x08000000
DETACHED = 0x00000008


def main() -> None:
    venv = HERE / ".venv" / "Scripts"
    if not (HERE / ".venv" / "athena-ready").exists() or not (venv / "pythonw.exe").exists():
        # First time: the normal setup (shows its progress), which then opens Athena
        subprocess.Popen(["cmd", "/c", "start", "Athena AI setup", "cmd", "/c", str(HERE / "start.bat")], cwd=HERE)
        return
    # Pick up new requirements after an update (instant when nothing changed), then open the desktop app
    subprocess.run([str(venv / "python.exe"), "-m", "pip", "install", "-q", "-r", str(HERE / "requirements.txt")],
                   cwd=HERE, creationflags=NO_WINDOW, capture_output=True)
    subprocess.Popen([str(venv / "pythonw.exe"), "-m", "athena", "--desktop"], cwd=HERE,
                     creationflags=NO_WINDOW | DETACHED)


if __name__ == "__main__":
    main()
