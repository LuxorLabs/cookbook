"""
Serve a marimo notebook from a Luxor sandbox on a public preview URL, behind
marimo's own access token. Press Enter to copy your edits back and terminate.

Needs Python 3.10+ and requirements.txt. API key from LUXORAI_AUTH_TOKEN /
LUXORAI_API_KEY or ~/.config/luxor/config.yaml (`luxor login --api-key`).
Run: .venv/bin/python run.py
"""
import os
import secrets

from tenki import Sandbox

MARIMO = "marimo==0.25.2"
PORT = 2718
NOTEBOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "notebook.py")


def cfg(key):
    try:
        with open(next((p for p in (os.path.expanduser(f"~/.config/{d}/config.yaml") for d in ("luxor", "tenki")) if os.path.exists(p)), "")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
    except FileNotFoundError:
        pass
    return ""


def sandbox_opts():
    opts = {
        "auth_token": os.environ.get("LUXORAI_AUTH_TOKEN") or os.environ.get("LUXORAI_API_KEY") or os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or cfg("auth_token"),
        "cpu_cores": 2,
        "memory_mb": 2048,
        "max_duration": 2 * 60 * 60,  # seconds; a killed script can't leave it running past this
    }
    workspace_id = os.environ.get("LUXORAI_WORKSPACE_ID") or os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
    if workspace_id:
        opts["workspace_id"] = workspace_id
    return opts


def serve_marimo(sb, token):
    """Install marimo, upload notebook.py, start `marimo edit`, return the preview URL."""
    sb.shell(f"pip install -q {MARIMO}", check=True)
    sb.fs.upload(NOTEBOOK, "notebook.py")
    # The preview URL is public, so marimo's token is the only lock on the door.
    sb.shell(
        f'setsid marimo edit notebook.py --headless --host 0.0.0.0 --port {PORT} '
        f'--token-password "$MARIMO_TOKEN" >/tmp/marimo.log 2>&1 </dev/null &',
        env={"MARIMO_TOKEN": token},
        check=True,
    )
    return sb.expose_port(PORT).url.rstrip("/")


if __name__ == "__main__":
    token = secrets.token_urlsafe(24)
    with Sandbox.create(**sandbox_opts()) as sb:
        url = serve_marimo(sb, token)
        print(f"open: {url}/?access_token={token}")
        input("Press Enter to copy notebook.py back and stop the sandbox... ")
        sb.fs.download("notebook.py", NOTEBOOK)
