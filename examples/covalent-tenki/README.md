# How to run each Covalent task in its own Tenki sandbox

**Audience:** Python developers who run workflows with [Covalent](https://github.com/AgnostiqHQ/covalent), or are evaluating it, and want individual tasks to run in their own disposable VM.
**Time:** ~10 minutes, including the task's VM bootstrap.
**Outcome:** `python workflow.py` dispatches a Covalent workflow whose task runs in a fresh Tenki microVM and prints its result (about 70.36). `node verify.mjs` prints a `✓` line.

> **Honesty note:** `covalent-tenki-plugin` 0.1.1 isn't on PyPI yet ([tenki-covalent-plugin#1](https://github.com/LuxorLabs/tenki-covalent-plugin/pull/1)), and 0.1.0 can't install, so Step 2 fails until 0.1.1 ships. Once it does, expect each task on the default Ubuntu image to spend up to ~2–3 minutes bootstrapping a Python venv (`cloudpickle`, `covalent`, and your `sandbox_requirements`) before your function runs. That's fine for a few heavy tasks and costly for many short ones. [Step 7](#step-7--cut-the-cold-start-optional) covers the ways around it.

<!-- When covalent-tenki-plugin 0.1.1 is on PyPI: delete the Honesty note's first sentence and start the next one with "Expect"; delete the last sentence of the Step 2 paragraph; delete the CI-skip paragraph at the end of Step 8; delete the Troubleshooting entry for "fails to resolve covalent-tenki-plugin>=0.1.1" and the trailing ", once 0.1.1 is on PyPI" in the tenki-sandbox entry; delete the first "When shouldn't I use this?" bullet; and unskip examples/covalent-tenki/ in .github/workflows/verify.yml. When tenki-covalent-plugin#1 merges, delete the Step 4 sentence saying the table on main predates 0.1.1. Keep the rest: the >=0.1.1 floor and its 0.1.0/tenki-sandbox reason in Step 2, the tenki-sandbox Troubleshooting entry, and the cold-start part of the Honesty note. -->

Covalent runs a workflow (a lattice) as a graph of tasks (electrons), and each electron can name the executor that runs it. The official [`covalent-tenki-plugin`](https://github.com/LuxorLabs/tenki-covalent-plugin) adds `TenkiExecutor`: every electron you assign to it executes in its own disposable [Tenki](https://tenki.cloud) microVM, a fresh Linux VM with real root, created on demand and destroyed the moment the task finishes. One task's environment can never leak into another's, so this suits untrusted steps and steps whose dependencies conflict.

## Prerequisites

- Python 3.12 for the full workflow. Tasks travel to the VM via `cloudpickle`, so your local Python minor version must match the sandbox's, which is 3.12 on the default image. Python 3.10 or newer is enough for the verify script.
- `uv`, or Python's built-in `venv`.
- A Tenki account and a `tk_` API key. Create one at https://app.tenki.cloud.
- Node.js, only if you run the check through the `node verify.mjs` shim.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/covalent-tenki
```

Every later command runs from this directory. It holds [`workflow.py`](workflow.py) (the workflow), [`verify.py`](verify.py) (a fast smoke check), `verify.mjs` (a Node shim that runs `verify.py`), and `requirements.txt`.

## Step 2 — Install

```bash
uv venv --python 3.12                   # or: python3.12 -m venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt      # or: pip install -r requirements.txt
```

`requirements.txt`:

```text
covalent-tenki-plugin>=0.1.1
tenki>=1.4.1
```

The plugin brings in `covalent` and `cloudpickle` itself. Keep the `>=0.1.1` floor: `covalent-tenki-plugin` 0.1.0 depends on `tenki-sandbox`, the SDK's old PyPI name (now `tenki`), so 0.1.0 no longer installs. 0.1.1, the plugin release on the renamed `tenki` SDK, isn't on PyPI yet, so until it's published this step fails to resolve `covalent-tenki-plugin>=0.1.1`.

## Step 3 — Authenticate

Export your key in the terminal where you'll start the Covalent dispatcher in Step 6:

```bash
export TENKI_API_KEY=tk_...
```

The executor runs inside the dispatcher, and it authenticates through the `tenki` Python SDK, which reads the key only from `TENKI_API_KEY` or `TENKI_AUTH_TOKEN`. SDK 1.x accepts only `tk_` keys. If the dispatcher starts without the variable, every task fails.

`tenki login --api-key <key>` stores the key in `~/.config/tenki/config.yaml`. `verify.py` reads it from there, but the executor doesn't, so export the variable for the full run even if you've logged in.

To confirm your key can boot a Tenki VM before you start the dispatcher, you can run [Step 8](#step-8--check-it-works) now.

## Step 4 — Read the workflow

From [`workflow.py`](workflow.py), everything after the module docstring:

```python
import covalent as ct
from covalent_tenki_plugin import TenkiExecutor

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

`TenkiExecutor` sets each task's VM size (2 CPU cores, 4096 MB here) and `sandbox_requirements`, a space-separated string of pip specs installed in the VM. The bootstrap also installs `cloudpickle` and `covalent`, pinned to your dispatcher's Covalent version. Only electrons that name `executor=tenki` run in Tenki. For every argument, see the [plugin README](https://github.com/LuxorLabs/tenki-covalent-plugin)'s configuration table. The table on `main` predates 0.1.1: where it lists `project_id`, 0.1.1 takes `workspace_id`, which is optional and defaults to the first workspace on your API key.

For each electron, the executor:

1. Creates a sandbox with the `tenki` SDK, named `covalent-<dispatch_id>-<node_id>` and tagged `covalent`. `sandbox_max_duration_seconds` (default 3600) is its server-side lifetime, so even if the dispatcher crashes, the VM self-destructs and can't keep billing.
2. Bootstraps a venv at `/home/tenki/.covalent-venv` (skipped when you pass `image`), then checks that the sandbox's Python minor version matches yours.
3. Sends the pickled function and arguments into the sandbox and reads the pickled result or exception back through the SDK's exec calls, so it needs no SSH and no object storage. If the task raised an exception, the executor re-raises it locally.
4. Terminates the sandbox, whether the task succeeded or failed.

## Step 5 — Work around the Covalent 422 bug

With the current `covalent` release (0.240.0) and `requests>=2.34`, every `ct.dispatch()` fails with `422 Unprocessable Entity`, and a fresh install picks up both versions. Covalent's SDK posts the dispatch manifest without a `Content-Type: application/json` header. The bug is in Covalent, not this plugin.

Add the [workaround from the plugin README](https://github.com/LuxorLabs/tenki-covalent-plugin#known-upstream-issue-unrelated-to-this-plugin) to `workflow.py`, above the `if __name__ == "__main__":` block. It patches the client that `ct.dispatch()` uses:

```python
from covalent._dispatcher_plugins import local as ldisp

_orig_post = ldisp.APIClient.post
def _patched_post(self, endpoint, **kw):
    if "data" in kw:
        kw.setdefault("headers", {})["Content-Type"] = "application/json"
    return _orig_post(self, endpoint, **kw)
ldisp.APIClient.post = _patched_post
```

## Step 6 — Start the dispatcher and run the workflow

In the terminal where you exported `TENKI_API_KEY`, with the venv active:

```bash
covalent start          # the Covalent dispatcher
python workflow.py      # dispatches; each task runs in a Tenki microVM
```

`workflow.py` prints `dispatched:` and the dispatch ID, then waits. The task's VM bootstraps first (the cold start in the Honesty note), and then the script prints `result:` followed by √4950, about 70.36.

When you're done, stop the dispatcher with `covalent stop`.

## Step 7 — Cut the cold start (optional)

The bootstrap runs once per electron, so it adds up across a workflow. You have two ways to cut it:

- Batch small steps into fewer electrons. Fewer electrons means fewer VMs to bootstrap.
- Pass `TenkiExecutor(image=…)` a prepared Tenki registry image. A non-empty `image` skips the bootstrap entirely, so the image must already hold what the bootstrap would install: a venv at exactly `/home/tenki/.covalent-venv` (the executor hard-codes that path) with `cloudpickle`, `covalent` at your dispatcher's version, and your task's own dependencies. The venv's Python minor version must match your dispatcher's. `sandbox_requirements` is only installed during the bootstrap, so with `image` set it has no effect.

## Step 8 — Check it works

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

`verify.mjs` runs `verify.py` with `.venv/bin/python` if that exists, otherwise with `$PYTHON` or `python3`. `verify.py` takes your key from `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`, then does this:

```python
# Construct the executor — proves the plugin's config surface is intact.
TenkiExecutor(cpu_cores=1, memory_mb=1024)

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

try:
    with Sandbox.create(**opts) as sb:
        r = sb.exec("python3", "-c", "print(6 * 7)")
        if r.stdout_text.strip() != "42":
            raise AssertionError(f"got {r.stdout_text!r}")
    print("✓ covalent-tenki: TenkiExecutor imports + a task-style command ran in a live Tenki sandbox → 42")
except Exception as e:  # noqa
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
```

On success it prints:

```
✓ covalent-tenki: TenkiExecutor imports + a task-style command ran in a live Tenki sandbox → 42
```

This proves the plugin installed, its `TenkiExecutor` constructs, and your key can create a Tenki sandbox, run a command in it, and terminate it. It doesn't dispatch a workflow, so it needs no dispatcher and skips the venv bootstrap, and it doesn't exercise the pickled-task round trip, the Python version check, or the 422 workaround. Step 6 is the real test of those. The executor's internals are covered by the plugin's own mocked unit tests in [LuxorLabs/tenki-covalent-plugin](https://github.com/LuxorLabs/tenki-covalent-plugin).

The cookbook's CI skips this example until `covalent-tenki-plugin` 0.1.1 is on PyPI, so a green CI run says nothing about it yet. Once 0.1.1 is on PyPI, run the check yourself.

## Troubleshooting

**❌ The install fails to resolve `covalent-tenki-plugin>=0.1.1`.** 0.1.1 isn't on PyPI yet ([tenki-covalent-plugin#1](https://github.com/LuxorLabs/tenki-covalent-plugin/pull/1)). Wait for the release.

**❌ The install fails to resolve `tenki-sandbox`.** You're installing `covalent-tenki-plugin` 0.1.0, which depends on the SDK's old PyPI name. Install from `requirements.txt`, which requires 0.1.1 or later, once 0.1.1 is on PyPI.

**❌ `422 Unprocessable Entity` on every `ct.dispatch()`.** The upstream Covalent bug. Apply the workaround in [Step 5](#step-5--work-around-the-covalent-422-bug).

**❌ ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.``** `verify.py` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export one, or run `tenki login --api-key <key>`.

The errors below are raised while a task runs. They appear in the Covalent UI at http://localhost:48008, not in `workflow.py`'s output, which prints only the dispatch ID and the `result:` line. For a failed task, that line reads `result: None`.

**❌ `invalid auth token: expected an API key or service token starting with tk_`.** SDK 1.x accepts only `tk_` API keys. `verify.py` prints this as `✗ InvalidAuthTokenError: …`. Create a key at https://app.tenki.cloud and use that.

**❌ `missing auth token: set TENKI_AUTH_TOKEN or TENKI_API_KEY`.** The dispatcher started from a shell without the key. A key stored by `tenki login` doesn't count for the executor. Run `covalent stop`, export `TENKI_API_KEY`, run `covalent start`, and dispatch again.

**❌ `CommandFailedError: command failed: exit_code=… argv='bash -lc sudo apt-get update -qq && …'`.** The VM bootstrap (apt-get, a venv, then a pip install of `cloudpickle`, `covalent` and your `sandbox_requirements`) failed, or ran past `bootstrap_timeout_seconds` (default 600). Check your `sandbox_requirements` specs, or raise `bootstrap_timeout_seconds`.

**❌ `RuntimeError: Python version mismatch: local X.Y vs sandbox 3.12`.** Your dispatcher's Python minor version differs from the sandbox's, and `cloudpickle` needs them to match. Recreate the venv with Python 3.12 (Step 2) and restart the dispatcher, or use an `image` whose `/home/tenki/.covalent-venv` Python matches yours.

**❌ `RuntimeError: Task script failed in sandbox … (exit …)`.** The task's script exited non-zero inside the VM, and the message ends with the tail of its stderr. If it failed after running for about `task_timeout_seconds` (default 1800), the timeout stopped it. Raise `task_timeout_seconds`, and keep `sandbox_max_duration_seconds` (default 3600) above bootstrap plus task runtime, as the executor's docstring requires.

## FAQ

**When shouldn't I use this?**

- Until `covalent-tenki-plugin` 0.1.1 is on PyPI: the install can't resolve yet (see the Honesty note).
- For workflows of many short electrons on the default image, where each one's venv bootstrap outweighs the work, unless you prepare an image (Step 7).
- When a task returns tens of MB or more: payloads and results travel through the SDK's exec calls and can hit message-size limits, so write large artifacts to external storage from inside the task.
- When you need to cancel a running task from Covalent: mid-task cancellation isn't wired to Covalent's cancel API. A runaway task is stopped by `task_timeout_seconds` (default 1800), and `sandbox_max_duration_seconds` (default 3600) is the server-side backstop.
- When tasks should share a warm cache: every task starts in a clean VM, and the plugin doesn't use Tenki volumes or snapshots.

**Does every electron get its own VM?** Every electron that names `executor=tenki` does, each time it runs. Electrons without it use Covalent's default executor.

**Can two tasks use conflicting dependencies?** Yes. Give each its own `TenkiExecutor` with its own `sandbox_requirements`. Each task installs them into its own VM.

**Does a running task block the dispatcher?** No. The executor runs the synchronous SDK calls in a thread, so the dispatcher keeps servicing other electrons.

## Related

- [Covalent](https://github.com/AgnostiqHQ/covalent)
- [`covalent-tenki-plugin`](https://pypi.org/project/covalent-tenki-plugin/) on PyPI, with source at [LuxorLabs/tenki-covalent-plugin](https://github.com/LuxorLabs/tenki-covalent-plugin)
- [tenki-covalent-plugin#1](https://github.com/LuxorLabs/tenki-covalent-plugin/pull/1): the 0.1.1 release on the renamed `tenki` SDK, including the configuration table with `workspace_id`
- [`tenki`](https://pypi.org/project/tenki/), the Tenki Python SDK, and the [Tenki docs](https://tenki.cloud/docs)
- [`../run-code-python/`](../run-code-python/): the Tenki Python SDK on its own, without Covalent
