# AG2 agents with a Tenki sandbox

[AG2](https://github.com/ag2ai/ag2) 1.0 is a ground-up rewrite of the framework (`from ag2 import Agent` — not the old AutoGen 0.x `ConversableAgent` API) with first-class sandbox tools: `SandboxShellTool` and `SandboxCodeTool` run whatever the model writes inside a pluggable sandbox backend. This example uses AG2's **native Tenki backend** — `ag2.extensions.tenki` (merged in [ag2ai/ag2#3096](https://github.com/ag2ai/ag2/pull/3096), maintained with Tenki) — so every shell command and code snippet executes in an isolated [Tenki](https://tenki.cloud) microVM instead of on your machine.

## The agent

One `TenkiEnvironment` powers both tools:

```python
import asyncio

from ag2 import Agent
from ag2.config import AnthropicConfig
from ag2.extensions.tenki import TenkiEnvironment
from ag2.tools import SandboxCodeTool, SandboxShellTool

async def main() -> None:
    env = TenkiEnvironment()
    async with env:
        agent = Agent(
            "developer",
            config=AnthropicConfig(model="claude-sonnet-4-6"),
            tools=[SandboxShellTool(env), SandboxCodeTool(env.code_environment())],
        )
        reply = await agent.ask("Write hello.txt, then read it with Python.")
        print(await reply.content())

if __name__ == "__main__":
    asyncio.run(main())
```

(Running this agent needs an LLM key — `verify.py` below doesn't.)

`env.code_environment()` matters: Tenki's default image ships `python3` (not `python`), and the returned `CodeAdapter` maps the `python` runner accordingly. Pass the env itself to `SandboxShellTool`, the adapter to `SandboxCodeTool`.

## Setup (Python 3.10+)

```bash
uv venv                                 # or: python3.11 -m venv .venv
uv pip install -r requirements.txt      # ag2 (git pin, see note) + tenki SDK
export TENKI_API_KEY=tk_...             # from the Tenki dashboard
```

> **Release note (2026-08):** the Tenki extension merged into ag2 `main` on 2026-08-13, after the latest PyPI release (1.0.1, 2026-07-29) — so `requirements.txt` pins the merge commit via git. Once the next ag2 release ships `ag2/extensions/tenki`, this becomes simply:
>
> ```bash
> pip install "ag2[anthropic]" "tenki>=0.5.4,<1"
> ```

## Configuring `TenkiEnvironment`

```python
from ag2.extensions.tenki import TenkiEnvironment, TenkiResources

env = TenkiEnvironment(
    workspace_id="your-workspace-id",   # auto-detected when the key sees one workspace
    name="my-agent-sandbox",
    image="workspace/image:tag",
    env_vars={"APP_ENV": "sandbox"},
    resources=TenkiResources(cpu_cores=2, memory_mb=4096, disk_size_gb=5),
    timeout=60,
    max_duration=900,
)
```

| Parameter | Default | Purpose |
| --- | --- | --- |
| `api_key` | `TENKI_API_KEY` | API authentication |
| `api_url` | `TENKI_API_URL` or production | API endpoint |
| `workspace_id` | Auto-detected when unique | Tenki workspace scope |
| `name` | `ag2` | Sandbox name in the Tenki dashboard |
| `image` | Tenki default image | Registry image reference |
| `env_vars` | `{}` | Environment variables baked into the sandbox |
| `resources` | Tenki defaults | CPU / memory / disk overrides |
| `timeout` | `60` s | Sandbox startup + per-command timeout |
| `max_duration` | `900` s | Server-enforced sandbox lifetime backstop |
| `workdir` | `/home/tenki` | Working directory for commands and files |

## What the backend does

- **One environment, both tools.** The same `TenkiEnvironment` serves `SandboxShellTool` directly and `SandboxCodeTool` via `code_environment()` — one sandbox, one cleanup path.
- **Files persist across tool calls.** The factory caches sandboxes by their resolved parameters, so a file the agent writes in tool call 1 is still there in tool call 10. The sandbox lives until `aclose()` (the `async with env` exit), not per call.
- **Cleanup has three layers.** Creation is failure-atomic (a sandbox that never becomes ready is terminated immediately), an `atexit` hook catches interpreter shutdown if `aclose()` never ran, and `max_duration` reclaims the VM server-side even if the client process dies. Sandboxes are created with inbound networking off, outbound on.

## Verify

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

`verify.py` drives the real integration classes against live Tenki; no LLM key needed. It imports `ag2.extensions.tenki`, constructs `TenkiEnvironment` + `TenkiResources`, builds the `CodeAdapter`, then does what `SandboxShellTool` does per call — `env.open()` → live sandbox → `exec` (`42`) — plus a file round-trip across two `open()` calls to prove the caching, and asserts teardown on scope exit. The agent loop on top is covered by ag2's own CI.

## Notes

- The extension uses Tenki's **new [`tenki`](https://pypi.org/project/tenki/) Python SDK** (`tenki>=0.5.4,<1`) — the canonical successor namespace to the older `tenki-sandbox` package some earlier cookbook examples use. Don't install `tenki-sandbox` for this one.
- Auth: a `tk_` API key works as-is. A `tenki login` browser session token must be prefixed `cookie:` for the Python SDK (`verify.py` handles this).
- All credential/selection parameters also accept AG2 `Variable`s for per-request (multi-tenant) resolution — see the [AG2 Tenki docs](https://github.com/ag2ai/ag2/blob/main/website/docs/user-guide/extensions/tenki.mdx).
