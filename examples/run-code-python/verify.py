"""
Proves this example works against live Tenki: boot a sandbox, exec python3,
assert "42", dispose. No LLM needed — this is the whole example, asserted.

Needs Python 3.10+ and the dep in requirements.txt. Token/workspace from env (CI)
or ~/.config/tenki/config.yaml (local `tenki login`). Exits non-zero on failure.
"""
import os
import sys

from tenki_sandbox import Sandbox


def cfg(key):
    try:
        with open(os.path.expanduser("~/.config/tenki/config.yaml")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
    except FileNotFoundError:
        pass
    return ""


token = os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or cfg("auth_token")
if not token:
    print("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.")
    sys.exit(1)

# Python SDK auth gap: a bare `tenki login` session token must be sent as a
# cookie (prefix `cookie:`); a `tk_` API key works as-is. (Node SDK auto-detects.)
if not token.startswith(("tk_", "ory_st_", "cookie:")):
    token = f"cookie:{token}"

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

try:
    # create -> exec -> assert -> dispose (the `with` block terminates the VM).
    with Sandbox.create(**opts) as sb:
        r = sb.exec("python3", "-c", "print(6 * 7)")
        if not (r.exit_code == 0 and r.stdout_text.strip() == "42"):
            raise AssertionError(
                f"unexpected result: exit {r.exit_code}, stdout {r.stdout_text!r}, stderr {r.stderr_text!r}"
            )
    print("✓ run-code-python: create → exec python3 → 42 → dispose")
except Exception as e:  # noqa: BLE001
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
