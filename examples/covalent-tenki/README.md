# Covalent

Run each [Covalent](https://github.com/AgnostiqHQ/covalent) task in its own Tenki sandbox. The [`covalent-tenki-plugin`](https://github.com/LuxorLabs/tenki-covalent-plugin) adds `TenkiExecutor`: every electron assigned to it runs in a fresh VM with root, created on demand and destroyed when the task finishes. Tasks can't leak state into each other, which suits untrusted steps and steps with conflicting dependencies.

> **Status:** `covalent-tenki-plugin` 0.1.1 isn't on PyPI yet ([tenki-covalent-plugin#1](https://github.com/LuxorLabs/tenki-covalent-plugin/pull/1)), and 0.1.0 no longer installs, so step 1 fails until 0.1.1 ships. CI skips this example until then.

<!-- When covalent-tenki-plugin 0.1.1 is on PyPI: delete the Status note, the first Troubleshooting row, and the "until 0.1.1" clause in the tenki-sandbox row; then unskip examples/covalent-tenki/ in .github/workflows/verify.yml. When tenki-covalent-plugin#1 merges, delete the sentence in "The workflow" saying the plugin README's table predates 0.1.1. -->

## Quick start

You need:

- Python 3.12 for the workflow. Tasks travel to the VM with `cloudpickle`, so your Python minor version must match the sandbox's (3.12 on the default image). `verify.py` runs on 3.10 or later.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/covalent-tenki
uv venv --python 3.12                   # or: python3.12 -m venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt      # covalent-tenki-plugin>=0.1.1, tenki>=1.4.1
```

The plugin brings in `covalent` and `cloudpickle`. Keep the `>=0.1.1` floor: 0.1.0 depends on `tenki-sandbox`, the SDK's old PyPI name.

### 2. Set your API key

Export it in the terminal where you'll start the dispatcher:

```bash
export TENKI_API_KEY=tk_...
```

The executor runs inside the dispatcher and reads only `TENKI_API_KEY` or `TENKI_AUTH_TOKEN`. `verify.py` also accepts a key saved with `tenki login --api-key <key>`, but the executor doesn't.

### 3. Verify

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

```
✓ covalent-tenki: TenkiExecutor imports + a task-style command ran in a live Tenki sandbox → 42
```

`verify.py` constructs a `TenkiExecutor`, then boots a sandbox, runs `python3 -c "print(6 * 7)"`, and terminates it. It doesn't dispatch a workflow. `verify.mjs` is a CI shim that runs it with `.venv/bin/python`, `$PYTHON`, or `python3`.

### 4. Run the workflow

```bash
covalent start
python workflow.py
```

`workflow.py` prints `dispatched:` and the dispatch ID, waits while the task's VM bootstraps (2 to 3 minutes on the default image), then prints `result:` and √4950, about 70.36. Stop the dispatcher with `covalent stop`.

## The workflow

`workflow.py`, without the 422 workaround below:

```python
import covalent as ct

# … the Covalent 422 workaround (Step 5) …

from covalent_tenki_plugin import TenkiExecutor  # noqa: E402 (after the patch)

# Each electron assigned this executor runs in a fresh Tenki sandbox.
tenki = TenkiExecutor(cpu_cores=2, memory_mb=4096, sandbox_requirements="numpy")


@ct.electron(executor=tenki)
def sqrt_of_sum(n):
    import numpy as np  # installed in the VM via sandbox_requirements
    return float(np.sqrt(sum(range(n))))


@ct.lattice
def workflow(n):
    return sqrt_of_sum(n)


if __name__ == "__main__":
    dispatch_id = ct.dispatch(workflow)(100)
    print("dispatched:", dispatch_id)
    result = ct.get_result(dispatch_id, wait=True)
    print("result:", result.result)  # sqrt(sum(0..99)) = sqrt(4950) ~= 70.36
```

`TenkiExecutor` sets each task's VM size and `sandbox_requirements`, a space-separated string of pip specs installed in the VM. Only electrons with `executor=tenki` run on Tenki. See the [plugin README](https://github.com/LuxorLabs/tenki-covalent-plugin) for every argument. Its table on `main` predates 0.1.1: where it lists `project_id`, 0.1.1 takes an optional `workspace_id` (default: the first workspace on your key).

For each electron, the executor:

1. Creates a sandbox named `covalent-<dispatch_id>-<node_id>`, tagged `covalent`, with a server-side lifetime of `sandbox_max_duration_seconds` (default 3600), so a crashed dispatcher can't leave it billing.
2. Bootstraps a venv at `/home/tenki/.covalent-venv` with `cloudpickle`, your dispatcher's `covalent` version, and `sandbox_requirements` (skipped when you pass `image`), and checks the Python version matches.
3. Sends the pickled function and arguments through the SDK's exec calls (no SSH or object storage) and reads back the result or re-raises the exception.
4. Terminates the sandbox.

The dispatcher stays responsive while tasks run, because the executor runs SDK calls in a thread.

## Covalent 422 workaround

With `covalent` 0.240.0 and `requests>=2.34`, every `ct.dispatch()` fails with `422 Unprocessable Entity`, because Covalent posts the manifest without a `Content-Type: application/json` header. `workflow.py` applies the [workaround from the plugin README](https://github.com/LuxorLabs/tenki-covalent-plugin#known-upstream-issue-unrelated-to-this-plugin) right after `import covalent`. Delete it once Covalent fixes the bug:

```python
from covalent._dispatcher_plugins import local as ldisp

_orig_post = ldisp.APIClient.post
def _patched_post(self, endpoint, **kw):
    if "data" in kw:
        kw.setdefault("headers", {})["Content-Type"] = "application/json"
    return _orig_post(self, endpoint, **kw)
ldisp.APIClient.post = _patched_post
```

## Cut the cold start

The bootstrap runs once per electron, so it adds up across many short tasks.

- **Batch small steps** into fewer electrons.
- **Use a prepared image.** `TenkiExecutor(image=…)` skips the bootstrap. The image must have a venv at exactly `/home/tenki/.covalent-venv` with `cloudpickle`, your dispatcher's `covalent` version, your task's dependencies, and a matching Python minor version. `sandbox_requirements` is ignored when `image` is set.

## Limits

- Payloads and results travel through exec calls, so a result of tens of MB can hit message-size limits. Write large artifacts to external storage from inside the task.
- Covalent's cancel API isn't wired up. `task_timeout_seconds` (default 1800) stops a runaway task, and `sandbox_max_duration_seconds` is the backstop.
- Every task starts in a clean VM. The plugin doesn't use volumes or snapshots for shared caches.

## Troubleshooting

Task-time errors appear in the Covalent UI at http://localhost:48008. `workflow.py` prints `result: None` for a failed task.

| Problem | Fix |
| --- | --- |
| Install can't resolve `covalent-tenki-plugin>=0.1.1` | 0.1.1 isn't on PyPI yet. Wait for the release. |
| Install can't resolve `tenki-sandbox` | You're installing plugin 0.1.0. Install from `requirements.txt` (0.1.1 or later, once it's on PyPI). |
| `422 Unprocessable Entity` on every `ct.dispatch()` | Apply the workaround above. |
| ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.`` | Export `TENKI_API_KEY` or run `tenki login --api-key <key>`. |
| `invalid auth token: expected an API key or service token starting with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `missing auth token: set TENKI_AUTH_TOKEN or TENKI_API_KEY` | The dispatcher started without the key. `covalent stop`, export `TENKI_API_KEY`, `covalent start`, and dispatch again. |
| `CommandFailedError: … bash -lc sudo apt-get update -qq && …` | The bootstrap failed or exceeded `bootstrap_timeout_seconds` (default 600). Check `sandbox_requirements` or raise the timeout. |
| `RuntimeError: Python version mismatch: local X.Y vs sandbox 3.12` | Recreate the venv with Python 3.12 and restart the dispatcher. |
| `RuntimeError: Task script failed in sandbox … (exit …)` | The message ends with the task's stderr. If it ran about `task_timeout_seconds`, raise that and keep `sandbox_max_duration_seconds` above bootstrap plus runtime. |

## Related

- [`covalent-tenki-plugin`](https://pypi.org/project/covalent-tenki-plugin/) and [LuxorLabs/tenki-covalent-plugin](https://github.com/LuxorLabs/tenki-covalent-plugin)
- [Covalent](https://github.com/AgnostiqHQ/covalent)
- [Run code with Python](../run-code-python/)
- [`tenki` on PyPI](https://pypi.org/project/tenki/) and the [Tenki docs](https://tenki.cloud/docs)
