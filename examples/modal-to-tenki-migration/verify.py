"""
Proves the Tenki side of the Modal->Tenki migration end to end: create -> exec a
bare binary -> exec a shell one-liner -> a file round-trip -> dispose. Asserts each
result and exits non-zero on any failure. No LLM needed — this is the whole example,
asserted.

Needs Python 3.10+ and the dep in requirements.txt. Token/workspace from env (CI) or
~/.config/tenki/config.yaml (local `tenki login`).
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

# Python SDK auth gap: a bare `tenki login` session token must be sent as a cookie
# (prefix `cookie:`); a `tk_` API key works as-is. (The Node SDK auto-detects.)
if not token.startswith(("tk_", "ory_st_", "cookie:")):
    token = f"cookie:{token}"

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

try:
    # Modal: Sandbox.create(app=app) + terminate(). Tenki: no App object; the `with`
    # block disposes the microVM at scope end.
    with Sandbox.create(**opts) as sb:
        if not sb.id:
            raise AssertionError("no sandbox id returned from create()")

        # Modal's exec() returns a live process (drain p.stdout.read(), p.wait()).
        # Tenki's exec() blocks and returns a finished CommandResult.
        r = sb.exec("python3", "-c", "print(6 * 7)")
        if not (r.exit_code == 0 and r.stdout_text.strip() == "42"):
            raise AssertionError(f"python3 exec: exit {r.exit_code}, stdout {r.stdout_text!r}")

        # Both run a bare binary + args (no shell). For shell syntax, ask for a shell
        # explicitly on either platform — same as Modal.
        sh = sb.exec("sh", "-c", "echo hello-from-tenki")
        if not (sh.exit_code == 0 and sh.stdout_text.strip() == "hello-from-tenki"):
            raise AssertionError(f"sh exec: exit {sh.exit_code}, stdout {sh.stdout_text!r}")

        # File round-trip. Modal: `with sb.open(path, "w") as f: f.write(...)`.
        # Tenki: `sb.fs.write_text(path, ...)` / `sb.fs.read_text(path)`. Tenki
        # confines file I/O to /home/tenki, so use a relative path.
        sb.fs.write_text("migrate.txt", "modal->tenki")
        back = sb.fs.read_text("migrate.txt")
        if back != "modal->tenki":
            raise AssertionError(f"fs round-trip: read back {back!r}")

    print(
        f"✓ modal-to-tenki-migration: create ({sb.id[:8]}…) → "
        f"exec python3 + sh + fs round-trip → 42 → dispose"
    )
except Exception as e:  # noqa: BLE001
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
