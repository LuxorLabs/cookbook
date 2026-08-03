"""
Proves the Tenki-facing surface DeerFlow's community sandbox provider
(`deerflow.community.tenki:TenkiSandboxProvider`) is built on, without
installing DeerFlow: create with wait=False + wait_ready() (the warm-pool
boot path), `sh -lc` command execution, native `sandbox.fs` streaming file
transport, busybox-portable find/grep, and terminate.

Needs Python 3.10+ and `tenki-sandbox` (requirements.txt). Token/workspace
from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
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
    except Exception:
        pass
    return ""


token = os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or cfg("auth_token")
if not token:
    print("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.")
    sys.exit(1)
# A `tk_` API key works as-is; a `tenki login` browser session token must go
# over as a cookie — the SDK does that when the token is prefixed `cookie:`.
if not token.startswith(("tk_", "ory_st_", "cookie:")):
    token = f"cookie:{token}"

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024, "wait": False}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

sb = None
try:
    # 1) boot the way the provider does: create(wait=False) then wait_ready()
    sb = Sandbox.create(**opts)
    sb.wait_ready()

    # 2) commands go through `sh -lc`, so shell semantics hold
    r = sb.exec("sh", "-lc", 'echo "deer $(python3 -c \'print(6*7)\')"')
    out = r.stdout_text.strip()
    if not (r.ok and out == "deer 42"):
        raise AssertionError(f"exec: ok={r.ok}, stdout={out!r}, stderr={r.stderr_text!r}")

    # 3) files ride the native fs API (streaming transport, no shell quoting)
    sb.fs.mkdir("/home/tenki/reports")
    sb.fs.write_stream("/home/tenki/reports/note.md", iter([b"# from deerflow\n"]))
    if sb.fs.read_text("/home/tenki/reports/note.md") != "# from deerflow\n":
        raise AssertionError("fs round-trip mismatch")
    if sb.fs.stat("/home/tenki/reports/note.md").size == 0:
        raise AssertionError("fs.stat reports empty file")

    # 4) glob/grep delegate to busybox-portable find/grep
    r = sb.exec("sh", "-lc", "find /home/tenki/reports -name '*.md' | xargs grep -l deerflow")
    if "note.md" not in r.stdout_text:
        raise AssertionError(f"find/grep: {r.stdout_text!r}")

    print("✓ deerflow-tenki: create+wait_ready → sh -lc (deer 42) → fs streaming round-trip → find/grep → terminate")
except Exception as e:  # noqa: BLE001
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
finally:
    if sb is not None:
        try:
            sb.terminate()
        except Exception:  # noqa: BLE001
            pass  # self-reaps via idle/lifetime caps
