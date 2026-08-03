"""
The Tenki port of a typical Modal sandbox script: create -> run a command ->
capture output -> dispose. The core loop, with the official `tenki-sandbox` SDK.

Modal, for reference:
    import modal
    app = modal.App.lookup("my-app", create_if_missing=True)  # auth via ~/.modal.toml
    sb = modal.Sandbox.create(app=app)                        # boots a container
    p = sb.exec("python", "-c", "print(6 * 7)")               # a *live* process
    print(p.stdout.read().strip(), "· exit", p.wait())        # 42 · exit 0
    sb.terminate()

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


# Modal reads ~/.modal.toml (or MODAL_TOKEN_ID / MODAL_TOKEN_SECRET) implicitly.
# Tenki takes an explicit auth_token. A `tenki login` *session* token must go over
# as a cookie, so prefix it `cookie:`; a `tk_` API key works as-is. (Python-SDK
# auth gap; the Node SDK auto-detects the session token.)
token = os.environ.get("TENKI_AUTH_TOKEN") or cfg("auth_token")
if token and not token.startswith(("tk_", "ory_st_", "cookie:")):
    token = f"cookie:{token}"

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

# Modal: `Sandbox.create(app=app)` — everything hangs off an App. Tenki: no App
# object — a sandbox is placed by workspace_id. `create(...)` boots
# the microVM and waits until it's RUNNING (~2s); the `with` block disposes it.
with Sandbox.create(**opts) as sandbox:
    # Modal's exec() returns a *live* process — you drain `p.stdout.read()` and call
    # `p.wait()` for the exit code. Tenki's exec() blocks until the command finishes
    # and returns a `CommandResult` with `.stdout_text` / `.exit_code` already set.
    result = sandbox.exec("python3", "-c", "print(6 * 7)")
    print(result.stdout_text.strip(), "· exit", result.exit_code)  # 42 · exit 0
