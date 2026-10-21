# Prefect

Run each [Prefect 3.x](https://docs.prefect.io) flow run in its own Tenki sandbox. [`prefect-tenki`](https://github.com/luxorlabs/tenki-prefect) adds a `tenki` worker type: the worker polls a work pool, creates a fresh sandbox when it picks up a run, runs the flow there, and closes the sandbox when the run ends.

> **Status:** `prefect-tenki` is pre-alpha (`0.1.0.dev0`) and not on PyPI. `requirements.txt` installs it from git at commit `4517af56`, the head of [LuxorLabs/tenki-prefect#7](https://github.com/LuxorLabs/tenki-prefect/pull/7), which moves it to `tenki>=1.4.1`. That PR is still open, so the commit lives on `opencolin/tenki-prefect`.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up a Prefect work pool that runs each flow run in its own Tenki sandbox, following https://github.com/LuxorLabs/cookbook/tree/main/examples/prefect-tenki.
1. Clone https://github.com/LuxorLabs/cookbook, cd into examples/prefect-tenki, create a venv with uv venv, and run uv pip install -r requirements.txt.
2. It needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) exported in the shell. If it isn't set, stop and ask me to export it. Never print the key or write it to a file.
3. Run node verify.mjs and confirm the ✓ line.
4. For real flow runs, ask me which Prefect API to use (Prefect Cloud or a server the sandbox can reach, not localhost) and which Tenki image has Prefect installed. Then create the work pool, ask me to save the TenkiCredentials block myself, set the pool's credentials job variable, and start a worker.
5. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- Python 3.10 or later, [uv](https://docs.astral.sh/uv/) (or `venv` and pip), and git.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- For real flow runs: Prefect Cloud or a Prefect server the sandbox can reach, a Tenki image or snapshot with Prefect and your flow's dependencies, and a git repo with your flow code.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/prefect-tenki
uv venv
uv pip install -r requirements.txt   # prefect-tenki (from git), prefect>=3.7.2,<4, tenki>=1.4.1
source .venv/bin/activate
python -c "import prefect_tenki; print(prefect_tenki.TenkiWorker.type)"   # prints: tenki
```

### 2. Set your API key

```bash
export TENKI_API_KEY=tk_...   # TENKI_AUTH_TOKEN or a `tenki login` key also work
```

This is for `verify.mjs`. The worker reads its key from a Prefect block, set up in step 3.

### 3. Run

Point Prefect at an API the sandbox can reach. `http://localhost:4200` only exists on your machine:

```bash
prefect cloud login
# or: prefect config set PREFECT_API_URL=https://<your-prefect-server>/api
prefect work-pool create --type tenki my-tenki-pool
```

Save your key as a block. Only the worker uses it; it never reaches the sandbox's environment:

```python
from prefect_tenki import TenkiCredentials

TenkiCredentials(api_key="tk_...").save("tenki-prod")
```

Set the pool's `credentials` job variable to `tenki-prod`, and `image` (or `snapshot_id`) to an image with Prefect installed, in the Prefect UI or with `prefect work-pool update my-tenki-pool --base-job-template <file>`. Then start a worker and deploy a flow:

```bash
prefect worker start --pool my-tenki-pool
```

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

Replace the repo URL with one that has a `flows.py` defining `hello`. The worker logs the sandbox's output as `Tenki stdout: …` and `Tenki stderr: …` lines.

### 4. Verify

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

```text
✓ prefect-tenki: TenkiWorker.run() → live sandbox → flow command exit 0 → teardown
```

`verify.py` uses a temporary `PREFECT_HOME`, checks the worker type registers as `tenki`, and drives `TenkiWorker.run()` directly with a stand-in command, with network off:

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

It doesn't run a real flow, which needs the sandbox to reach a Prefect API, or test your image.

## Job variables

From the plugin's [`worker.py`](https://github.com/opencolin/tenki-prefect/blob/4517af56a0921e8b233ebb76c22f6dd733a908e8/src/prefect_tenki/worker.py). `prefect work-pool get-default-base-job-template --type tenki` prints the full template.

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

## What the worker does on each run

- **Credential isolation.** The key goes only into the worker's SDK client. The sandbox's environment gets Prefect's variables only.
- **Shielded cleanup.** Create and close run in cancellation-shielded scopes, and teardown runs on success, failure, and cancellation. Only a forced kill of the worker skips it.
- **Cancellation.** Cancelling a run in Prefect terminates its sandbox, whose ID is the run's infrastructure PID.
- **Backstop.** `max_duration_seconds` (default 3600) ends the sandbox even if the worker dies.

## Things to know

- The image must have Prefect and your flow's dependencies, and `allow_outbound: true` (the default) so the run can reach Prefect and your code.
- The worker can run on your laptop. Only the Prefect API can't be on `localhost`.
- Every run waits for a fresh sandbox to boot.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | Export `TENKI_API_KEY`, or run `tenki login --api-key <key>`. |
| `✗ RuntimeError: <n> workspaces accessible; set TENKI_WORKSPACE_ID.` | Export `TENKI_WORKSPACE_ID`. |
| `✗ AssertionError: exit <code> (sandbox <id>)` | Read the `Tenki stdout:` and `Tenki stderr:` lines logged just before it. |
| A real run fails with `Tenki command failed: exit_code=… signal=… reason=… errno=…` | Check the image has Prefect, the Prefect API isn't `localhost`, and `allow_outbound` is on. |
| `Only one of image or snapshot_id may be configured.` | Keep one. |
| A sandbox is still running after you force-killed the worker | `max_duration_seconds` ends it, or terminate it from the [Tenki dashboard](https://app.tenki.cloud). |

## Related

- [luxorlabs/tenki-prefect](https://github.com/luxorlabs/tenki-prefect) and the [Prefect docs](https://docs.prefect.io)
- [Covalent](../covalent-tenki/): one sandbox per Covalent task
- [Pause, snapshot, and resume](../snapshots-pause-resume/): boot runs from a `snapshot_id`
