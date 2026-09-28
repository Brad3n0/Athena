"""GitHub: Athena creates repositories and uploads projects to your account, like a developer would.

It uses the GitHub sign-in Git already keeps on this PC (the one update.bat asked for), through Git's own
credential helper. Nothing is stored by Athena itself. Connect once in Settings → Integrations → GitHub.
"""
from __future__ import annotations

import os
import re
import subprocess
from typing import Any

import httpx

API = "https://api.github.com"


class GitHubError(Exception):
    pass


def _credential(interactive: bool = False) -> tuple[str, str] | None:
    """(username, token) from Git's credential helper, or None if not signed in."""
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    if not interactive:
        env["GCM_INTERACTIVE"] = "never"  # never pop up a sign-in window by surprise
    try:
        r = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n", capture_output=True,
                           text=True, timeout=300 if interactive else 20, env=env,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    fields = dict(line.split("=", 1) for line in r.stdout.splitlines() if "=" in line)
    token = fields.get("password", "")
    return (fields.get("username", ""), token) if token else None


def _approve(user: str, token: str) -> None:
    """Tell the credential helper the sign-in worked, so it's kept for next time."""
    try:
        subprocess.run(["git", "credential", "approve"], input=f"protocol=https\nhost=github.com\nusername={user}\npassword={token}\n\n",
                       capture_output=True, text=True, timeout=20, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired):
        pass


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}


def account(interactive: bool = False) -> dict[str, Any] | None:
    """Who's signed in: {login, name, token}, or None."""
    cred = _credential(interactive)
    if not cred:
        return None
    try:
        r = httpx.get(f"{API}/user", headers=_headers(cred[1]), timeout=15)
    except httpx.HTTPError as exc:
        raise GitHubError(f"Couldn't reach GitHub ({exc.__class__.__name__}). Check your internet connection.") from exc
    if r.status_code != 200:
        return None
    if interactive:
        _approve(cred[0], cred[1])
    data = r.json()
    return {"login": data.get("login"), "name": data.get("name") or data.get("login"), "id": data.get("id"), "token": cred[1]}


def status() -> dict[str, Any]:
    try:
        git = subprocess.run(["git", "--version"], capture_output=True, text=True, timeout=10,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).returncode == 0
    except OSError:
        git = False
    if not git:
        return {"connected": False, "message": "Git isn't installed yet. Run update.bat once (it installs Git), then connect."}
    try:
        acc = account()
    except GitHubError as exc:
        return {"connected": False, "message": str(exc)}
    if not acc:
        return {"connected": False, "message": "Not connected. Click Connect GitHub and sign in once in the window that opens."}
    return {"connected": True, "login": acc["login"], "message": f"Connected as @{acc['login']}"}


def connect() -> dict[str, Any]:
    """Opens GitHub's sign-in (in the browser) through Git, once."""
    acc = account(interactive=True)
    if not acc:
        raise GitHubError("GitHub sign-in didn't finish. Try again, and sign in in the window that opens.")
    return {"connected": True, "login": acc["login"], "message": f"Connected as @{acc['login']}"}


def slug(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", (name or "").strip()).strip("-.")
    return s[:90] or "athena-project"


def create_repo(name: str, private: bool = True, description: str = "") -> dict[str, Any]:
    """Make a new repository on the signed-in account (or reuse one with that name). Returns its addresses."""
    acc = account()
    if not acc:
        raise GitHubError("GitHub isn't connected yet. Open Settings → Integrations → GitHub and click Connect GitHub (one sign-in).")
    repo = slug(name)
    body = {"name": repo, "private": bool(private), "description": (description or "Made with Athena AI")[:300], "auto_init": False}
    r = httpx.post(f"{API}/user/repos", headers=_headers(acc["token"]), json=body, timeout=20)
    if r.status_code == 201:
        d = r.json()
        return {"html_url": d["html_url"], "clone_url": d["clone_url"], "full_name": d["full_name"], "created": True, "private": d.get("private")}
    if r.status_code == 422:  # already exists: use it
        g = httpx.get(f"{API}/repos/{acc['login']}/{repo}", headers=_headers(acc["token"]), timeout=15)
        if g.status_code == 200:
            d = g.json()
            return {"html_url": d["html_url"], "clone_url": d["clone_url"], "full_name": d["full_name"], "created": False, "private": d.get("private")}
    if r.status_code in (401, 403):
        raise GitHubError("GitHub didn't allow creating a repository with this sign-in. Click Connect GitHub again in Settings → Integrations.")
    raise GitHubError(f"GitHub said: {(r.json().get('message') if r.headers.get('content-type', '').startswith('application/json') else r.text)[:200]}")
