# How to run code in a Tenki sandbox from Python

**Audience:** Python developers (3.10+) who want to run code in a throwaway VM from a script, for example before handing model-generated code to one.
**Time:** ~5 minutes.
**Outcome:** a script that boots a [Tenki](https://tenki.cloud) sandbox, runs `python3 -c "print(6 * 7)"` inside it, prints `exit 0 -> 42`, and terminates the sandbox.

> **Honesty note:** each run boots a real microVM in your Tenki workspace, and sandboxes are billed per second. The `with` block in `run.py` terminates it when the script finishes.

## Why bother

This is the core Tenki loop: boot a disposable microVM, run code in it, read the output, throw the VM away. It uses the official [`tenki`](https://tenki.cloud/docs/sandbox/sdk) Python SDK and nothing else, so it's the smallest working starting point before you wire a sandbox into an agent. It is the Python twin of [`run-code-in-a-sandbox`](../run-code-in-a-sandbox/) (Node).

## Install

You need Python 3.10 or newer (the `tenki` package requires it). Get the example from the repo:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/run-code-python
```

Every later command runs from this directory. Create a virtual environment and install the SDK. `requirements.txt` holds one line, `tenki>=1.4.1`.

```bash
uv venv --python 3.12                      # or: python3.11 -m venv .venv
uv pip install -r requirements.txt         # the tenki SDK
```

Without uv: `python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt`.

## Authenticate

Create a `tk_` API key at https://app.tenki.cloud and export it. A `tk_` API key is the only credential the SDK accepts.

```bash
export TENKI_API_KEY=tk_...
```

If you use the Tenki CLI, `tenki login --api-key <key>` stores the key in `~/.config/tenki/config.yaml`, and `run.py` reads it from there when no environment variable is set. Tenki infers the workspace from the key, so a workspace ID is optional. Set `TENKI_WORKSPACE_ID` only to pick one explicitly. This is how `run.py` resolves both:

```python
# A tk_ API key — the only credential the SDK accepts — from env (CI) or the
# CLI's config file (local).
token = os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or cfg("auth_token")

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id
```

`TENKI_AUTH_TOKEN` is checked first, then `TENKI_API_KEY`, then the config file.

## Use it

```bash
.venv/bin/python run.py                    # exit 0 -> 42
```

Run it with the venv's Python (or activate the venv first), since that's where `tenki` is installed. The work happens at the end of `run.py`:

```python
# `Sandbox.create(...)` boots a microVM and waits until it's RUNNING (~2s).
# The `with` block disposes it (terminates the VM) when the scope ends.
with Sandbox.create(**opts) as sandbox:
    # exec(command, *args) runs a bare binary + its args — no shell splitting,
    # so model-generated, multi-line code goes across as one `-c` argument.
    result = sandbox.exec("python3", "-c", "print(6 * 7)")
    print(f"exit {result.exit_code} -> {result.stdout_text.strip()}")  # exit 0 -> 42
```

`Sandbox.create(...)` boots a 1-core, 1024 MB microVM and blocks until it's `RUNNING`, about 2 seconds. Leaving the `with` block terminates the VM, including when the code inside raises, so an error doesn't leave a sandbox running. Under the hood, `__exit__` calls `close()`, which is an alias for `terminate` and issues a real `TerminateSession`. If you don't use `with`, call `sandbox.terminate()` yourself.

## Why `exec` takes arguments, not a command string

`exec(command, *args)` runs a bare binary with its arguments and does no shell splitting. Each argument goes through as-is, so multi-line, model-generated code travels as a single `-c` argument with no quoting or escaping to get wrong.

The flip side is that shell syntax such as `&&`, pipes and `$VAR` doesn't work unless you ask for a shell. For a shell one-liner, run `sh -c`: `sandbox.exec("sh", "-c", "echo hi && ls")`.

## Check it works

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

On success it prints:

```
✓ run-code-python: create → exec python3 → 42 → dispose
```

`verify.py` boots a live sandbox with your key, runs `python3 -c "print(6 * 7)"`, asserts exit code `0` and stdout `42`, and disposes the sandbox. The `✓` line prints only after the `with` block exits, so a failed terminate also fails the check. No model key is needed, because this example has no model in it. The check runs `verify.py`, not `run.py`, though the two make the same calls.

`verify.mjs` is a thin shim so the cookbook's CI, which runs `node verify.mjs` in every example, can run the Python. It picks the interpreter like this, then exits with `verify.py`'s status:

```js
const py = existsSync(".venv/bin/python") ? ".venv/bin/python" : process.env.PYTHON || "python3";
```

[`crewai-code-interpreter`](../crewai-code-interpreter/) uses the same pattern. CI runs it on Node 20 and Python 3.12, with only `TENKI_API_KEY` set.

## Troubleshooting

**❌ ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.``** (from `verify.py`), or `missing auth token: set TENKI_AUTH_TOKEN or TENKI_API_KEY` (from `run.py`). No key in the environment or in `~/.config/tenki/config.yaml`. Export `TENKI_API_KEY`, or run `tenki login --api-key <key>`.

**❌ `invalid auth token: expected an API key or service token starting with tk_`.** The key you set doesn't start with `tk_`. The SDK accepts only `tk_` keys. Create one at https://app.tenki.cloud.

**❌ `ModuleNotFoundError: No module named 'tenki'`.** You ran the script with a Python outside the venv, where the SDK isn't installed. Use `.venv/bin/python run.py`, or activate `.venv` first.

**❌ pip or uv can't find a version that satisfies `tenki>=1.4.1`.** Your Python is older than 3.10, which the `tenki` package requires. Recreate the venv with a newer Python, for example `uv venv --python 3.12`.

**❌ `permission_denied … path outside workdir` when you add file reads or writes.** The SDK's file methods are confined to `/home/tenki`, the sandbox's working directory. Use relative paths. Shell commands run with `exec` can write anywhere.

**❌ `✗ AssertionError: unexpected result: exit …, stdout …, stderr …`.** The sandbox booted, but `python3 -c "print(6 * 7)"` didn't exit `0` with `42`. The message includes the command's stdout and stderr; start there.

## FAQ

**When shouldn't I use this?** When you're on Python older than 3.10, which the SDK doesn't support. When your stack is Node: use [`run-code-in-a-sandbox`](../run-code-in-a-sandbox/) instead. And when you want an agent that writes and runs its own code: this example runs one hard-coded command with no model in the loop, so start from an agent example such as [`crewai-code-interpreter`](../crewai-code-interpreter/).

**Do I need a workspace ID?** No. Tenki infers the workspace from your API key. `run.py` passes `workspace_id` only when `TENKI_WORKSPACE_ID` (or a `current_workspace_id` line in the config file) is set.

## Related

- [`tenki` on PyPI](https://pypi.org/project/tenki/) and its source, [LuxorLabs/tenki-sdk-python](https://github.com/LuxorLabs/tenki-sdk-python)
- Official SDK and full API: [tenki.cloud/docs/sandbox/sdk](https://tenki.cloud/docs/sandbox/sdk)
- Tenki docs: https://tenki.cloud/docs
- [`run-code-in-a-sandbox`](../run-code-in-a-sandbox/): the same loop in Node
- [`crewai-code-interpreter`](../crewai-code-interpreter/): a CrewAI code-interpreter tool that runs Python in a Tenki sandbox, verified through the same `verify.mjs` shim
