# AG2

Let an AG2 agent run shell commands and code on a Tenki cloud machine instead of your computer.

[AG2](https://github.com/ag2ai/ag2) (formerly AutoGen) is an open-source Python framework for building AI agents. It has two built-in tools for running things: `SandboxShellTool` runs shell commands, and `SandboxCodeTool` runs code. Both run inside an **environment** you choose, and AG2 includes a Tenki one, `TenkiEnvironment` in `ag2.extensions.tenki`.

One `TenkiEnvironment` is one Tenki sandbox. Give it to both tools and they share it, so a file one tool writes is there for the other. The sandbox is deleted when the environment closes.

This is for AG2 1.x (`from ag2 import Agent`). The older `import autogen` API is now [AG2 Classic](https://github.com/ag2ai/ag2-classic) and doesn't include the Tenki environment.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "AG2" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/ag2-tenki, create a .venv there on Python 3.10 or later, and install requirements.txt.
2. It needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) in the environment. If it isn't set, stop and ask me to export it. Never print the key or write it to a file.
3. Run node verify.mjs and confirm the ✓ line.
4. If I want to run an agent: install "ag2[anthropic]>=1.1.2", check that ANTHROPIC_API_KEY is set (ask me if not), save the agent.py from the README, and run it.
5. If a step fails, use the Troubleshooting table in the example's README.md.
Then show me how to give my own AG2 agent SandboxShellTool and SandboxCodeTool backed by one TenkiEnvironment.
```

## Quick start

You need:

- Python 3.10 or later. [uv](https://docs.astral.sh/uv/) is optional.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An Anthropic API key, for the agent run only.

### 1. Install

Create the venv in the example directory as `.venv`; `verify.mjs` looks for it there.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/ag2-tenki
uv venv
uv pip install -r requirements.txt   # ag2>=1.1.2, tenki>=1.4.1
```

Without uv: `python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt`. `ag2` 1.1.2 is the first release whose Tenki extension uses the 1.x `tenki` SDK. AG2 doesn't install `tenki` for you.

### 2. Set your API key

```bash
export TENKI_API_KEY=tk_...
```

`TenkiEnvironment()` reads `TENKI_AUTH_TOKEN` or `TENKI_API_KEY` from the environment. `verify.py` also accepts a key saved with `tenki login --api-key <key>`, but agent code doesn't. If the key can see more than one workspace, set `TENKI_WORKSPACE_ID` (for `verify.py`) or pass `workspace_id=`.

### 3. Verify

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

```
✓ ag2-tenki: TenkiEnvironment → live sandbox via the real integration → exec 42 → aclose teardown
```

`verify.py` opens a sandbox through AG2's real classes, runs `python3`, writes a file, and checks that a second `open()` returns the same cached sandbox with the file intact. It needs no model key. `verify.mjs` is a CI shim that runs it with `.venv/bin/python`, `$PYTHON`, or `python3`.

### 4. Run an agent

```bash
uv pip install "ag2[anthropic]>=1.1.2" "tenki>=1.4.1"
export ANTHROPIC_API_KEY=...
```

Save this as `agent.py` (from the [AG2 Tenki docs](https://github.com/ag2ai/ag2/blob/main/website/docs/user-guide/extensions/tenki.mdx)) and run `.venv/bin/python agent.py`:

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

Pass the environment to `SandboxShellTool` and `env.code_environment()` to `SandboxCodeTool`. The code adapter maps the `python` runner to `python3` (Tenki's default image has no `python`) and enables Python and bash. Pass `languages=` to restrict that.

## Configure the sandbox

Every parameter is optional:

```python
from ag2.extensions.tenki import TenkiEnvironment, TenkiResources

env = TenkiEnvironment(
    workspace_id="your-workspace-id",
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
| `api_key` | `TENKI_AUTH_TOKEN` or `TENKI_API_KEY` | API authentication |
| `api_url` | `TENKI_API_URL`, else `https://api.tenki.cloud` | API endpoint |
| `workspace_id` | Auto-detected when the key sees one workspace | Tenki workspace scope |
| `name` | `ag2` | Sandbox name in the Tenki dashboard |
| `image` | Workspace default image | Registry image reference |
| `env_vars` | `{}` | Environment variables baked into the sandbox |
| `resources` | Workspace defaults | CPU / memory / disk overrides |
| `timeout` | `60` s | Sandbox startup + per-command timeout |
| `max_duration` | `900` s | Server-enforced sandbox lifetime backstop |
| `workdir` | `/home/tenki` | Working directory for commands and files |

`api_key`, `api_url`, `workspace_id`, `name`, `image`, and `env_vars` also accept AG2 `Variable`s, resolved per tool call from the conversation, so one environment can serve several tenants.

## How it behaves

- **One sandbox per environment.** Both tools share it. `TenkiEnvironment` caches sandboxes by their resolved parameters, so files persist across tool calls until `aclose()` (the `async with env` exit).
- **Cleanup.** A sandbox that never becomes ready is terminated immediately. An `atexit` hook terminates it if `aclose()` never ran. `max_duration` (default 900 s) reclaims it server-side if the process dies.
- **Networking.** Inbound is off and outbound is on. `TenkiEnvironment` has no setting for either.
- **Exit codes follow POSIX.** A command past `timeout` returns 124 with its partial output. Not found is 127, not executable is 126.

The core of `verify.py`:

```python
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
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_API_KEY, or run `tenki login`.`` | Export `TENKI_API_KEY`. |
| `Token must be a tk_ API key …` or `InvalidAuthTokenError` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `MissingAuthTokenError` in the agent after the check passed | Agent code doesn't read the `tenki login` key. Export `TENKI_API_KEY`. |
| ``The Tenki API key can access multiple workspaces. Pass `workspace_id` …`` | Set `TENKI_WORKSPACE_ID` or pass `workspace_id=`. If it says `has no visible workspace`, create one. |
| `ImportError: TenkiEnvironment requires optional dependencies.` | Install `requirements.txt`, which includes `tenki`. |
| `ModuleNotFoundError` for `ag2` or `ag2.extensions.tenki` | Create the `.venv` here and install `requirements.txt`, or set `PYTHON`. |
| `Tenki execution timed out after 60s` | Pass a larger `timeout=` to `TenkiEnvironment`. |
| `Tenki parameters given as Variable but no Context is available …` | `Variable`s resolve only inside an `Agent` tool call. Use concrete values with `env.open()`. |

## Related

- [AG2 Tenki docs](https://github.com/ag2ai/ag2/blob/main/website/docs/user-guide/extensions/tenki.mdx) and [ag2ai/ag2#3329](https://github.com/ag2ai/ag2/pull/3329)
- [AG2](https://github.com/ag2ai/ag2) and [`ag2` on PyPI](https://pypi.org/project/ag2/)
- [smolagents](../smolagents/) and [CrewAI](../crewai-code-interpreter/)
- [`tenki` on PyPI](https://pypi.org/project/tenki/) and the [Tenki docs](https://tenki.cloud/docs)
