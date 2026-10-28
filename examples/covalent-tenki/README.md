# Covalent

Run each step of a Python workflow on its own fresh cloud machine, created when the step starts and deleted when it ends.

[Covalent](https://github.com/AgnostiqHQ/covalent) is an open-source Python tool for running workflows: you split a job into Python functions, mark which ones are steps, and Covalent runs them in order, sending each step to wherever you tell it to run. Covalent has its own names for these pieces:

- An **electron** is one step: a Python function decorated with `@ct.electron`.
- A **lattice** is the workflow: a function decorated with `@ct.lattice` that calls electrons.
- An **executor** decides where an electron runs. The default runs it on your machine.
- The **dispatcher** is a local Covalent server, started with `covalent start`, that runs your workflows and hands each electron to its executor.

The [`covalent-tenki-plugin`](https://github.com/LuxorLabs/tenki-covalent-plugin) adds one more executor, `TenkiExecutor`. Every electron that uses it runs in a new Tenki sandbox, a disposable Linux VM with root access, so steps can't interfere with each other. That suits steps that run code you don't trust, and steps whose dependencies conflict.

In this example, one electron installs `numpy` in a sandbox, computes √(0 + 1 + … + 99), and returns about 70.36.

> **Status:** the plugin's 0.1.1 release isn't on PyPI yet, and 0.1.0 no longer installs, so the install step fails until 0.1.1 ships ([tenki-covalent-plugin#1](https://github.com/LuxorLabs/tenki-covalent-plugin/pull/1)).

<!-- When covalent-tenki-plugin 0.1.1 is on PyPI: delete the Status note, the first Troubleshooting row, and the "until 0.1.1" clause in the tenki-sandbox row; then unskip examples/covalent-tenki/ in .github/workflows/verify.yml. When tenki-covalent-plugin#1 merges, delete the sentence in "The workflow" saying the plugin README's table predates 0.1.1. -->

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "Covalent" example from https://github.com/LuxorLabs/cookbook, which runs each Covalent task in its own Tenki sandbox.
1. Clone the repo and cd into examples/covalent-tenki. Check the README's Status note: if covalent-tenki-plugin 0.1.1 still isn't on PyPI, tell me and stop.
2. Create a .venv there on Python 3.12 (the sandbox's version) and install requirements.txt.
3. It needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) exported in the shell. If it isn't set, stop and ask me to export it. Never print the key or write it to a file.
4. Run node verify.mjs, then covalent start and python workflow.py from that same shell, and confirm the result is about 70.36. Run covalent stop when it's done.
5. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- Python 3.12 for the workflow. The executor packs each step up on your machine and unpacks it in the sandbox (with `cloudpickle`), which only works when both sides run the same Python version, and the default sandbox image has 3.12. `verify.py` runs on 3.10 or later.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/covalent-tenki
uv venv --python 3.12                   # or: python3.12 -m venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt      # covalent-tenki-plugin>=0.1.1, tenki>=1.4.1
```

The plugin brings in `covalent` and `cloudpickle`. Keep the `>=0.1.1` minimum: 0.1.0 depends on `tenki-sandbox`, an old package name that no longer installs.

### 2. Set your API key

Export it in the terminal where you'll run `covalent start`:

```bash
export TENKI_API_KEY=tk_...
```

The executor runs inside the dispatcher, so the dispatcher needs the key in its environment when it starts. It reads only `TENKI_API_KEY` or `TENKI_AUTH_TOKEN`. `verify.py` also accepts a key saved with `tenki login --api-key <key>`, but the executor doesn't.

### 3. Verify

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

```
✓ covalent-tenki: TenkiExecutor imports + a task-style command ran in a live Tenki sandbox → 42
```

`verify.py` checks the Tenki side without starting Covalent: it creates a `TenkiExecutor`, starts a sandbox, runs `python3 -c "print(6 * 7)"`, and deletes the sandbox. `verify.mjs` is the wrapper CI runs; it calls `verify.py` with `.venv/bin/python`, `$PYTHON`, or `python3`.

### 4. Run the workflow

```bash
covalent start
python workflow.py
```

`covalent start` starts the dispatcher in the background. `workflow.py` sends it the workflow and prints `dispatched:` with an ID for the run. It then waits 2 to 3 minutes while the step's sandbox starts and installs Python packages, and prints `result:` and √4950, about 70.36. Stop the dispatcher with `covalent stop`.

## The workflow

`workflow.py` defines one electron, `sqrt_of_sum`, sends it to Tenki, and wraps it in a one-step lattice. This is the file without the bug workaround described [below](#covalent-422-workaround):

```python
import covalent as ct

# … the Covalent 422 workaround (see below) …

from covalent_tenki_plugin import TenkiExecutor  # noqa: E402 (after the patch)

# Every electron that uses this executor runs in its own new Tenki sandbox.
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

`TenkiExecutor` sets each step's VM size and `sandbox_requirements`, a space-separated list of pip packages to install in the VM before the step runs. Only electrons with `executor=tenki` run on Tenki; the rest use Covalent's default. See the [plugin README](https://github.com/LuxorLabs/tenki-covalent-plugin) for every argument. Its table on `main` predates 0.1.1: where it lists `project_id`, 0.1.1 takes an optional `workspace_id` (default: the first workspace on your key).

## How it works

For each electron, the executor:

1. Creates a sandbox named `covalent-<dispatch_id>-<node_id>`, tagged `covalent`. Tenki deletes it after `sandbox_max_duration_seconds` (default 3600) no matter what, so a crashed dispatcher can't leave a VM running and billing.
2. Sets up a Python virtual environment at `/home/tenki/.covalent-venv` with `cloudpickle`, the same `covalent` version you have locally, and your `sandbox_requirements`, and checks that the Python versions match. Passing `image` skips this.
3. Packs up the function and its arguments with `cloudpickle`, sends them to the sandbox through Tenki's command API (no SSH or file storage needed), runs the function, and brings back its return value. If the function raised an exception, the same exception is raised on your side.
4. Deletes the sandbox.

The dispatcher keeps running other steps while one is in a sandbox, because the executor makes its Tenki calls on a separate thread.

## Covalent 422 workaround

This is a Covalent bug, not a Tenki one. With `covalent` 0.240.0 and `requests>=2.34`, every `ct.dispatch()` fails with `422 Unprocessable Entity`, because Covalent sends the workflow to the dispatcher without a `Content-Type: application/json` header. `workflow.py` applies the [workaround from the plugin README](https://github.com/LuxorLabs/tenki-covalent-plugin#known-upstream-issue-unrelated-to-this-plugin) right after `import covalent`. Delete it once Covalent fixes the bug:

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

Setting up Python in each new sandbox (step 2 above) takes a couple of minutes and happens once per electron, so it adds up across many short steps.

- **Batch small steps** into fewer electrons.
- **Use a prepared image.** `TenkiExecutor(image=…)` boots from an image you've already set up and skips that step. The image must have a venv at exactly `/home/tenki/.covalent-venv` with `cloudpickle`, your dispatcher's `covalent` version, your task's dependencies, and a matching Python minor version. `sandbox_requirements` is ignored when `image` is set.

## Limits

- Arguments and results travel through Tenki's command API, so a result of tens of MB can hit message-size limits. Write large artifacts to external storage from inside the task.
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
