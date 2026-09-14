"""
Smoke-verify the Open WebUI example against the REAL distributable:
  1. download the pinned v0.1.0 Tool asset from the GitHub release,
  2. load it standalone with only `tenki` + `pydantic` installed — proves the
     paste-into-Open-WebUI file has no hidden dependencies,
  3. assert the safe Valve defaults and per-user key precedence (offline),
  4. live: run `tools.execute_code("print(6 * 7)")` in a real Tenki microVM.

Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
"""
import asyncio
import importlib.util
import os
import sys
import urllib.request

ASSET = (
    "https://github.com/LuxorLabs/tenki-open-webui/releases/download/"
    "v0.1.0/tenki_code_execution.py"
)
PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_release_tool.py")


def cfg(key):
    try:
        with open(os.path.expanduser("~/.config/tenki/config.yaml")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return ""


try:
    urllib.request.urlretrieve(ASSET, PATH)  # the exact file users paste in
    spec = importlib.util.spec_from_file_location("tenki_owui_tool", PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod  # dataclasses resolve annotations via sys.modules
    spec.loader.exec_module(mod)  # imports with ONLY tenki + pydantic installed

    tools = mod.Tools()
    assert tools.valves.network_egress is False, "egress must default OFF"
    assert tools.valves.timeout_seconds == 300
    # A user's own key (UserValves) must beat the admin key — offline check.
    tools.valves.tenki_api_key = "admin-key"
    user = {"valves": mod.Tools.UserValves(tenki_api_key="user-key")}
    assert mod.resolve_effective_key(tools.valves, user) == "user-key"

    token = os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or cfg("auth_token")
    if not token:
        print("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.")
        sys.exit(1)
    # A `tk_` API key works as-is. A bare `tenki login` browser session token
    # would be sent as Bearer and rejected — prefix it `cookie:` (SDK auth gap,
    # same workaround as examples/langchain-python).
    if not token.startswith(("tk_", "ory_st_", "cookie:")):
        token = f"cookie:{token}"
    tools.valves.tenki_api_key = token
    ws = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
    if ws:
        tools.valves.tenki_workspace_id = ws

    events = []

    async def emitter(event):  # stand-in for Open WebUI's __event_emitter__
        events.append(event)

    out = asyncio.run(tools.execute_code("print(6 * 7)", __event_emitter__=emitter))
    assert "exit=0" in out and "42" in out, f"unexpected tool output: {out!r}"
    assert any(e.get("type") == "status" for e in events), "no status events emitted"
    print("✓ open-webui-tenki: release asset loads standalone → valves ok → live execute_code → 42 → teardown")
except Exception as e:  # noqa
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
