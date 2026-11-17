"""
Run code in a disposable Luxor sandbox: boot -> exec -> print -> dispose.
The core Luxor Agent Cloud loop, with the official `tenki` Python SDK.

Needs Python 3.10+ and `pip install tenki`. API key/workspace from env
(LUXORAI_API_KEY / LUXORAI_WORKSPACE_ID) or, if unset,
~/.config/luxor/config.yaml (written by `luxor login --api-key`). Run: python run.py
"""
import os

from tenki import Sandbox


def cfg(key):
    """Read a key from ~/.config/luxor/config.yaml (written by `luxor login --api-key`)."""
    try:
        with open(next((p for p in (os.path.expanduser(f"~/.config/{d}/config.yaml") for d in ("luxor", "tenki")) if os.path.exists(p)), "")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
    except FileNotFoundError:
        pass
    return ""


# A tk_ API key — the only credential the SDK accepts — from env (CI) or the
# CLI's config file (local).
token = os.environ.get("LUXORAI_AUTH_TOKEN") or os.environ.get("LUXORAI_API_KEY") or os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or cfg("auth_token")

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
workspace_id = os.environ.get("LUXORAI_WORKSPACE_ID") or os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

# `Sandbox.create(...)` boots a sandbox and waits until it's RUNNING.
# The `with` block disposes it (terminates the VM) when the scope ends.
with Sandbox.create(**opts) as sandbox:
    # exec(command, *args) runs a bare binary + its args — no shell splitting,
    # so model-generated, multi-line code goes across as one `-c` argument.
    result = sandbox.exec("python3", "-c", "print(6 * 7)")
    print(f"exit {result.exit_code} -> {result.stdout_text.strip()}")  # exit 0 -> 42
