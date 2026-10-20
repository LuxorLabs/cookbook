# How to give Open WebUI a code interpreter that runs in Tenki sandboxes

**Audience:** people who run a self-hosted [Open WebUI](https://github.com/open-webui/open-webui), the ChatGPT-style interface for Ollama and OpenAI-compatible APIs, and want models to run code somewhere other than the Open WebUI host.
**Time:** ~10 minutes, assuming Open WebUI is already running.
**Outcome:** an `execute_code` tool that models in Open WebUI call on their own, and optionally a **Run code** button under assistant messages. Every run executes in its own [Tenki](https://tenki.cloud) sandbox that is torn down when the run ends. You also get a passing check, run from this directory, against the released plugin file.

> **Honesty note:** the plugin creates every sandbox with outbound network off. Its `network_egress` valve defaults to `false`, which is the reverse of the Tenki SDK's own default. The code can also use only the libraries the sandbox image already has, so a `pip install` inside a run fails until you turn egress on.

## Why bother

A model that writes code needs somewhere to run it, and running model-generated code on the machine that hosts Open WebUI is a risk. With this plugin, each run gets a fresh Linux sandbox with real root, created on demand and destroyed when the run finishes, so the code never touches your Open WebUI host. No state carries over between runs, and one run can't see another's files or memory.

The plugin is built on [`LuxorLabs/tenki-open-webui`](https://github.com/LuxorLabs/tenki-open-webui). It ships as two single-file plugins built from the same execution core, and you install either or both from the [v0.1.0 release](https://github.com/LuxorLabs/tenki-open-webui/releases/tag/v0.1.0):

- **Tool: [`tenki_code_execution.py`](https://github.com/LuxorLabs/tenki-open-webui/releases/download/v0.1.0/tenki_code_execution.py).** Exposes `execute_code(code, language)` to the model, which calls it on its own mid-conversation and iterates on the output. Python runs echo the last expression REPL-style, and matplotlib figures are captured and shown inline in the chat as images.
- **Action: [`tenki_run_code.py`](https://github.com/LuxorLabs/tenki-open-webui/releases/download/v0.1.0/tenki_run_code.py).** Adds a **Run code** button under assistant messages. Click it and the message's last fenced code block runs in a fresh sandbox, with the output appended to the message.

You paste the file into Open WebUI, and Open WebUI installs the Tenki SDK for you. Runs use your own Tenki account and API key. The key is stored server-side in Open WebUI's plugin settings and is never logged, echoed in output, or put in error messages, and code and data go only to the configured Tenki endpoint.

## Prerequisites

- An Open WebUI instance where you can add Tools. The Action is a Function, which you add from the **Admin Panel**.
- A Tenki account, to create a `tk_` API key at https://app.tenki.cloud.
- For the check in Step 6: Python 3.10 or newer (the `tenki` SDK requires it; CI uses 3.12), Node (CI uses Node 20), optionally [`uv`](https://docs.astral.sh/uv/), and network access to github.com, because the check downloads the release file.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/open-webui-tenki
```

Every later command runs from this directory. It holds the check (`verify.py`, plus the `verify.mjs` shim) and its `requirements.txt`. It doesn't hold the plugins: those are the release files linked above. The check downloads the released Tool file, the same one you paste into Open WebUI, and tests that.

## Step 2 — Install the plugin in Open WebUI

1. In Open WebUI, go to **Workspace → Tools → +** for the Tool, or **Admin Panel → Functions → +** for the Action.
2. Paste the release file's contents and save.

There's nothing to `pip install` yourself and no server restart. Open WebUI reads the `requirements:` line in the file's docstring frontmatter and installs the SDK. This is the frontmatter of the Tool, from `tenki_code_execution.py` in the v0.1.0 release:

```python
"""
title: Tenki Sandbox
author: LuxorLabs
author_url: https://github.com/LuxorLabs/tenki-open-webui
funding_url: https://github.com/LuxorLabs/tenki-open-webui
description: Run Python and shell code in isolated, ephemeral Tenki sandboxes. A secure code interpreter / code execution sandbox for Open WebUI (isolated, ephemeral, sandbox).
version: 0.1.0
license: MIT
requirements: tenki[async]>=0.5.1
"""
```

The Action declares the same `requirements: tenki[async]>=0.5.1`. That line installs the plugin's own dependency on the Open WebUI host. It adds nothing to the sandbox, whose Python version, shell and libraries come from the Tenki sandbox image.

## Step 3 — Authenticate

Create a `tk_` API key at https://app.tenki.cloud. SDK 1.x accepts only `tk_` keys.

Open the plugin's **Valves** (the gear icon) and set `tenki_api_key`. This admin key is stored server-side. It's required unless every user sets their own.

**Per-user keys.** Each user can set their own `tenki_api_key` in UserValves (chat settings). It takes precedence over the admin key, so on a shared instance each user's runs bill to their own Tenki account. The rule, from `tenki_code_execution.py`:

```python
def resolve_effective_key(valves: Valves, __user__: dict | None = None) -> str:
    """Effective credential: per-user key wins, else the admin key. ``""`` if none."""
    return _user_key(__user__) or (valves.tenki_api_key or "").strip()
```

If neither key is set, a run returns a configuration error instead of crashing.

Tenki infers your workspace from the key. To pin a specific one, set the `tenki_workspace_id` valve.

## Step 4 — Set the valves

Only the key has to be set. These are all the valves:

| Valve | Default | Notes |
| --- | --- | --- |
| `tenki_api_key` | empty | Required unless every user sets their own. Admin key, stored server-side. |
| `tenki_api_endpoint` | `https://api.tenki.cloud` | Override for self-hosted or staging. |
| `tenki_workspace_id` | empty | Optional. Empty means Tenki infers the workspace from the key. |
| `default_language` | `python` | `python` or `shell`, used when the caller doesn't name one. |
| `cpu_cores` / `memory_mb` / `disk_size_gb` | 1 / 512 / 5 | Per-sandbox size. Allowed: 1–16 cores, 128–65536 MiB (an even number), 5–100 GiB. |
| `timeout_seconds` | 300 | Max execution time per run, from 1 to 600. The sandbox is also created with a `max_duration` of this plus 30 seconds, so Tenki ends it server-side if teardown never happens. |
| `network_egress` | **`false`** | Sandboxes get no outbound network unless you opt in. |
| `sandbox_image` | empty (SDK default) | Optional Tenki image or template ref. It must provide `python3` and `bash`. |
| `max_concurrent_executions` | 5 | Cap on sandboxes the plugin runs at once. Further runs wait for a free slot. |
| `max_output_bytes` | 100000 | Truncation cap for captured stdout, stderr and result, each. Minimum 1000. |

Turn `network_egress` on only if you trust the code being run.

## Step 5 — Use it

**The Tool.** Enable it per-model or per-chat so the model can call it. Then ask something that needs computation, such as a chart of some data. The model calls `execute_code(code, language)`, reads what comes back, and iterates. It gets a status line such as `[exit=0, 1.2s]`, followed by whichever of the `stdout:`, `stderr:` and `result:` sections have content. A Python traceback comes back as text, so the model can read it and fix its code.

**The Action.** Click **Run code** under an assistant message that contains a fenced code block. The plugin runs the last code block in that message, or, if it has none, the most recent message that does. The output is appended to the message in a **Tenki sandbox output** section. Edit the block and click again to get fresh output; the new output replaces the old section.

What both plugins accept:

- **Languages.** `python` (also `py`, `python3`) and `shell` (also `sh`, `bash`, `zsh`). The Action takes the language from the code fence's info string and falls back to `default_language`. Shell code runs as `bash -lc <code>`.
- **Python.** If the last statement is an expression, its value (unless it's `None`) comes back as `result:`, as in a REPL. Open matplotlib figures are saved as PNGs and shown inline, along with any other image files the code writes to `owui_tenki_out/`, up to 10 MiB of images per run.
- **Output.** stdout, stderr and the result are each cut at `max_output_bytes`. When stdout or stderr is cut, the output says so.

### What each run does

Every call to the Tool and every click of the Action creates a new sandbox. This is the create call, from `tenki_code_execution.py`:

```python
    try:
        sandbox = await AsyncSandbox.create(
            auth_token=request.api_key,
            base_url=valves.tenki_api_endpoint,  # data goes only to the configured endpoint
            workspace_id=valves.tenki_workspace_id or None,
            cpu_cores=valves.cpu_cores,
            memory_mb=valves.memory_mb,
            disk_size_gb=valves.disk_size_gb,
            allow_outbound=valves.network_egress,  # egress off by default
            image=valves.sandbox_image or None,
            max_duration=valves.timeout_seconds + SANDBOX_LIFETIME_BUFFER,
        )
    except Exception as err:  # provisioning / auth / quota — execution never ran
        return ExecutionResult(error=f"Sandbox provisioning failed: {err}")
```

`SANDBOX_LIFETIME_BUFFER` is 30. After the code runs and the output and images are collected, the sandbox is closed in a `finally` block, from the same file:

```python
    finally:
        try:
            await sandbox.close()  # always released (even on timeout/exception)
        except Exception:
            pass
```

In the `tenki` SDK, `close()` terminates the sandbox. It runs even on a timeout or crash, and the server-side `max_duration` ends any sandbox whose teardown didn't happen, so sandboxes don't pile up.

## Step 6 — Check it works

From this directory, create the virtual environment as `.venv`, because `verify.mjs` looks for `.venv/bin/python`. Then run the check:

```bash
uv venv --python 3.12
uv pip install -r requirements.txt
export TENKI_AUTH_TOKEN=tk_...   # or `tenki login --api-key tk_...`
node verify.mjs                  # or: .venv/bin/python verify.py
```

Without `uv`:

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

The dependencies, from `requirements.txt`:

```
tenki[async]>=1.4.1
pydantic>=2
```

The plugin's frontmatter asks for `tenki[async]>=0.5.1`. The check pins the current SDK release, 1.4.1. Apart from the standard library, `pydantic` is the only other package the plugin imports.

`verify.py` reads the key from `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or the `auth_token` line that `tenki login --api-key <key>` writes to `~/.config/tenki/config.yaml`. If `TENKI_WORKSPACE_ID` is set, or the config file has a `current_workspace_id:` line, it passes that through as `tenki_workspace_id`. `verify.mjs` is a shim for the cookbook's Node verify harness: it runs `verify.py` with `.venv/bin/python` if that exists, otherwise with `$PYTHON` or `python3`.

On success it prints:

```
✓ open-webui-tenki: release asset loads standalone → valves ok → live execute_code → 42 → teardown
```

The check drives the real release file, not a copy. It downloads the pinned v0.1.0 Tool from the GitHub release and saves it as `_release_tool.py` next to `verify.py` (the file is gitignored). It refuses to run the file unless its SHA-256 is `1bec42092db92be229b6f3085189770eeaf9889eedb3a258637b5b890ebc9ce3`, the digest GitHub lists for that asset, so you can check the file you paste the same way. Then it loads it with only `tenki` and `pydantic` installed and checks the defaults offline. From `verify.py`:

```python
    tools = mod.Tools()
    assert tools.valves.network_egress is False, "egress must default OFF"
    assert tools.valves.timeout_seconds == 300
    # A user's own key (UserValves) must beat the admin key — offline check.
    tools.valves.tenki_api_key = "admin-key"
    user = {"valves": mod.Tools.UserValves(tenki_api_key="user-key")}
    assert mod.resolve_effective_key(tools.valves, user) == "user-key"
```

Then it calls the Tool against a live Tenki sandbox, with a stand-in for Open WebUI's `__event_emitter__`:

```python
    out = asyncio.run(tools.execute_code("print(6 * 7)", __event_emitter__=emitter))
    assert "exit=0" in out and "42" in out, f"unexpected tool output: {out!r}"
    assert any(e.get("type") == "status" for e in events), "no status events emitted"
```

This proves that the file you paste has no hidden dependencies, that egress is off and per-user keys win by default, and that `execute_code` runs code in a real sandbox and returns its output. It doesn't start Open WebUI, so the frontmatter install, a model calling the tool, the Action, and image capture aren't exercised. This is what CI runs, on Node 20 and Python 3.12 with only `TENKI_API_KEY` set.

To check the plugin inside Open WebUI, try these prompts with the Tool enabled:

- "Run Python that prints the numbers 1–5 and their sum." You should see `1 2 3 4 5` and `15`.
- "Plot y = x² for x in 0..10 with matplotlib." You should see an inline chart image.
- "Run `raise ValueError('boom')`." The traceback comes back, and nothing crashes.

## Troubleshooting

### In Open WebUI

**❌ `Error: No Tenki API key configured. Set 'tenki_api_key' in the plugin settings (Valves) or your personal settings (UserValves).`** Neither the admin valve nor the user's UserValves has a key. Set `tenki_api_key` in one of them, as in [Step 3](#step-3--authenticate).

**❌ `Error: Sandbox provisioning failed: invalid auth token: expected an API key or service token starting with tk_`.** The key in the valve isn't a `tk_` API key, and SDK 1.x accepts nothing else. Create a key at https://app.tenki.cloud and paste that in.

**❌ `Error: Sandbox provisioning failed: …` with another message.** The sandbox was never created, so the code never ran. The plugin reports provisioning, auth and quota failures this way. Read the message, and check `tenki_api_key`, `tenki_api_endpoint` and `tenki_workspace_id`.

**❌ The code's `pip install`, `apt-get` or HTTP request fails.** `network_egress` is `false` by default, so the sandbox has no outbound network. Turn it on if you trust the code, or put the libraries in an image and set `sandbox_image`.

**❌ `ModuleNotFoundError` in the run's stderr.** The library isn't in the sandbox image. The `requirements:` frontmatter installs `tenki[async]` on the Open WebUI host only. Set `sandbox_image` to an image that has the library, or install it at runtime with `network_egress` on.

**❌ `Unsupported language '…'. Supported: python, shell.`** The language the model passed, or the Action's code-fence tag, isn't one the plugin knows. Use `python`, `py`, `python3`, `shell`, `sh`, `bash` or `zsh`.

**❌ `[timed out after …]`, or a "Timed out" status.** The run used all of `timeout_seconds` (300 by default). Raise the valve, up to 600, or shorten the work.

**❌ "No runnable code block found in this conversation."** You clicked **Run code**, and neither that message nor any other message in the conversation contains a fenced code block. The Action runs only fenced blocks.

**❌ `memory_mb must be aligned to 2 MiB (an even number)`.** The `memory_mb` valve is odd, and the plugin's validator rejects it because Tenki needs memory aligned to 2 MiB. Use an even number.

### Running the check

**❌ ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.py` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export `TENKI_AUTH_TOKEN=tk_...`, or run `tenki login --api-key <key>`.

**❌ ``Token must be a tk_ API key (tenki SDK 1.x). Run `tenki login --api-key tk_...` or set TENKI_AUTH_TOKEN.``** The key it found doesn't start with `tk_`. Create a `tk_` key at https://app.tenki.cloud.

**❌ `✗ ModuleNotFoundError: No module named 'pydantic'` (or `'tenki'`) from `node verify.mjs`.** There's no `.venv` in this directory, so the shim fell back to `$PYTHON` or `python3`, which doesn't have the dependencies. Create the venv here as shown in [Step 6](#step-6--check-it-works), or set `PYTHON` to the interpreter you installed into.

**❌ `✗ URLError: …` or `✗ HTTPError: …`.** The download of the release file from github.com failed. The check needs network access to GitHub.

**❌ `✗ AssertionError: unexpected tool output: 'Error: Sandbox provisioning failed: …'`.** The file loaded and the offline checks passed, but the live sandbox wasn't created. The quoted text is the plugin's own error; see the provisioning entries above.

## FAQ

**Does the model keep variables or files between calls?** No. Each call runs in a fresh sandbox with no state from earlier calls, and the tool's description tells the model so.

**How do I make extra libraries available?** The recommended way is an image that has them: point `sandbox_image` at it, and they're there on every run with no network needed. For a one-off, the code can install a package itself, which needs `network_egress` on and an image with a package manager. Because every run is a fresh sandbox, that install repeats on every run.

**Who pays for the runs?** The account behind the effective key: the user's own key if they set one in UserValves, otherwise the admin key. Tenki doesn't run shared execution infrastructure for this integration, so you're responsible for the code your users and models run and for the usage it creates.

**I run Open WebUI with several replicas. Anything to watch?** The upstream README suggests baking `tenki[async]` into your image and setting `ENABLE_PIP_INSTALL_FRONTMATTER_REQUIREMENTS=False`, to avoid each worker racing to install it.

**When shouldn't I use this?** When you need a notebook-style session that keeps variables or files between runs, since every run starts from a clean sandbox. When a single run needs more than 600 seconds, the most `timeout_seconds` allows. When the code needs the network and you can't allow egress, or needs libraries that aren't in an image you can point `sandbox_image` at, since a runtime install repeats on every run.

## Related

- Open WebUI: https://github.com/open-webui/open-webui
- The plugins' source, build tooling and tests: https://github.com/LuxorLabs/tenki-open-webui, with the [v0.1.0 release](https://github.com/LuxorLabs/tenki-open-webui/releases/tag/v0.1.0)
- [`tenki` on PyPI](https://pypi.org/project/tenki/), the Python SDK the plugins use (`tenki[async]`, `AsyncSandbox`)
- Tenki docs: https://tenki.cloud/docs
- [`deerflow-tenki`](../deerflow-tenki/): another self-hosted app whose agents' code runs in Tenki sandboxes
- [`run-code-python`](../run-code-python/): the bare Tenki Python SDK, with no app around it
