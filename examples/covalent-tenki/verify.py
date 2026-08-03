"""
Smoke-verify the Covalent example, fast:
  1. the official `covalent-tenki-plugin` imports and its `TenkiExecutor`
     constructs (so the walkthrough is actually usable), and
  2. the live Tenki sandbox path the executor runs on is healthy — create a
     sandbox with the same `tenki-sandbox` SDK, run a task-style command, assert,
     terminate.

We deliberately do NOT dispatch a full Covalent workflow: that needs a running
dispatcher and a ~2-3 min per-task VM bootstrap (see README), and the executor's
internals have their own CI in TenkiCloud/covalent-tenki-plugin. This checks the
two things that actually break a walkthrough: the plugin installing, and Tenki
being reachable.

Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
"""
import os
import sys

from tenki_sandbox import Sandbox
from covalent_tenki_plugin import TenkiExecutor  # proves the plugin installed + imports


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

# Python SDK auth gap: a bare `tenki login` session token is sent as Bearer (rejected);
# prefix it `cookie:` so it goes as a cookie. A `tk_` API key works as-is.
if not token.startswith(("tk_", "ory_st_", "cookie:")):
    token = f"cookie:{token}"

# Construct the executor — proves the plugin's config surface is intact.
TenkiExecutor(cpu_cores=1, memory_mb=1024)

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

try:
    with Sandbox.create(**opts) as sb:
        r = sb.exec("python3", "-c", "print(6 * 7)")
        if r.stdout_text.strip() != "42":
            raise AssertionError(f"got {r.stdout_text!r}")
    print("✓ covalent-tenki: TenkiExecutor imports + a task-style command ran in a live Tenki sandbox → 42")
except Exception as e:  # noqa
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
