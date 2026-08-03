"""
Proves the Tenki-facing half of this example: the LangChain tool executes Python
in a live Tenki sandbox. No LLM needed — we call the tool directly and assert its
output. (The full agent, which needs a model key, is in agent.py.)

Needs Python 3.10+ and the deps in requirements.txt. Token/workspace from env (CI)
or ~/.config/tenki/config.yaml (local `tenki login`).
"""
import os
import sys

from tenki_sandbox import Sandbox

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
    print("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.")
    sys.exit(1)

# The Python SDK (unlike the Node SDK) doesn't auto-handle a bare browser session
# token — it sends anything without a known prefix as `Authorization: Bearer`,
# which the server rejects. A `tk_` API key works as-is; a `tenki login` session
# token must be sent as a cookie, which the SDK does when you prefix it `cookie:`.
# (SDK auth gap — see the pip-tenki / Python-SDK-auth issue.)
if not token.startswith(("tk_", "ory_st_", "cookie:")):
    token = f"cookie:{token}"

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

try:
    with Sandbox.create(**opts) as sb:
        run_python = make_code_tool(sb)
        # Drive the LangChain tool exactly as an agent would.
        out = run_python.invoke({"code": "print(sum(range(11)))"})
        if str(out).strip() != "55":
            raise AssertionError(f"tool returned {out!r}")
    print("✓ langchain-python: LangChain tool executed Python in a Tenki sandbox → 55")
except Exception as e:  # noqa
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
