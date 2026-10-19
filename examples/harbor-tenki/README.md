# How to run Harbor agent evals with each trial in its own Tenki VM

**Audience:** Developers who evaluate coding agents or models with [Harbor](https://github.com/harbor-framework/harbor), or want to run Terminal-Bench 2.0, and want every trial on its own VM instead of local Docker.
**Time:** ~5 minutes to install, run the no-model smoke test (under a minute), and run the verify script (about 45 s). A benchmark run with an agent takes longer.
**Outcome:** `harbor run -e tenki_harbor:TenkiEnvironment` gives every trial its own Tenki VM, grades it with the task's own tests, writes the results to `jobs/`, and terminates the VM. `node verify.mjs` prints a `✓` line.

> **Honesty note:** Harbor tasks are container images and a Tenki session is a full Linux VM, so each trial runs the task's container under Docker inside its VM. Tasks that ship a `docker-compose.yaml` or ask for a network allowlist are rejected with an error for now, and GPUs and Windows containers aren't supported.

Harbor is the open-source framework from the creators of [Terminal-Bench](https://www.tbench.ai) for evaluating coding agents and models. It runs an agent (Claude Code, Codex, OpenCode, Goose, mini-swe-agent, Terminus, …) against a benchmark's tasks, grades every attempt with the task's own tests, and records the full trajectory. [`tenki-harbor`](https://github.com/LuxorLabs/tenki-harbor) adds [Tenki Sandbox](https://tenki.cloud/docs/sandbox) as a Harbor environment, so every trial gets its own Tenki VM and trials run in parallel (the commands here run 16 at a time).

Harbor owns the evaluation: tasks, agents, attempts, grading, and results on disk. Tenki owns the machine.

## Prerequisites

- Python 3.12 or later and [uv](https://docs.astral.sh/uv/). Both `harbor` and `tenki-harbor` require Python 3.12+.
- A Tenki API key (`tk_…`). Create one at https://app.tenki.cloud.
- Node.js, only if you run the check through the `node verify.mjs` shim. CI runs it on Node 20.
- For Step 5 only: an API key for the model your agent uses. The example runs Claude Code, so an Anthropic key.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/harbor-tenki
```

Every later command runs from this directory. It holds [`job.yaml`](job.yaml) (a benchmark run as a job config), [`verify.py`](verify.py) (the check), `verify.mjs` (a Node shim that runs `verify.py`), and `requirements.txt`. Harbor writes results to `jobs/` under the current directory.

## Step 2 — Install Harbor with the Tenki environment

`tenki-harbor` is not on PyPI yet, so install it from GitHub alongside the `harbor` CLI:

```bash
uv tool install harbor \
  --with "tenki-harbor @ git+https://github.com/LuxorLabs/tenki-harbor" \
  --with-executables-from tenki-harbor
```

This gives you `harbor` with the Tenki environment loaded, plus the `tenki-harbor` command for snapshots and cleanup. `tenki-harbor` pins `harbor>=0.23,<0.24`, so you get Harbor 0.23.x.

To work from this folder instead, install its `requirements.txt` into a local venv:

```bash
uv venv --python 3.12 && uv pip install -r requirements.txt
```

`requirements.txt`:

```text
harbor>=0.23.0,<0.24
tenki-harbor @ git+https://github.com/LuxorLabs/tenki-harbor@b2d703898cc90918eb20ea134bd8619049d8d80d
tenki[async]>=1.4.1
```

It pins `tenki-harbor` to a fixed commit, where the `uv tool install` line above tracks its `main` branch. With the venv, the `harbor` and `tenki-harbor` commands are in `.venv/bin/`. Run `source .venv/bin/activate` so the `harbor` and `tenki-harbor` commands in the later steps resolve. Step 8 uses this venv.

## Step 3 — Authenticate

```bash
export TENKI_API_KEY=tk_...
```

**`tenki-harbor` reads the key from the environment only**, as `TENKI_API_KEY` or `TENKI_AUTH_TOKEN`, and the Tenki SDK accepts only `tk_` API keys. Harbor runs a preflight check before any trial and exits if neither variable is set, so the key the Tenki CLI saved with `tenki login` (in `~/.config/tenki/config.yaml`) is not enough for `harbor run`. Export it yourself. `verify.py` is the exception: it reads that saved key and exports it for you.

## Step 4 — Run one trial with no model

```bash
harbor run -t hello-world/hello-world -e tenki_harbor:TenkiEnvironment --agent oracle
```

`-e tenki_harbor:TenkiEnvironment` is how Harbor loads an environment from an installed package. The `oracle` agent runs the task's reference solution, so this needs no model key. It creates a VM, runs the task, grades it, prints a mean reward of `1.000`, and terminates the VM, in under a minute.

For each trial, `tenki-harbor`:

1. Creates a Tenki session sized to the task's CPU, memory and storage request. A task that sets no CPU or memory gets 2 vCPU and 4 GB.
2. Installs and starts Docker in the VM (about 12 s on the Tenki base image).
3. `docker pull`s the task's prebuilt image, or `docker build`s its Dockerfile in the VM.
4. Routes Harbor's `exec` and file transfers into that container (`docker exec` / `docker cp`).
5. Terminates the session when the trial ends, pass or fail.

Every session is tagged `harbor` and carries the Harbor session id in its metadata.

## Step 5 — Run a benchmark with an agent

```bash
export ANTHROPIC_API_KEY=sk-ant-...
harbor run -d terminal-bench@2.0 -e tenki_harbor:TenkiEnvironment \
  --agent claude-code --model anthropic/claude-opus-4-1 \
  --n-concurrent 16 -l 10
```

This runs Claude Code on the first 10 Terminal-Bench 2.0 tasks, one VM per task. `--n-concurrent` caps how many run at once, `-l` caps the task count (drop it for all 89), and `--ae KEY=value` passes extra variables to the agent.

The same run as a job config, in [`job.yaml`](job.yaml):

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

```bash
harbor run -c job.yaml
harbor view jobs          # every step of every trial
```

`harbor view` starts a local web server for browsing the trajectories under `jobs/`.

With Harbor's `oracle` agent on all 89 Terminal-Bench 2.0 tasks, 16 at a time, 79 pass on Tenki. The other 10 fail for reasons in the tasks themselves, not in Tenki. The [tenki-harbor README](https://github.com/LuxorLabs/tenki-harbor#terminal-bench-20-results) lists the reason for each.

### Environment options

Pass with `--ek key=value`, or under `environment.kwargs` in a job config.

| Option | Default | |
| --- | --- | --- |
| `max_duration_sec` | `7200` | Hard VM lifetime, so a crashed run can't leak a VM. Must cover build + agent + tests, and is capped by the workspace limit. |
| `disk_size_gb` | task storage + 30 GB, min 50 | VM disk, which also holds the image layers. |
| `snapshot_id` / `image` | `TENKI_HARBOR_SNAPSHOT_ID`, else the Tenki base image | Start from a snapshot or a Tenki image (one or the other). |
| `base_url` | `TENKI_API_ENDPOINT` or `https://api.tenki.cloud` | Tenki API endpoint. |

## Step 6 — Start trials faster from a snapshot (optional)

Each trial installs Docker in a fresh VM. Bake it into a Tenki [snapshot](https://tenki.cloud/docs/sandbox/snapshots) once per workspace instead:

```bash
tenki-harbor prepare
export TENKI_HARBOR_SNAPSHOT_ID=<printed snapshot id>
```

`prepare` creates a small VM, installs Docker, saves it as a snapshot, waits until the snapshot can be restored on any host, terminates the VM, and prints the `export` line. With `TENKI_HARBOR_SNAPSHOT_ID` set, every trial starts from that snapshot unless you pass `image` or `snapshot_id` yourself. On Terminal-Bench this took median environment setup from 28 s to 19 s ([tenki-harbor README](https://github.com/LuxorLabs/tenki-harbor#faster-startup)).

## Step 7 — Clean up after an interrupted run

If Harbor is killed mid-run, its VMs still stop at `max_duration_sec` (2 hours by default). To end them sooner:

```bash
tenki-harbor sessions   # list active Harbor sessions
tenki-harbor cleanup    # terminate them
```

**`cleanup` terminates every active session tagged `harbor` in the workspace**, including those of any other Harbor job running there. It also catches a VM left behind by an interrupted `tenki-harbor prepare`, which is tagged the same way.

The same lifetime applies if you run with `harbor run --no-delete` or `delete: false` in a job config: `tenki-harbor` leaves each VM running and logs a warning that it terminates after `max_duration_sec`. [`job.yaml`](job.yaml) sets `delete: true`.

## Step 8 — Check it works

If you didn't create the venv in Step 2, create it now:

```bash
uv venv --python 3.12 && uv pip install -r requirements.txt
```

Then run the check:

```bash
node verify.mjs        # or: .venv/bin/python verify.py
```

`verify.mjs` runs `verify.py` with this folder's `.venv/bin/python` if it exists, otherwise with `$PYTHON` or `python3`. The script uses `TENKI_API_KEY` or `TENKI_AUTH_TOKEN`, falling back to the key `tenki login` saved. It takes about 45 s and prints:

```
✓ harbor-tenki: TenkiEnvironment loads → harbor run hello-world (oracle) on a Tenki VM → reward 1.0 → session terminated
```

The last word reads `terminating` if Tenki is still shutting the VM down.

It runs the same smoke test as tenki-harbor's own CI: it checks that `TenkiEnvironment` imports as a Harbor environment, runs Step 4's `harbor run` against live Tenki, asserts the trial's reward is `1.0`, and checks that the trial's Tenki session (tagged `harbor`) ended up terminated. It needs no model key, so no agent or model runs, only the task's reference solution, and it runs one trial rather than a parallel benchmark.

## Troubleshooting

**❌ `Tenki requires TENKI_API_KEY (or TENKI_AUTH_TOKEN). Create a key at https://tenki.cloud/docs/account/api-keys.`** Harbor's preflight for the Tenki environment found neither variable, and it doesn't read the key `tenki login` saved. Run `export TENKI_API_KEY=tk_...` in the shell you run `harbor` from.

**❌ `` No token. Set TENKI_API_KEY, or run `tenki login`. ``** `verify.py` found no key in the environment or in `~/.config/tenki/config.yaml`. Export `TENKI_API_KEY=tk_...`, or run `tenki login --api-key <key>`.

**❌ `ModuleNotFoundError: No module named 'harbor'` from `node verify.mjs`.** There's no `.venv` in this folder, so the shim ran `python3` (or `$PYTHON`), which doesn't have the requirements installed. Run `uv venv --python 3.12 && uv pip install -r requirements.txt` here first, or set `PYTHON` to an interpreter that has them.

**❌ `Tenki does not support docker-compose tasks yet; only Dockerfile and docker_image tasks.`** The task ships a `docker-compose.yaml`, which `tenki-harbor` doesn't run yet. Run that task with a different Harbor environment.

**❌ `Task asks for N CPUs; Tenki VMs have at most 16.`** The same check rejects memory over 65536 MB (`Task asks for N MB of memory; …`) and disks over 100 GB (`Task needs a N GB disk; …`). `tenki-harbor` rejects tasks larger than one Tenki VM instead of shrinking them. If the task can run on less, lower its request with `--override-cpus <n>` or `--override-memory-mb <n>`; Harbor applies these to every trial in the run. For disk, the default is the task's storage request plus 30 GB for image layers, at least 50 GB; `--ek disk_size_gb=<n>` sets it directly, up to 100.

**❌ `Pass at most one of image and snapshot_id.`** You passed both as environment options. Pass one. `TENKI_HARBOR_SNAPSHOT_ID` applies only when you pass neither.

**❌ `Tenki session for <trial> is '<STATE>', expected terminated`** (or `is None`), from `verify.py`. The trial finished, but its VM is still active, or `verify.py` couldn't find a session tagged `harbor` for it. Run `tenki-harbor sessions` to check, and `tenki-harbor cleanup` to terminate it. Note that `cleanup` ends every active Harbor session in the workspace.

## FAQ

**Do I need a model API key?** Not for Step 4 or the verify script, because the `oracle` agent runs the task's reference solution. Running an agent needs that agent's key (`ANTHROPIC_API_KEY` for Claude Code here), and `--ae KEY=value` passes any other variables it needs.

**Which Harbor version does this use?** 0.23.x. `tenki-harbor` 0.1.0 pins `harbor>=0.23,<0.24`, and this folder's `requirements.txt` pins the same range, so Harbor 0.24 and later won't install alongside it.

**Can I compare agent harnesses on one model?** Yes. [`tenki-harness-evals`](https://github.com/LuxorLabs/tenki-harness-evals) builds on `tenki-harbor` to run one model, served from an OpenAI-compatible endpoint (plus an Anthropic Messages endpoint for Claude Code), through several agent harnesses (Terminus, mini-swe-agent, Goose, OpenCode, Qwen Code, Claude Code). For each harness it reports what passed, what failed the task, and what hit an API error from the endpoint.

**When shouldn't I use this?** When your tasks need something `tenki-harbor` doesn't support:

| Feature | Status |
| --- | --- |
| Prebuilt `docker_image` tasks (all of Terminal-Bench 2.0) | Yes |
| Dockerfile tasks (built in the VM) | Yes |
| `network_mode = "no-network"`, including switching between phases | Yes |
| `docker-compose.yaml` tasks, network allowlists | Not yet; rejected with an error |
| GPUs, Windows containers | No |
| Up to 16 vCPU, 64 GB memory, 100 GB disk per trial | Larger requests are rejected, not shrunk |

Also skip it if you need a versioned release from PyPI, since `tenki-harbor` installs from GitHub for now. And if your tasks run fine in local Docker and you don't need a VM per trial, Harbor's default local Docker environment needs no Tenki key.

## Related

- [Harbor](https://github.com/harbor-framework/harbor), the evaluation framework.
- [`tenki-harbor`](https://github.com/LuxorLabs/tenki-harbor), the Tenki environment for Harbor, with the full Terminal-Bench 2.0 results.
- [`tenki-harness-evals`](https://github.com/LuxorLabs/tenki-harness-evals), one model across several agent harnesses.
- [Harbor on Tenki](https://tenki.cloud/docs/sandbox/harbor), the full guide in the [Tenki docs](https://tenki.cloud/docs).
- [`../snapshots-pause-resume/`](../snapshots-pause-resume/), Tenki snapshots on their own.
- [`../run-code-python/`](../run-code-python/), the `tenki` Python SDK that `tenki-harbor` is built on.
