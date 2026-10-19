# How to run each Prefect flow run in its own Tenki sandbox

**Audience:** Prefect 3.x users who want every flow run to execute in its own fresh VM.
**Time:** ~15 minutes, including a smoke check that boots a sandbox. A real flow run also needs a Tenki image with Prefect in it, so add however long that takes you to build.
**Outcome:** a Prefect work pool of type `tenki` whose worker creates one disposable [Tenki](https://tenki.cloud) sandbox per flow run, runs the flow there, and closes the sandbox when the run ends.

> **Honesty note:** this repo can't run a real Prefect flow for you. A flow run needs a Tenki image or snapshot with Prefect and your flow's dependencies installed (the plugin doesn't ship a ready-made one yet), and a Prefect API the sandbox can reach. The smoke check in Step 10 tests the Tenki side of the worker without either.

In [Prefect 3.x](https://docs.prefect.io), a *worker* polls a *work pool* and provisions infrastructure for each flow run. [`prefect-tenki`](https://github.com/luxorlabs/tenki-prefect) adds a worker type `tenki` that makes that infrastructure a Tenki sandbox: a fresh Linux VM with real root, created when the worker picks up the run and destroyed when the run finishes.

## Prerequisites

- Python 3.10 or newer, and uv (or the standard `venv` module and pip).
- git, because `prefect-tenki` installs from a git URL.
- A Tenki API key (starts with `tk_`) from https://app.tenki.cloud.
- Node, only if you run the smoke check through `verify.mjs`.
- For a real flow run: Prefect Cloud or a Prefect server on an address the sandbox can reach, a Tenki image or snapshot with Prefect and your flow's dependencies installed, and a git repo holding your flow code.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/prefect-tenki
```

Every later command runs from this directory.

## Step 2 — Install

```bash
uv venv                                 # or: python3.11 -m venv .venv
uv pip install -r requirements.txt      # prefect-tenki (from git) + prefect + tenki SDK
# without uv: .venv/bin/pip install -r requirements.txt
source .venv/bin/activate
```

[`requirements.txt`](requirements.txt) is one line:

```text
prefect-tenki @ git+https://github.com/opencolin/tenki-prefect.git@4517af56a0921e8b233ebb76c22f6dd733a908e8
```

> **Not on PyPI yet.** `prefect-tenki` is pre-alpha (`0.1.0.dev0`) and installs from git. `requirements.txt` pins commit `4517af56`, the head of [LuxorLabs/tenki-prefect#7](https://github.com/LuxorLabs/tenki-prefect/pull/7). That pull request is still open, so the commit is on `opencolin/tenki-prefect` until it lands on `LuxorLabs/tenki-prefect`.

The plugin brings in `prefect>=3.7.2,<4` and `tenki>=1.4.1`, with no upper cap on `tenki`. `LuxorLabs/tenki-prefect` at `1778874` still requires `tenki>=0.5.4,<0.6`, and `tenki` 0.5.4 fails at command start with `UnauthorizedError: missing session credential`. #7 only changes that requirement.

Installing the package registers the `tenki` worker type through a `prefect.collections` entry point. To confirm the install, run:

```bash
python -c "import prefect_tenki; print(prefect_tenki.TenkiWorker.type)"
```

It prints `tenki`.

## Step 3 — Authenticate

```bash
export TENKI_API_KEY=tk_...             # from the Tenki dashboard
```

The smoke check reads the key from `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`, or falls back to the key that `tenki login --api-key <key>` stored in `~/.config/tenki/config.yaml`. The worker gets its key from a Prefect block instead, which you save in Step 6.

The smoke check needs nothing beyond this step. If that's all you want, skip to Step 10.

## Step 4 — Point Prefect at an API the sandbox can reach

The worker runs Prefect's prepared `prefect flow-run execute` command inside the sandbox, so the flow run talks to the Prefect API from the sandbox. `http://localhost:4200` only exists on your laptop. Use Prefect Cloud, or a Prefect server on a real address:

```bash
prefect cloud login
# or, for your own server:
prefect config set PREFECT_API_URL=https://<your-prefect-server>/api
```

## Step 5 — Create a work pool

```bash
prefect work-pool create --type tenki my-tenki-pool
```

## Step 6 — Save your Tenki key as a block

The API key lives in a Prefect `TenkiCredentials` block. Only the worker process uses it, to call the Tenki API. It is never injected into the guest VM's environment.

Run this with `python` from the activated venv. It saves the block to the Prefect API you set in Step 4.

```python
from prefect_tenki import TenkiCredentials

TenkiCredentials(api_key="tk_...").save("tenki-prod")
```

## Step 7 — Set the pool's job variables

Edit the pool in the Prefect UI, or write a base job template and apply it with `prefect work-pool update my-tenki-pool --base-job-template <file>`. `prefect work-pool get-default-base-job-template --type tenki` prints the full template. `credentials` is the one required variable: point it at the `tenki-prod` block.

These are the variables and defaults from the plugin's [`worker.py`](https://github.com/opencolin/tenki-prefect/blob/4517af56a0921e8b233ebb76c22f6dd733a908e8/src/prefect_tenki/worker.py):

| Variable | Default | Notes |
| --- | --- | --- |
| `credentials` | required | A `TenkiCredentials` block. |
| `workspace_id` | unset | Optional. Leave it unset to use the workspace your API key belongs to. |
| `cpu_cores` | `2` | 1 to 16. |
| `memory_mb` | `4096` | 128 to 65536, an even number. |
| `disk_size_gb` | unset | 5 to 100. |
| `image` | unset | A Tenki image with Prefect and your flow's dependencies. Set `image` or `snapshot_id`, not both. |
| `snapshot_id` | unset | A Tenki snapshot to boot instead of an image. |
| `allow_inbound` | `false` | |
| `allow_outbound` | `true` | Keep it on so the flow run can reach the Prefect API and your code source. |
| `max_duration_seconds` | `3600` | At least 60. Server-side cap on the sandbox's lifetime. |
| `create_timeout_seconds` | `180` | How long the worker waits for the sandbox to start. |
| `command_timeout_seconds` | `3600` | Time limit for the flow-run command. |
| `stream_output` | `true` | Forwards the guest's stdout and stderr to the worker's logs. |
| `metadata` | `{}` | String key-value metadata on the sandbox. The worker adds the run's labels and `prefect.io/worker-type: tenki`. |

> **The image must be able to run Prefect.** The guest VM pulls your flow code itself and runs it with Prefect. So the image or snapshot needs **Prefect and your flow's dependencies preinstalled**, and `allow_outbound: true` (the default) so it can **reach the Prefect API and your code source**.

## Step 8 — Start a worker

In a second terminal, from the same directory. Any machine with the venv and access to the block works, including your laptop:

```bash
source .venv/bin/activate
prefect worker start --pool my-tenki-pool
```

## Step 9 — Deploy and run a flow

Replace `https://github.com/you/your-repo` with a repo that has a `flows.py` defining the `hello` flow. The sandbox clones it, so the sandbox must be able to reach it.

```bash
python -c "
from prefect import flow

@flow(log_prints=True)
def hello(): print('hello from a Tenki sandbox')

hello.from_source('https://github.com/you/your-repo', entrypoint='flows.py:hello') \
    .deploy(name='hello-tenki', work_pool_name='my-tenki-pool')
"
prefect deployment run 'hello/hello-tenki'
```

Each run now gets its own sandbox. The worker creates it, waiting up to `create_timeout_seconds` (default 180 s). It streams the guest's output into the worker's logs as `Tenki stdout: …` and `Tenki stderr: …` lines, and closes the sandbox when the command exits.

What the worker guarantees on each run:

- **Credential isolation.** The API key goes only into the worker's SDK client. The guest's environment gets Prefect's own variables, never your Tenki credentials.
- **Cancellation-shielded cleanup.** Sandbox create and close run inside shielded scopes, so a cancelled or crashing run can't leak a VM mid-request. Teardown runs on success, failure and cancellation; only a forced kill of the worker process skips it (see Troubleshooting).
- **`kill_infrastructure`.** Cancelling a flow run in Prefect terminates the sandbox by ID. The sandbox ID is the run's infrastructure PID.
- **Server-side backstop.** `max_duration_seconds` (default 3600) ends the sandbox even if the worker dies.

## Step 10 — Check it works

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

[`verify.mjs`](verify.mjs) is a shim: it runs `verify.py` with `.venv/bin/python` if that exists, otherwise `$PYTHON` or `python3`. [`verify.py`](verify.py) points `PREFECT_HOME` at a temporary directory so your `~/.prefect` stays untouched, checks that the worker type registers as `tenki`, then drives `TenkiWorker.run()` directly with a stand-in command. This is the excerpt from `verify.py` that does it:

```python
    # Same shape a `prefect worker start` builds per flow run, minus the
    # Prefect-prepared `prefect flow-run execute` command.
    configuration = TenkiWorkerJobConfiguration(
        name="prefect-tenki-verify",
        command="set -eu; test \"$(python3 -c 'print(6*7)')\" = \"42\"; echo ok",
        credentials=credentials,
        workspace_id=workspace_id,
        cpu_cores=1,
        memory_mb=1024,
        allow_inbound=False,
        allow_outbound=False,
        max_duration_seconds=120,
        create_timeout_seconds=180,
        command_timeout_seconds=60,
        stream_output=True,
    )
    worker = TenkiWorker(work_pool_name="prefect-tenki-verify")
    result = await worker.run(object(), configuration)
    if result.status_code != 0:
        raise AssertionError(f"exit {result.status_code} (sandbox {result.identifier})")
    print("✓ prefect-tenki: TenkiWorker.run() → live sandbox → flow command exit 0 → teardown")
```

On success it prints:

```text
✓ prefect-tenki: TenkiWorker.run() → live sandbox → flow command exit 0 → teardown
```

A pass proves the Tenki side of the worker works with your key: it creates a live sandbox, runs a command in it, gets exit 0, and tears the sandbox down. It doesn't run a real flow, because CI can't: the guest must reach the Prefect API, and a localhost `prefect server` is unreachable from inside the sandbox. Network is off in the check, so it also doesn't test your image or the guest's route to Prefect. This is the same pattern as the plugin's own live smoke test, and the Prefect-side orchestration is covered by Prefect itself and the plugin's CI in [luxorlabs/tenki-prefect](https://github.com/luxorlabs/tenki-prefect).

## Troubleshooting

**❌ ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** The smoke check found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY` or `~/.config/tenki/config.yaml`. Export `TENKI_API_KEY=tk_...`, or run `tenki login --api-key <key>`.

**❌ `✗ RuntimeError: <n> workspaces accessible; set TENKI_WORKSPACE_ID.`** When it has no workspace ID to use, the smoke check asks Tenki which workspaces your key can see, and stops unless there is exactly one. Export `TENKI_WORKSPACE_ID=<workspace-id>`.

**❌ `✗ AssertionError: exit <code> (sandbox <id>)`.** The stand-in command exited non-zero inside the sandbox. The worker also logs a `Tenki command failed: exit_code=… signal=… reason=… errno=…` line with the exit code, signal and reason. Read the `Tenki stdout:` and `Tenki stderr:` lines the worker logged just before it (the check runs with `stream_output=True`) for the command's own error.

**❌ A real flow run fails, and the worker logs `Tenki command failed: exit_code=… signal=… reason=… errno=…`.** The `prefect flow-run execute` command failed inside the guest. Check the causes this guide warns about: the image lacks Prefect or your flow's dependencies, the Prefect API is a `localhost` address the sandbox can't reach, or `allow_outbound` is off so the guest can't reach Prefect or your code source. Fix the image or the job variables (Step 7), or move to Prefect Cloud or a reachable server (Step 4).

**❌ `Only one of image or snapshot_id may be configured.`** The pool's job variables set both. Keep one.

**❌ A sandbox is still running after you force-killed the worker.** A forced kill skips the worker's cleanup. `max_duration_seconds` ends the sandbox server-side when it runs out. To stop it sooner, terminate it from the Tenki dashboard.

## FAQ

**When shouldn't I use this?**
Don't use it when you need something stable: `prefect-tenki` is pre-alpha, installs from git, says its public API and packaging may change, and isn't an official Prefect-maintained integration. When your Prefect server only runs on `localhost`, because the sandbox can't reach it. When you don't want to build and maintain your own image or snapshot with Prefect in it. And when your flow runs are small and frequent enough that waiting for a fresh sandbox to boot on every run costs more than the isolation is worth.

**Does my Tenki API key end up inside the flow run?**
No. The `TenkiCredentials` block is read only by the worker, to call the Tenki API. The guest's environment gets Prefect's variables and nothing from the block.

**What happens when I cancel a flow run in Prefect?**
Prefect calls the worker's `kill_infrastructure`, which closes the sandbox whose ID is the run's infrastructure PID. If that sandbox is already gone, the worker reports it to Prefect as not found.

**Why does this install from a fork commit?**
`LuxorLabs/tenki-prefect` at `1778874` requires `tenki>=0.5.4,<0.6`, and `tenki` 0.5.4 fails at command start. [tenki-prefect#7](https://github.com/LuxorLabs/tenki-prefect/pull/7) moves the plugin to `tenki>=1.4.1` and does not change the worker. Until that pull request merges, the commit only exists on the fork named in `requirements.txt`.

**Can the worker run on my laptop?**
Yes. The worker only needs the venv and access to the credentials block. The Prefect API is the part that can't be on `localhost`.

## Related

- [luxorlabs/tenki-prefect](https://github.com/luxorlabs/tenki-prefect): the `prefect-tenki` plugin source, tests and live smoke test.
- [Prefect documentation](https://docs.prefect.io): work pools, workers and deployments.
- [Tenki documentation](https://tenki.cloud/docs).
- [`../covalent-tenki/`](../covalent-tenki/): the same one-sandbox-per-unit-of-work idea for Covalent tasks.
- [`../snapshots-pause-resume/`](../snapshots-pause-resume/): how Tenki snapshots work, if you want to boot flow runs from a `snapshot_id`.
