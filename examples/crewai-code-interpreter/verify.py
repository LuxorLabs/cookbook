"""
Proves the sandbox-facing half of this example: the CrewAI tool executes Python in
a live Luxor sandbox. No LLM needed — we call the tool directly and assert its
output. (The full crew, which needs a model key, is in agent.py.)

Needs Python 3.10+ and the deps in requirements.txt. API key/workspace from env (CI)
or ~/.config/luxor/config.yaml (local `luxor login --api-key`).
"""
import os
import sys

from tenki import Sandbox
from luxor_tool import LuxorCodeInterpreter


def cfg(key):
    try:
        with open(next((p for p in (os.path.expanduser(f"~/.config/{d}/config.yaml") for d in ("luxor", "tenki")) if os.path.exists(p)), "")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return ""


token = os.environ.get("LUXORAI_AUTH_TOKEN") or os.environ.get("LUXORAI_API_KEY") or os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or cfg("auth_token")
if not token:
    print("No API key. Set LUXORAI_API_KEY, or run `luxor login --api-key <key>`.")
    sys.exit(1)

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
workspace_id = os.environ.get("LUXORAI_WORKSPACE_ID") or os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

try:
    with Sandbox.create(**opts) as sb:
        tool = LuxorCodeInterpreter(sandbox=sb)
        # Drive the CrewAI tool exactly as an agent would.
        out = tool._run(code="print(sum(range(11)))")
        if str(out).strip() != "55":
            raise AssertionError(f"tool returned {out!r}")
    print("✓ crewai-code-interpreter: CrewAI tool executed Python in a Luxor sandbox → 55")
except Exception as e:  # noqa
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
