"""
Proves the Tenki-facing half of this example: the LlamaIndex tool executes Python
in a live Tenki sandbox. No LLM needed — we call the FunctionTool directly and
assert its output. (The full agent, which needs a model key, is in agent.py.)

Needs Python 3.10+ and the deps in requirements.txt. API key/workspace from env (CI)
or ~/.config/tenki/config.yaml (local `tenki login --api-key`).
"""
import os
import sys

from tenki import Sandbox

from tenki_tool import make_code_tool


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
    print("No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.")
    sys.exit(1)

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
workspace = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace:
    opts["workspace_id"] = workspace

try:
    with Sandbox.create(**opts) as sb:
        run_python = make_code_tool(sb)
        # Drive the LlamaIndex FunctionTool exactly as an agent would.
        out = run_python.call(code="print(sum(range(11)))")
        if str(out).strip() != "55":
            raise AssertionError(f"tool returned {out!r}")
    print("✓ llamaindex: LlamaIndex FunctionTool executed Python in a Tenki sandbox → 55")
except Exception as e:  # noqa
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
