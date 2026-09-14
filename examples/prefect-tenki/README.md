# Prefect flow runs on Tenki

Run [Prefect 3.x](https://docs.prefect.io) flow runs where **each flow run executes in its own disposable [Tenki](https://tenki.cloud) microVM** — a fresh Linux VM with real root, created when the run is scheduled and destroyed the moment it finishes. In Prefect 3.x, a *worker* polls a *work pool* and provisions infrastructure per flow run; [`prefect-tenki`](https://github.com/luxorlabs/tenki-prefect) adds a worker type `tenki` that makes that infrastructure a Tenki sandbox.

> **Not on PyPI yet.** `prefect-tenki` is pre-alpha (`0.1.0.dev0`) and installs from git — [`requirements.txt`](requirements.txt) pins a known-good commit.

## Setup (Python 3.10+)

```bash
uv venv                                 # or: python3.11 -m venv .venv
uv pip install -r requirements.txt      # prefect-tenki (from git) + prefect + tenki SDK
export TENKI_API_KEY=tk_...             # from the Tenki dashboard
```

## Walkthrough

**1. Create a work pool.** Installing `prefect-tenki` registers the worker type via a `prefect.collections` entry point, so the CLI discovers it:

```bash
prefect work-pool create --type tenki my-tenki-pool
```

**2. Save credentials as a block.** The API key lives in a Prefect `TenkiCredentials` block, used only by the worker process to call the Tenki API — it is **never injected into the guest VM's environment**:

```python
from prefect_tenki import TenkiCredentials

TenkiCredentials(api_key="tk_...").save("tenki-prod")
```

**3. Set job variables** on the pool (UI or `prefect work-pool update`): `workspace_id`, sizing (`cpu_cores` default 2, `memory_mb` default 4096, optional `disk_size_gb`), and `image` *or* `snapshot_id`.

> **The image must be able to run Prefect.** Inside the sandbox the worker runs Prefect's prepared `prefect flow-run execute` command — the guest pulls your flow code itself. So the image/snapshot needs **Prefect + your flow's dependencies preinstalled**, and `allow_outbound: true` (the default) so it can **reach the Prefect API and your code source**. That also means the Prefect API must be reachable *from the microVM*: use Prefect Cloud or a server on a real address — `http://localhost:4200` only exists on your laptop.

**4. Start a worker** (any machine with the venv + credentials — your laptop works):

```bash
prefect worker start --pool my-tenki-pool
```

**5. Deploy and run:**

```bash
python -c "
from prefect import flow

@flow(log_prints=True)
def hello(): print('hello from a Tenki microVM')

hello.from_source('https://github.com/you/your-repo', entrypoint='flows.py:hello') \
    .deploy(name='hello-tenki', work_pool_name='my-tenki-pool')
"
prefect deployment run 'hello/hello-tenki'
```

Each run now gets its own microVM: the worker creates a sandbox (`create_timeout_seconds`, default 180 s), streams stdout/stderr into the flow-run logs, and closes it when the command exits.

## Lifecycle guarantees

- **Credential isolation** — the API key goes only into the worker's SDK client; the guest env gets Prefect's own variables, never your Tenki credentials.
- **Cancellation-shielded cleanup** — sandbox create/close run inside shielded scopes, so a cancelled or crashing run can't leak a VM mid-request; teardown always runs.
- **`kill_infrastructure`** — cancelling a flow run in Prefect terminates the sandbox by ID (the sandbox ID is the run's infrastructure PID).
- **Server-side backstop** — `max_duration_seconds` (default 3600) self-destructs the sandbox even if the worker dies. No leaked billing.

## Verify (fast smoke check)

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

CI can't run a real flow: the guest must reach the Prefect API, and a localhost `prefect server` is unreachable from inside the microVM. So [`verify.py`](verify.py) does what the upstream repo's own live smoke test does — checks the worker type registers, then drives **`TenkiWorker.run()` directly** with a stand-in command: create a live microVM → run it → assert exit 0 → teardown. That exercises everything Tenki-specific in the worker; the Prefect-side orchestration is covered by Prefect itself and the plugin's CI in [luxorlabs/tenki-prefect](https://github.com/luxorlabs/tenki-prefect).
