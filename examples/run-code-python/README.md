# Run code in a Tenki sandbox (Python)

Boot a disposable microVM, run code in it, get the output, throw it away — the core [Tenki](https://tenki.cloud) loop, in ~15 lines with the official [`tenki`](https://tenki.cloud/docs/sandbox/sdk) Python SDK. The Python twin of [`run-code-in-a-sandbox`](../run-code-in-a-sandbox/) (Node).

## The code (`run.py`)

```python
from tenki import Sandbox

# `with` disposes (terminates) the sandbox when the scope ends.
with Sandbox.create(
    auth_token=token,          # a tk_ API key (see Setup below)
    workspace_id=workspace_id,
    cpu_cores=1,
    memory_mb=1024,
) as sandbox:
    # exec(command, *args) runs a bare binary + its args — no shell splitting.
    result = sandbox.exec("python3", "-c", "print(6 * 7)")
    print(f"exit {result.exit_code} -> {result.stdout_text.strip()}")  # exit 0 -> 42
```

`Sandbox.create(...)` boots the microVM and blocks until it's `RUNNING` (~2s). `exec(command, *args)` passes args straight through (no shell splitting), so multi-line, model-generated code goes across as one `-c` argument with no escaping surprises. Leaving the `with` block terminates the VM (`__exit__` → `close()`, aliased to `terminate` — a real `TerminateSession`), so you never leak a sandbox.

## Setup (Python 3.10+)

```bash
uv venv --python 3.12                      # or: python3.11 -m venv .venv
uv pip install -r requirements.txt         # the tenki SDK
export TENKI_API_KEY=tk_...                # a tk_ API key — the only credential the SDK accepts
python run.py                              # exit 0 -> 42
```

`run.py` falls back to `~/.config/tenki/config.yaml` (written by `tenki login --api-key <key>`) for the key and workspace, so with the CLI configured you can run it with no env vars.

## Verify it

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

`verify.py` runs the whole loop against a live sandbox and asserts `exit 0` / stdout `42`, then disposes — proving the Tenki-facing path with no model key. `verify.mjs` is a thin shim so the cookbook's Node CI harness can run the Python: it invokes `.venv/bin/python verify.py` (falling back to `python3`) and exits with its status. This is what CI runs.

## Notes

- **`exec(command, *args)` runs a bare binary + its args — no shell splitting.** For a shell one-liner, use `sandbox.exec("sh", "-c", "echo hi && ls")`.
- The sandbox boots in ~2s and is billed per second. The `with` block disposes it automatically; or call `sandbox.terminate()` explicitly.
- Requires **Python 3.10+**; the rest of the cookbook is Node, so this example is verified via the `verify.mjs` → `verify.py` shim (the same pattern as [`crewai-code-interpreter`](../crewai-code-interpreter/)).
- Tenki confines file I/O to `/home/tenki` — write to relative paths.
- Official SDK + full API: [tenki.cloud/docs/sandbox/sdk](https://tenki.cloud/docs/sandbox/sdk).
