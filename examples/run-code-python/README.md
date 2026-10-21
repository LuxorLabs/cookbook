# Run code with Python

Boot a Tenki sandbox from Python, run `python3 -c "print(6 * 7)"` in it, print `exit 0 -> 42`, and terminate the sandbox. It uses only the official [`tenki`](https://pypi.org/project/tenki/) SDK. For the Node version, see [Run code in a sandbox](../run-code-in-a-sandbox/).

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "Run code with Python" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo and cd into examples/run-code-python.
2. Create a virtualenv on Python 3.10 or later (uv venv --python 3.12 if uv is installed) and install requirements.txt into it.
3. The script needs a Tenki API key (starts with tk_) in TENKI_API_KEY. If it isn't set, stop and ask me to export it (keys come from https://app.tenki.cloud). Never print the key or write it to a file.
4. Run .venv/bin/python run.py and confirm it prints "exit 0 -> 42", then run node verify.mjs.
5. If a step fails, use the Troubleshooting table in the example's README.md.
Then walk me through run.py and show me how to run my own code instead.
```

## Quick start

You need:

- Python 3.10 or later (the `tenki` package requires it). [uv](https://docs.astral.sh/uv/) is optional.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/run-code-python
uv venv --python 3.12
uv pip install -r requirements.txt   # tenki>=1.4.1
```

Without uv: `python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt`.

### 2. Set your API key

```bash
export TENKI_API_KEY=tk_...
```

`run.py` checks `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY`, then the key that `tenki login --api-key <key>` saves in `~/.config/tenki/config.yaml`. Tenki infers the workspace from the key. Set `TENKI_WORKSPACE_ID` only to pick one explicitly.

### 3. Run

```bash
.venv/bin/python run.py
```

```
exit 0 -> 42
```

### 4. Verify

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

```
✓ run-code-python: create → exec python3 → 42 → dispose
```

`verify.py` makes the same calls as `run.py` and asserts exit code `0` and stdout `42`. The `✓` prints after the sandbox is terminated, so a failed terminate also fails the check. `verify.mjs` is a shim for CI: it runs `verify.py` with `.venv/bin/python` if it exists, otherwise `$PYTHON` or `python3`.

## The code

The end of `run.py` does the work:

```python
# `Sandbox.create(...)` boots a sandbox and waits until it's RUNNING (~2s).
# The `with` block disposes it (terminates the VM) when the scope ends.
with Sandbox.create(**opts) as sandbox:
    # exec(command, *args) runs a bare binary + its args — no shell splitting,
    # so model-generated, multi-line code goes across as one `-c` argument.
    result = sandbox.exec("python3", "-c", "print(6 * 7)")
    print(f"exit {result.exit_code} -> {result.stdout_text.strip()}")  # exit 0 -> 42
```

`opts` is `{"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}`, plus `workspace_id` when one is set.

## Things to know

- **The `with` block terminates the sandbox**, even when the code inside raises. Without `with`, call `sandbox.terminate()` yourself. Sandboxes are billed per second.
- **`exec` takes arguments, not a command string.** Each argument passes through unchanged, so multi-line code needs no quoting. For shell syntax (`&&`, pipes, `$VAR`), run a shell: `sandbox.exec("sh", "-c", "echo hi && ls")`.
- **File methods are confined to `/home/tenki`.** Use relative paths. Commands run with `exec` can write anywhere.

## Troubleshooting

| Error | Fix |
| --- | --- |
| ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.`` or `missing auth token` | Export `TENKI_API_KEY` or run `tenki login --api-key <key>`. |
| `invalid auth token: expected an API key or service token starting with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `ModuleNotFoundError: No module named 'tenki'` | Run with `.venv/bin/python`, or activate `.venv`. |
| pip or uv can't satisfy `tenki>=1.4.1` | Your Python is older than 3.10. Recreate the venv with `uv venv --python 3.12`. |
| `permission_denied … path outside workdir` | Use a path under `/home/tenki` for SDK file calls. |
| `✗ AssertionError: unexpected result: exit …` | The sandbox booted but the command failed. The message includes its stdout and stderr. |

## Related

- [`tenki` on PyPI](https://pypi.org/project/tenki/) and [LuxorLabs/tenki-sdk-python](https://github.com/LuxorLabs/tenki-sdk-python)
- [Sandbox SDK guide](https://tenki.cloud/docs/sandbox/sdk)
- [Run code in a sandbox](../run-code-in-a-sandbox/): the same loop in Node
- [CrewAI](../crewai-code-interpreter/): an agent that runs its own Python in a sandbox, verified with the same shim
