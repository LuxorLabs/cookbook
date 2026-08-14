"""
Smoke-verify the AG2 Tenki extension, live and without any LLM key:
  1. `ag2.extensions.tenki` imports (the integration shipped in this ag2 build),
  2. `TenkiEnvironment` + `TenkiResources` construct and `code_environment()`
     builds the CodeAdapter that `SandboxCodeTool` consumes, and
  3. the real factory path works end to end: `env.open()` creates a live Tenki
     sandbox (exactly what `SandboxShellTool` does per call), a second `open()`
     returns the same cached sandbox, put_file/exec/remove_file round-trip, and
     leaving `async with env` tears the sandbox down via `aclose()`.

No agent or model call is made — the tools' sandbox plumbing is the part a
Tenki outage or an API change would break, and it is fully exercised here.

Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
"""

import asyncio
import os
import sys
from pathlib import PurePosixPath

from ag2.extensions.tenki import TenkiEnvironment, TenkiResources  # proves the extension shipped


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
    print("No token. Set TENKI_API_KEY, or run `tenki login`.")
    sys.exit(1)

# `tenki` SDK auth gap: a bare `tenki login` browser session token is sent as a
# Bearer header (rejected); prefix it `cookie:` so it travels as a cookie.
# A `tk_` API key works as-is.
if not token.startswith(("tk_", "ory_st_", "cookie:")):
    token = f"cookie:{token}"


async def main() -> None:
    env = TenkiEnvironment(
        api_key=token,
        workspace_id=os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id") or None,
        name="cookbook-verify",
        resources=TenkiResources(cpu_cores=1, memory_mb=1024),
        timeout=90,
        max_duration=600,
    )
    env.code_environment()  # the CodeAdapter SandboxCodeTool consumes — python runner is python3

    async with env:  # the documented usage: tools share this factory for its whole scope
        async with env.open() as sb:  # what SandboxShellTool does on every call
            r = await sb.exec(["python3", "-c", "print(6 * 7)"])
            assert r.exit_code == 0, f"exit {r.exit_code}: {r.output}"
            assert r.output == "42", f"got {r.output!r}"

            # The factory caches by parameter set: files persist across tool calls.
            path = PurePosixPath("cookbook_probe.txt")
            await sb.put_file(path, b"persisted between tool calls")
            async with env.open() as sb2:
                assert sb2 is sb, "expected the cached sandbox on the second open()"
                r = await sb2.exec(["cat", str(path)])
                assert r.exit_code == 0 and r.output == "persisted between tool calls", r.output
            await sb.remove_file(path)
    # `async with env` exit -> aclose() terminated the sandbox and closed the client.

    print("✓ ag2-tenki: TenkiEnvironment → live sandbox via the real integration → exec 42 → aclose teardown")


try:
    asyncio.run(main())
except Exception as e:  # noqa
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
