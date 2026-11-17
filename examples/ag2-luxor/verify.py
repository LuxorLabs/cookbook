"""
Smoke-verify the AG2 Luxor Agent Cloud extension, live and without any LLM key:
  1. `ag2.extensions.tenki` imports (the integration shipped in this ag2 build),
  2. `TenkiEnvironment` + `TenkiResources` construct and `code_environment()`
     builds the CodeAdapter that `SandboxCodeTool` consumes, and
  3. the real factory path works end to end: `env.open()` creates a live Luxor Agent Cloud
     sandbox (exactly what `SandboxShellTool` does per call), a second `open()`
     returns the same cached sandbox, put_file/exec/remove_file round-trip, and
     leaving `async with env` tears the sandbox down via `aclose()`.

No agent or model call is made — the tools' sandbox plumbing is the part a
Luxor Agent Cloud outage or an API change would break, and it is fully exercised here.

Token/workspace from env (CI) or ~/.config/luxor/config.yaml (local `luxor login`).
"""

import asyncio
import os
import sys
from pathlib import PurePosixPath

from ag2.extensions.tenki import TenkiEnvironment, TenkiResources  # proves the extension shipped


def cfg(key):
    try:
        with open(next((p for p in (os.path.expanduser(f"~/.config/{d}/config.yaml") for d in ("luxor", "tenki")) if os.path.exists(p)), "")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return ""


token = os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or cfg("auth_token")
if not token:
    print("No token. Set TENKI_API_KEY, or run `luxor login`.")
    sys.exit(1)

if not token.startswith("tk_"):
    print(
        "Token must be a tk_ API key (tenki SDK 1.x accepts only tk_ keys). "
        "Set TENKI_API_KEY or run `luxor login --api-key <key>`."
    )
    sys.exit(1)


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

    print("✓ ag2-luxor: TenkiEnvironment → live sandbox via the real integration → exec 42 → aclose teardown")


try:
    asyncio.run(main())
except Exception as e:  # noqa
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
