# Covalent workflows, each task in a Tenki sandbox

Run a [Covalent](https://github.com/AgnostiqHQ/covalent) workflow where **every electron (task) executes in its own disposable [Tenki](https://tenki.cloud) microVM** — a fresh Linux VM with real root, created on demand and destroyed the moment the task finishes. One task's environment can never leak into another's, so it's ideal for untrusted or dependency-conflicting steps. Built on the official [`covalent-tenki-plugin`](https://github.com/LuxorLabs/tenki-covalent-plugin).

## The executor

```python
import covalent as ct
from covalent_tenki_plugin import TenkiExecutor

tenki = TenkiExecutor(cpu_cores=2, memory_mb=4096, sandbox_requirements="numpy")

@ct.electron(executor=tenki)   # this task runs in a fresh Tenki sandbox
def sqrt_of_sum(n):
    import numpy as np
    return float(np.sqrt(sum(range(n))))

@ct.lattice
def workflow(n):
    return sqrt_of_sum(n)
```

Full runnable version in [`workflow.py`](workflow.py).

## Setup (Python 3.10+)

```bash
uv venv                                 # or: python3.11 -m venv .venv
uv pip install -r requirements.txt      # covalent-tenki-plugin + tenki-sandbox
export TENKI_AUTH_TOKEN=...             # see the auth note below
```

**Auth note.** The plugin authenticates via the `tenki-sandbox` SDK, which wants a **`tk_` API key** (`export TENKI_AUTH_TOKEN=tk_…`; `TENKI_API_KEY` is accepted too). A `tenki login` browser session token works too, but the Python SDK won't auto-detect it — prefix it **`cookie:<token>`** (`verify.py` does this for you). It's an SDK gap, not yours.

## Run the full workflow

```bash
covalent start          # the Covalent dispatcher
python workflow.py      # dispatches; each task runs in a Tenki microVM
```

> **Known upstream issue:** with the current `covalent` release (0.240.0) and `requests>=2.34`, every `ct.dispatch()` fails with a 422 — Covalent's SDK posts the dispatch manifest without a `Content-Type: application/json` header. It's Covalent, not this plugin; the plugin README documents a [one-line workaround](https://github.com/LuxorLabs/tenki-covalent-plugin#known-upstream-issue-unrelated-to-this-plugin).

> **Cold start:** on the default Ubuntu image each task spends ~2–3 min bootstrapping a venv (`cloudpickle` + `covalent` + your `sandbox_requirements`). Point `TenkiExecutor(image=…)` at a prepared registry image to skip it, or batch small steps into fewer electrons. Also: your **local Python minor version must match the sandbox's** (3.12 on the default image) — tasks travel via `cloudpickle`.

## Verify (fast smoke check)

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

`verify.py` checks the two things that actually break this walkthrough — the **plugin imports and constructs**, and the **live Tenki sandbox path** the executor runs on is healthy (create → exec → terminate) → `42`. It does **not** dispatch a full workflow (that needs the dispatcher + the ~2–3 min bootstrap above); the executor's internals are covered by the plugin's own CI in [LuxorLabs/tenki-covalent-plugin](https://github.com/LuxorLabs/tenki-covalent-plugin).

## Notes

- Each electron self-destructs server-side after `sandbox_max_duration_seconds` (default 3600) even if the dispatcher crashes — no leaked billing.
- Tasks ship over the SDK's exec data plane (no SSH, no object storage).
- Official plugin + full config: [github.com/LuxorLabs/tenki-covalent-plugin](https://github.com/LuxorLabs/tenki-covalent-plugin).
