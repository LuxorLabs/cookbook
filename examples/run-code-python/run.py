"""
Run code in a disposable Tenki sandbox: boot -> exec -> print -> dispose.
The core Tenki loop, with the official `tenki-sandbox` Python SDK.

Needs Python 3.10+ and `pip install tenki-sandbox`. Token/workspace from env
(TENKI_AUTH_TOKEN / TENKI_WORKSPACE_ID) or, if unset,
~/.config/tenki/config.yaml (written by `tenki login`). Run: python run.py
"""
import os

from tenki_sandbox import Sandbox


def cfg(key):
    """Read a key from ~/.config/tenki/config.yaml (written by `tenki login`)."""
    try:
        with open(os.path.expanduser("~/.config/tenki/config.yaml")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
    except FileNotFoundError:
        pass
    return ""


# Token from env (CI) or `tenki login` config (local). The Python SDK sends an
# unknown-prefix token as a Bearer header, which the server rejects — a browser
# session token from `tenki login` must go over as a cookie, so prefix it
# `cookie:`. A `tk_` API key works as-is. (Python-SDK auth gap; the Node SDK
# auto-detects the session token.)
token = os.environ.get("TENKI_AUTH_TOKEN") or cfg("auth_token")
if token and not token.startswith(("tk_", "ory_st_", "cookie:")):
    token = f"cookie:{token}"

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

# `Sandbox.create(...)` boots a microVM and waits until it's RUNNING (~2s).
# The `with` block disposes it (terminates the VM) when the scope ends.
with Sandbox.create(**opts) as sandbox:
    # exec(command, *args) runs a bare binary + its args — no shell splitting,
    # so model-generated, multi-line code goes across as one `-c` argument.
    result = sandbox.exec("python3", "-c", "print(6 * 7)")
    print(f"exit {result.exit_code} -> {result.stdout_text.strip()}")  # exit 0 -> 42
