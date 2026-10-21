# Open WebUI

A code interpreter for [Open WebUI](https://github.com/open-webui/open-webui) that runs every execution in its own Tenki sandbox, destroyed when the run ends, so model-written code never touches your Open WebUI host. The plugins come from [`LuxorLabs/tenki-open-webui`](https://github.com/LuxorLabs/tenki-open-webui), and you can install either or both from the [v0.1.0 release](https://github.com/LuxorLabs/tenki-open-webui/releases/tag/v0.1.0):

- **Tool, [`tenki_code_execution.py`](https://github.com/LuxorLabs/tenki-open-webui/releases/download/v0.1.0/tenki_code_execution.py):** gives the model an `execute_code(code, language)` tool. Python runs echo the last expression like a REPL, and matplotlib figures appear inline.
- **Action, [`tenki_run_code.py`](https://github.com/LuxorLabs/tenki-open-webui/releases/download/v0.1.0/tenki_run_code.py):** adds a **Run code** button under assistant messages that runs the message's last fenced code block.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Help me add a Tenki code interpreter to my Open WebUI, following https://github.com/LuxorLabs/cookbook/tree/main/examples/open-webui-tenki.
1. Download tenki_code_execution.py from https://github.com/LuxorLabs/tenki-open-webui/releases/tag/v0.1.0 and check its SHA-256 is 1bec42092db92be229b6f3085189770eeaf9889eedb3a258637b5b890ebc9ce3.
2. Walk me through pasting it into Open WebUI under Workspace → Tools → + and setting the tenki_api_key valve myself (a Tenki key starting with tk_, from https://app.tenki.cloud). Never ask me to paste the key to you.
3. To check it outside Open WebUI: clone https://github.com/LuxorLabs/cookbook, cd into examples/open-webui-tenki, create .venv with uv venv --python 3.12, and install requirements.txt. It needs TENKI_AUTH_TOKEN exported; if it isn't set, stop and ask me to export it. Never print the key or write it to a file. Then run node verify.mjs and confirm the ✓ line.
4. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- An Open WebUI instance where you can add Tools, and admin access to add the Action.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- For step 4: Python 3.10 or later, Node.js 20 or later, and access to github.com.

### 1. Install the plugin

In Open WebUI, go to **Workspace → Tools → +** for the Tool, or **Admin Panel → Functions → +** for the Action. Paste the release file's contents and save.

Open WebUI installs the SDK on the host from the file's frontmatter, with no restart:

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

### 2. Set your API key

Open the plugin's **Valves** (the gear icon) and set `tenki_api_key`. It's stored server-side and never logged or echoed. Each user can also set their own `tenki_api_key` in UserValves, which wins over the admin key, so their runs bill to their own account:

```python
def resolve_effective_key(valves: Valves, __user__: dict | None = None) -> str:
    """Effective credential: per-user key wins, else the admin key. ``""`` if none."""
    return _user_key(__user__) or (valves.tenki_api_key or "").strip()
```

### 3. Run

Enable the Tool for a model or chat and ask for something that needs computation:

- "Run Python that prints the numbers 1–5 and their sum." You get `1 2 3 4 5` and `15`.
- "Plot y = x² for x in 0..10 with matplotlib." You get an inline chart.
- "Run `raise ValueError('boom')`." The traceback comes back as text, so the model can fix its code.

The model gets a status line such as `[exit=0, 1.2s]` followed by `stdout:`, `stderr:`, and `result:` sections. For the Action, click **Run code** under a message with a fenced code block. The output is appended in a **Tenki sandbox output** section and replaced on the next click.

### 4. Verify

This folder holds a check that downloads the released Tool and runs it against live Tenki:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/open-webui-tenki
uv venv --python 3.12
uv pip install -r requirements.txt   # tenki[async]>=1.4.1, pydantic>=2
export TENKI_AUTH_TOKEN=tk_...       # TENKI_API_KEY or a `tenki login` key also work
node verify.mjs                      # or: .venv/bin/python verify.py
```

Without uv: `python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt`.

```
✓ open-webui-tenki: release asset loads standalone → valves ok → live execute_code → 42 → teardown
```

The check refuses the downloaded file unless its SHA-256 is `1bec42092db92be229b6f3085189770eeaf9889eedb3a258637b5b890ebc9ce3`, the digest GitHub lists for the asset, so you can check the file you paste the same way. It loads the file with only `tenki` and `pydantic`, checks the defaults offline:

```python
    tools = mod.Tools()
    assert tools.valves.network_egress is False, "egress must default OFF"
    assert tools.valves.timeout_seconds == 300
    # A user's own key (UserValves) must beat the admin key — offline check.
    tools.valves.tenki_api_key = "admin-key"
    user = {"valves": mod.Tools.UserValves(tenki_api_key="user-key")}
    assert mod.resolve_effective_key(tools.valves, user) == "user-key"
```

then calls the Tool in a live sandbox:

```python
    out = asyncio.run(tools.execute_code("print(6 * 7)", __event_emitter__=emitter))
    assert "exit=0" in out and "42" in out, f"unexpected tool output: {out!r}"
    assert any(e.get("type") == "status" for e in events), "no status events emitted"
```

It doesn't start Open WebUI, so the frontmatter install, the Action, and image capture aren't covered.

## Valves

Only the key is required.

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

## How each run works

Every Tool call and every **Run code** click creates a new sandbox. From `tenki_code_execution.py`:

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

`SANDBOX_LIFETIME_BUFFER` is 30 seconds. The sandbox is closed in a `finally` block, even on a timeout or crash, and `max_duration` ends it server-side if teardown never happens:

```python
    finally:
        try:
            await sandbox.close()  # always released (even on timeout/exception)
        except Exception:
            pass
```

## Things to know

- **Outbound network is off by default**, the reverse of the SDK's default. `pip install`, `apt-get`, and HTTP requests fail until you turn on `network_egress`. Turn it on only if you trust the code.
- **No state carries over.** Each run starts in a clean sandbox, so variables, files, and runtime installs don't persist. Put extra libraries in an image and set `sandbox_image`.
- **Languages:** `python` (`py`, `python3`) and `shell` (`sh`, `bash`, `zsh`). Shell runs as `bash -lc <code>`. The Action reads the language from the code fence.
- **Images:** open matplotlib figures and image files written to `owui_tenki_out/` appear inline, up to 10 MiB per run.
- **Runs bill to the effective key's account**: the user's key if set, otherwise the admin key.
- **Several replicas:** bake `tenki[async]` into your image and set `ENABLE_PIP_INSTALL_FRONTMATTER_REQUIREMENTS=False`, so workers don't race to install it.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Error: No Tenki API key configured. …` | Set `tenki_api_key` in Valves or UserValves. |
| `Error: Sandbox provisioning failed: invalid auth token: …` | Use a `tk_` key from [app.tenki.cloud](https://app.tenki.cloud). |
| `Error: Sandbox provisioning failed: …` (other) | The code never ran. Check `tenki_api_key`, `tenki_api_endpoint`, and `tenki_workspace_id`. |
| `pip install`, `apt-get`, or an HTTP request fails | Turn on `network_egress`, or use a `sandbox_image` with the libraries. |
| `ModuleNotFoundError` in the run's stderr | The library isn't in the sandbox image. Set `sandbox_image`. |
| `Unsupported language '…'. Supported: python, shell.` | Use one of the supported language tags. |
| `[timed out after …]` | Raise `timeout_seconds` (up to 600). |
| "No runnable code block found in this conversation." | The Action runs only fenced code blocks. |
| `memory_mb must be aligned to 2 MiB (an even number)` | Use an even `memory_mb`. |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.py` found no key. Export one or run `tenki login --api-key <key>`. |
| `✗ ModuleNotFoundError: No module named 'pydantic'` from `node verify.mjs` | Create the `.venv` in this folder, or set `PYTHON`. |
| `✗ URLError: …` or `✗ HTTPError: …` | The check couldn't download the release from github.com. |

## Related

- [`LuxorLabs/tenki-open-webui`](https://github.com/LuxorLabs/tenki-open-webui): the plugins' source and tests
- [`tenki` on PyPI](https://pypi.org/project/tenki/) and the [Tenki docs](https://tenki.cloud/docs)
- [DeerFlow](../deerflow-tenki/): another self-hosted app whose agents' code runs in Tenki sandboxes
- [Run code with Python](../run-code-python/): the SDK with no app around it
