# How to run an AG2 agent's shell and code tools in a Tenki sandbox

**Audience:** Python developers building agents with AG2 1.x (`from ag2 import Agent`) who don't want model-written commands running on their own machine.
**Time:** ~5 minutes.
**Outcome:** `node verify.mjs` prints its `✓` line after opening a live Tenki sandbox through AG2's own Tenki backend, and you have the agent code that gives `SandboxShellTool` and `SandboxCodeTool` that sandbox.

> **Honesty note:** this example ships a check, not an agent. `verify.py` drives AG2's Tenki classes against live Tenki and needs no model key. The agent code in [Use it](#use-it) is the snippet from AG2's Tenki docs, and running it needs an Anthropic API key.

## Why bother

AG2's `SandboxShellTool` and `SandboxCodeTool` run whatever the model writes inside a pluggable sandbox backend. AG2 has a native Tenki backend, `ag2.extensions.tenki`, merged in [ag2ai/ag2#3096](https://github.com/ag2ai/ag2/pull/3096) and maintained with Tenki. With it, every shell command and code snippet from an [AG2](https://github.com/ag2ai/ag2) agent executes in an isolated [Tenki](https://tenki.cloud) microVM instead of on your machine. One `TenkiEnvironment` serves both tools, files persist between tool calls, and the sandbox is terminated when the environment closes.

This is for AG2 1.x. As of AG2 1.0, `pip install ag2` ships the `Agent` API (`from ag2 import Agent`). The older AutoGen-derived API (`import autogen`, `ConversableAgent`) is now [AG2 Classic](https://github.com/ag2ai/ag2-classic), in its own repo.

## Install

You need Python 3.10 or later. Get the example:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/ag2-tenki
```

Every later command runs from this directory. Create a virtualenv here and install the pins:

```bash
uv venv
uv pip install -r requirements.txt
```

Without uv, run `python3.11 -m venv .venv` (any Python 3.10+ works) and then `.venv/bin/pip install -r requirements.txt`. Keep the name `.venv`, because `verify.mjs` looks for `.venv/bin/python`.

The pins in `requirements.txt`:

```
ag2>=1.1.2
tenki>=1.4.1
```

`ag2` 1.1.2 is the first release whose Tenki extension targets the 1.x `tenki` SDK ([ag2ai/ag2#3329](https://github.com/ag2ai/ag2/pull/3329)). Releases 1.0.2 through 1.1.1 shipped the extension against `tenki` 0.5.x. AG2 doesn't install the Tenki SDK for you, since its extensions aren't shipped as extras, so `tenki` is listed separately.

## Authenticate

Create a `tk_` API key at https://app.tenki.cloud and export it:

```bash
export TENKI_API_KEY=tk_...
```

`verify.py` also accepts `TENKI_AUTH_TOKEN`, or a key stored with `tenki login --api-key <key>` in `~/.config/tenki/config.yaml`. Agent code doesn't read that file. `TenkiEnvironment()` leaves auth to the Tenki SDK, which reads `TENKI_AUTH_TOKEN` and then `TENKI_API_KEY`, so **export one of them before you run an agent**, even if `tenki login` already worked for the check.

You don't need a workspace setting when the key can see one workspace, because `TenkiEnvironment` picks it. If the key can see several, set `TENKI_WORKSPACE_ID` (which `verify.py` reads) or pass `workspace_id=` in your own code.

## Use it

The agent needs AG2's Anthropic extra and an Anthropic API key. The check doesn't.

```bash
uv pip install "ag2[anthropic]>=1.1.2" "tenki>=1.4.1"
export ANTHROPIC_API_KEY=...
```

This is the agent from the [AG2 Tenki docs](https://github.com/ag2ai/ag2/blob/main/website/docs/user-guide/extensions/tenki.mdx). The example doesn't ship it as a file. Save it as `agent.py` and run `.venv/bin/python agent.py`:

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

Pass the environment itself to `SandboxShellTool`, and `env.code_environment()` to `SandboxCodeTool`. Tenki's default image ships `python3` (not `python`), and the `CodeAdapter` that `code_environment()` returns maps the `python` runner to `python3`. It enables Python and bash. Pass `languages=` to restrict that.

### Configure the sandbox

Every parameter is optional. This block is from the AG2 Tenki docs:

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

The credential and selection parameters (`api_key`, `api_url`, `workspace_id`, `name`, `image`, `env_vars`) also accept AG2 `Variable`s, resolved per tool call from the conversation, so one environment can serve several tenants. See the [AG2 Tenki docs](https://github.com/ag2ai/ag2/blob/main/website/docs/user-guide/extensions/tenki.mdx).

## One sandbox per environment

- Both tools share one sandbox. `SandboxShellTool(env)` and `SandboxCodeTool(env.code_environment())` draw from the same `TenkiEnvironment`, so there is one sandbox and one cleanup path.
- Files persist across tool calls. `TenkiEnvironment` caches sandboxes by their resolved parameters, so a file the agent writes in tool call 1 is still there in tool call 10. The sandbox lives until `aclose()` (the `async with env` exit), not per call.
- Cleanup has three layers. Creation is failure-atomic: a sandbox that never becomes ready is terminated immediately. An `atexit` hook terminates the sandbox at interpreter shutdown if `aclose()` never ran. `max_duration` reclaims the VM server-side even if the client process dies. `max_duration` is the fail-safe, not the normal path, so close the environment with `async with` or `await env.aclose()`.
- Networking is set by the extension. Sandboxes are created with inbound networking off and outbound on. `TenkiEnvironment` has no parameter for either.
- Exit codes follow POSIX. A command that runs past `timeout` returns exit code 124 and keeps its partial output. A command whose binary isn't found returns 127, and one that isn't executable returns 126.

## Check it works

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

`verify.mjs` is a shim. It runs `verify.py` with `.venv/bin/python` if that exists, otherwise with `$PYTHON` or `python3`. The script imports `ag2.extensions.tenki`, builds `TenkiEnvironment`, `TenkiResources` and the `CodeAdapter`, and then does what `SandboxShellTool` does on each call. From `verify.py`:

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

On success it prints:

```
✓ ag2-tenki: TenkiEnvironment → live sandbox via the real integration → exec 42 → aclose teardown
```

On failure it prints `✗ <error type>: <message>` and exits with status 1.

The check proves that the extension imports, opens a live Tenki sandbox through AG2's real classes, runs a command in it, and hands back the same cached sandbox on a second `open()` with the file intact. It needs no model key, so the agent loop itself isn't exercised, and it doesn't confirm afterwards that the sandbox is gone. AG2's own test suite covers the extension against a mocked Tenki SDK. CI runs this check with only `TENKI_API_KEY` set.

## Troubleshooting

❌ **``No token. Set TENKI_API_KEY, or run `tenki login`.``** `verify.py` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY` or `~/.config/tenki/config.yaml`. Export `TENKI_API_KEY=tk_...`.

❌ **`Token must be a tk_ API key (tenki SDK 1.x accepts only tk_ keys).`** The key it found doesn't start with `tk_`. In agent code the SDK raises `InvalidAuthTokenError` for the same reason. Create an API key at https://app.tenki.cloud and set `TENKI_API_KEY`, or run `tenki login --api-key <key>`.

❌ **`MissingAuthTokenError` when the agent runs, after the check passed.** `verify.py` reads `~/.config/tenki/config.yaml` itself. The Tenki SDK that `TenkiEnvironment()` uses reads only `TENKI_AUTH_TOKEN` and `TENKI_API_KEY`. Export `TENKI_API_KEY` in the shell that runs the agent.

❌ **``RuntimeError: The Tenki API key can access multiple workspaces. Pass `workspace_id` to TenkiEnvironment.``** Workspace auto-detection works only when the key sees exactly one workspace. Set `TENKI_WORKSPACE_ID` for `verify.py`, or pass `workspace_id=` in your own code. If the message instead says the key `has no visible workspace`, create a workspace first.

❌ **`ImportError: TenkiEnvironment requires optional dependencies.`** (or `TenkiResources`). The `tenki` SDK isn't installed in the interpreter that ran the code. Run `uv pip install -r requirements.txt`, which installs `tenki>=1.4.1`.

❌ **`ModuleNotFoundError` for `ag2` or `ag2.extensions.tenki`.** `verify.mjs` found no `.venv/bin/python` in this directory and fell back to `$PYTHON` or `python3`, or the interpreter has an `ag2` older than the pin. Create the venv in `examples/ag2-tenki` and install `requirements.txt`, or point `PYTHON` at the right interpreter.

❌ **`Tenki execution timed out after 60s` in a tool result.** The command ran past `timeout`, which defaults to 60 seconds per command, and came back with exit code 124. Pass a larger `timeout=` to `TenkiEnvironment`.

❌ **`RuntimeError: Tenki parameters given as Variable but no Context is available to resolve them.`** `Variable` parameters resolve only when a sandbox tool is invoked through an `Agent`. Calling `env.open()` yourself, as `verify.py` does, needs concrete values.

## FAQ

**Do I need a model key to run the check?** No. `verify.py` makes no agent or model call. It needs only a Tenki key.

**How long does a sandbox live?** Until the environment closes, capped by `max_duration`, which defaults to 900 seconds (15 minutes). Pass a larger `max_duration` for longer sessions.

**When shouldn't I use this?** When your code is on AG2 Classic (`import autogen`, `ConversableAgent`): this backend is part of `ag2` 1.x, which no longer ships the classic classes. Also when the agent's sandbox must accept inbound connections or must have no outbound network, because the extension sets inbound off and outbound on and doesn't expose either setting.

## Related

- [AG2](https://github.com/ag2ai/ag2) and [`ag2` on PyPI](https://pypi.org/project/ag2/)
- [AG2 Tenki docs](https://github.com/ag2ai/ag2/blob/main/website/docs/user-guide/extensions/tenki.mdx)
- [ag2ai/ag2#3096](https://github.com/ag2ai/ag2/pull/3096), the integration PR, and [ag2ai/ag2#3329](https://github.com/ag2ai/ag2/pull/3329), its move to `tenki` 1.4
- [`tenki` on PyPI](https://pypi.org/project/tenki/) and the [Tenki docs](https://tenki.cloud/docs)
- [smolagents](../smolagents/): a `TenkiExecutor` that runs a smolagents `CodeAgent`'s Python in a Tenki sandbox
- [CrewAI code interpreter](../crewai-code-interpreter/): a code-interpreter tool that runs a CrewAI agent's Python in a Tenki sandbox
