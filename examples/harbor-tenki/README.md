# Harbor

Run [Harbor](https://github.com/harbor-framework/harbor) agent evals with each trial in its own Tenki VM. Harbor, from the creators of [Terminal-Bench](https://www.tbench.ai), runs a coding agent (Claude Code, Codex, OpenCode, Goose, mini-swe-agent, Terminus, and others) against a benchmark's tasks, grades every attempt with the task's own tests, and records the trajectory. [`tenki-harbor`](https://github.com/LuxorLabs/tenki-harbor) adds Tenki as a Harbor environment, so trials run in parallel, one VM each, with the task's container running under Docker inside.

## Quick start

You need:

- Python 3.12 or later and [uv](https://docs.astral.sh/uv/).
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- A model API key for the agent you run (Anthropic for Claude Code), for step 4 only.

### 1. Install Harbor with the Tenki environment

`tenki-harbor` installs from GitHub:

```bash
uv tool install harbor \
  --with "tenki-harbor @ git+https://github.com/LuxorLabs/tenki-harbor" \
  --with-executables-from tenki-harbor
```

This gives you `harbor` (0.23.x, which `tenki-harbor` pins) with the Tenki environment, plus the `tenki-harbor` command for snapshots and cleanup.

To work from this folder instead, with `tenki-harbor` pinned to a commit:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/harbor-tenki
uv venv --python 3.12 && uv pip install -r requirements.txt
source .venv/bin/activate
```

### 2. Set your API key

```bash
export TENKI_API_KEY=tk_...   # TENKI_AUTH_TOKEN also works
```

`harbor run` reads the key from the environment only and exits in preflight without it. A `tenki login` key isn't enough, except for `verify.py`.

### 3. Run one trial with no model

```bash
harbor run -t hello-world/hello-world -e tenki_harbor:TenkiEnvironment --agent oracle
```

The `oracle` agent runs the task's reference solution, so no model key is needed. It creates a VM, runs and grades the task, prints a mean reward of `1.000`, and terminates the VM in under a minute.

### 4. Run a benchmark with an agent

```bash
export ANTHROPIC_API_KEY=sk-ant-...
harbor run -d terminal-bench@2.0 -e tenki_harbor:TenkiEnvironment \
  --agent claude-code --model anthropic/claude-opus-4-1 \
  --n-concurrent 16 -l 10
harbor view jobs
```

This runs Claude Code on the first 10 Terminal-Bench 2.0 tasks, 16 at a time. Drop `-l` to run all 89. `--ae KEY=value` passes extra variables to the agent. Results go to `jobs/`, and `harbor view` serves a local browser for the trajectories.

The same run as a job config, [`job.yaml`](job.yaml), run with `harbor run -c job.yaml`:

```yaml
# Claude Code on the first 10 Terminal-Bench 2.0 tasks, one Tenki VM per trial.
#
#   export TENKI_API_KEY=tk_...
#   export ANTHROPIC_API_KEY=sk-ant-...
#   harbor run -c job.yaml
n_concurrent_trials: 16
environment:
  import_path: tenki_harbor:TenkiEnvironment
  delete: true
agents:
  - name: claude-code
    model_name: anthropic/claude-opus-4-1
datasets:
  - name: terminal-bench
    version: "2.0"
    n_tasks: 10 # remove to run all 89 tasks
```

With the `oracle` agent on all 89 Terminal-Bench 2.0 tasks, 79 pass on Tenki. The other 10 fail because of the tasks themselves; the [tenki-harbor README](https://github.com/LuxorLabs/tenki-harbor#terminal-bench-20-results) lists each reason.

### 5. Verify

```bash
node verify.mjs        # or: .venv/bin/python verify.py
```

```
✓ harbor-tenki: TenkiEnvironment loads → harbor run hello-world (oracle) on a Tenki VM → reward 1.0 → session terminated
```

`verify.py` uses the folder's `.venv`. It checks that `TenkiEnvironment` loads, runs step 3, asserts a reward of `1.0`, and checks that the trial's session (tagged `harbor`) was terminated. The last word may read `terminating` if the VM is still shutting down. It takes about 45 seconds and reads `TENKI_API_KEY`, `TENKI_AUTH_TOKEN`, or a `tenki login` key.

## How each trial runs

1. Create a Tenki session sized to the task's CPU, memory, and storage (2 vCPU and 4 GB if unset), tagged `harbor` with the Harbor session id in its metadata.
2. Install and start Docker (about 12 s on the base image).
3. Pull the task's image, or build its Dockerfile in the VM.
4. Route Harbor's `exec` and file transfers into the container with `docker exec` and `docker cp`.
5. Terminate the session when the trial ends, pass or fail.

### Environment options

Pass with `--ek key=value` or under `environment.kwargs`.

| Option | Default | |
| --- | --- | --- |
| `max_duration_sec` | `7200` | Hard VM lifetime, so a crashed run can't leak a VM. Must cover build + agent + tests, and is capped by the workspace limit. |
| `disk_size_gb` | task storage + 30 GB, min 50 | VM disk, which also holds the image layers. |
| `snapshot_id` / `image` | `TENKI_HARBOR_SNAPSHOT_ID`, else the Tenki base image | Start from a snapshot or a Tenki image (one or the other). |
| `base_url` | `TENKI_API_ENDPOINT` or `https://api.tenki.cloud` | Tenki API endpoint. |

### What's supported

| Feature | Status |
| --- | --- |
| Prebuilt `docker_image` tasks (all of Terminal-Bench 2.0) | Yes |
| Dockerfile tasks (built in the VM) | Yes |
| `network_mode = "no-network"`, including switching between phases | Yes |
| `docker-compose.yaml` tasks, network allowlists | Not yet; rejected with an error |
| GPUs, Windows containers | No |
| Up to 16 vCPU, 64 GB memory, 100 GB disk per trial | Larger requests are rejected, not shrunk |

## Start trials faster from a snapshot

Bake Docker into a [snapshot](https://tenki.cloud/docs/sandbox/snapshots) once per workspace:

```bash
tenki-harbor prepare
export TENKI_HARBOR_SNAPSHOT_ID=<printed snapshot id>
```

Trials then start from that snapshot unless you pass `image` or `snapshot_id`. On Terminal-Bench this cut median environment setup from 28 s to 19 s.

## Clean up an interrupted run

VMs stop at `max_duration_sec` (2 hours by default) even if Harbor is killed, or if you run with `--no-delete` / `delete: false`. To end them sooner:

```bash
tenki-harbor sessions   # list active Harbor sessions
tenki-harbor cleanup    # terminate them
```

`cleanup` terminates every active session tagged `harbor` in the workspace, including other jobs' and leftover `prepare` VMs.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Tenki requires TENKI_API_KEY (or TENKI_AUTH_TOKEN). …` | Export `TENKI_API_KEY` in the shell that runs `harbor`. |
| ``No token. Set TENKI_API_KEY, or run `tenki login`.`` | `verify.py` found no key. Export one or run `tenki login --api-key <key>`. |
| `ModuleNotFoundError: No module named 'harbor'` from `node verify.mjs` | Create the `.venv` here and install `requirements.txt`, or set `PYTHON`. |
| `Tenki does not support docker-compose tasks yet …` | Use a different Harbor environment for that task. |
| `Task asks for N CPUs; Tenki VMs have at most 16.` (or memory over 64 GB, disk over 100 GB) | Lower the request with `--override-cpus` / `--override-memory-mb`, or set `--ek disk_size_gb=<n>` (up to 100). |
| `Pass at most one of image and snapshot_id.` | Pass one. |
| `Tenki session for <trial> is '<STATE>', expected terminated` | Check with `tenki-harbor sessions`; end it with `tenki-harbor cleanup`. |

To run one model through several harnesses and compare them, see [`tenki-harness-evals`](https://github.com/LuxorLabs/tenki-harness-evals). If your tasks run fine in local Docker and you don't need a VM per trial, Harbor's default environment needs no Tenki key.

## Related

- [Harbor on Tenki](https://tenki.cloud/docs/sandbox/harbor) in the Tenki docs
- [`tenki-harbor`](https://github.com/LuxorLabs/tenki-harbor) and [Harbor](https://github.com/harbor-framework/harbor)
- [Pause, snapshot, and resume](../snapshots-pause-resume/) and [Run code with Python](../run-code-python/)
