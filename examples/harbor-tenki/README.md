# Harbor agent evals, each trial in a Tenki sandbox

[Harbor](https://github.com/harbor-framework/harbor) is the open-source framework from the creators of Terminal-Bench for evaluating coding agents and models: it runs an agent (Claude Code, Codex, OpenCode, Goose, mini-swe-agent, Terminus, …) against a benchmark's tasks, grades every attempt with the task's own tests, and records the full trajectory. [`tenki-harbor`](https://github.com/LuxorLabs/tenki-harbor) adds [Tenki Sandbox](https://tenki.cloud/docs/sandbox) as a Harbor environment, so **every trial gets its own Tenki VM** and you can run dozens in parallel.

## How it fits together

Harbor owns the evaluation (tasks, agents, attempts, grading, results on disk). Tenki owns the machine. Harbor tasks are container images and a Tenki session is a full Linux VM, so for each trial `tenki-harbor`:

1. Creates a Tenki session sized to the task's CPU, memory and storage request.
2. Installs and starts Docker in the VM.
3. `docker pull`s the task's prebuilt image, or `docker build`s its Dockerfile in the VM.
4. Routes Harbor's `exec` and file transfers into that container (`docker exec` / `docker cp`).
5. Terminates the session when the trial ends, pass or fail.

## Install (Python 3.12+)

`tenki-harbor` is not on PyPI yet; install it from GitHub alongside the `harbor` CLI:

```bash
uv tool install harbor \
  --with "tenki-harbor @ git+https://github.com/LuxorLabs/tenki-harbor" \
  --with-executables-from tenki-harbor
export TENKI_API_KEY=tk_...
```

This gives you `harbor` with the Tenki environment loaded, plus the `tenki-harbor` command for setup and cleanup. `tenki-harbor` pins `harbor>=0.23,<0.24`, so you get Harbor 0.23.x. To work from this folder instead: `uv venv --python 3.12 && uv pip install -r requirements.txt`.

**Auth:** `tenki-harbor` reads `TENKI_API_KEY` (or `TENKI_AUTH_TOKEN`) from the environment only, and the Python SDK accepts `tk_` API keys. The CLI's saved login is not used (`verify.py` exports it from `~/.config/tenki/config.yaml` for you).

## 1. Check the setup, no model needed

```bash
harbor run -t hello-world/hello-world -e tenki_harbor:TenkiEnvironment --agent oracle
```

`-e tenki_harbor:TenkiEnvironment` is how Harbor loads an environment from an installed package. The `oracle` agent runs the task's reference solution, so this creates a VM, runs the task, grades it, prints a mean reward of `1.000` and terminates the VM, in under a minute.

## 2. Run a benchmark with an agent

```bash
export ANTHROPIC_API_KEY=sk-ant-...
harbor run -d terminal-bench@2.0 -e tenki_harbor:TenkiEnvironment \
  --agent claude-code --model anthropic/claude-opus-4-1 \
  --n-concurrent 16 -l 10
```

Claude Code on the first 10 Terminal-Bench 2.0 tasks, one VM per task. `--n-concurrent` caps how many run at once, `-l` caps the task count (drop it for all 89), and `--ae KEY=value` passes extra variables to the agent. The same run as a job config is in [`job.yaml`](job.yaml):

```bash
harbor run -c job.yaml
harbor view jobs          # every step of every trial
```

## 3. Start trials faster from a snapshot

Each trial installs Docker in a fresh VM. Bake it into a Tenki [snapshot](https://tenki.cloud/docs/sandbox/snapshots) once per workspace instead:

```bash
tenki-harbor prepare
export TENKI_HARBOR_SNAPSHOT_ID=<printed snapshot id>
```

On Terminal-Bench this took median environment setup from 28 s to 19 s ([tenki-harbor README](https://github.com/LuxorLabs/tenki-harbor#faster-startup)).

## Options

Pass with `--ek key=value`, or under `environment.kwargs` in a job config.

| Option | Default | |
| --- | --- | --- |
| `max_duration_sec` | `7200` | Hard VM lifetime, so a crashed run can't leak a VM. Must cover build + agent + tests. |
| `disk_size_gb` | task storage + 30 GB, min 50 | VM disk, which also holds the image layers. |
| `snapshot_id` / `image` | `TENKI_HARBOR_SNAPSHOT_ID`, else the Tenki base image | Start from a snapshot or a Tenki image (one or the other). |
| `base_url` | `TENKI_API_ENDPOINT` or `https://api.tenki.cloud` | Tenki API endpoint. |

## What's supported

| Feature | Status |
| --- | --- |
| Prebuilt `docker_image` tasks (all of Terminal-Bench 2.0) | Yes |
| Dockerfile tasks (built in the VM) | Yes |
| `network_mode = "no-network"`, including switching between phases | Yes |
| `docker-compose.yaml` tasks, network allowlists | Not yet; rejected with an error |
| GPUs, Windows containers | No |
| Up to 16 vCPU, 64 GB memory, 100 GB disk per trial | Larger requests are rejected, not shrunk |

With Harbor's `oracle` agent on all 89 Terminal-Bench 2.0 tasks, 16 at a time, 79 pass on Tenki; the [tenki-harbor README](https://github.com/LuxorLabs/tenki-harbor#terminal-bench-20-results) lists why each of the other 10 fails in the task itself.

## Compare harnesses on one model

[`tenki-harness-evals`](https://github.com/LuxorLabs/tenki-harness-evals) builds on this to run one model behind an OpenAI-compatible endpoint across several harnesses (Terminus, mini-swe-agent, Goose, OpenCode, Qwen Code, Claude Code) and report, per harness, what passed, what failed the task, and what hit an API error from the endpoint.

## Verify

```bash
uv venv --python 3.12 && uv pip install -r requirements.txt
node verify.mjs        # or: .venv/bin/python verify.py
```

[`verify.py`](verify.py) runs the same smoke test as tenki-harbor's own CI, with no model key: it imports `TenkiEnvironment`, runs `harbor run -t hello-world/hello-world -e tenki_harbor:TenkiEnvironment --agent oracle` against live Tenki, asserts the trial's reward is `1.0`, and checks the trial's Tenki session (tagged `harbor`) ended up terminated. Takes about 45 s.

## Cleanup

Every session is tagged `harbor` and carries the Harbor session id in its metadata. If Harbor is killed mid-run, its VMs still stop at `max_duration_sec`; to end them sooner:

```bash
tenki-harbor sessions   # list active Harbor sessions
tenki-harbor cleanup    # terminate them
```

Full guide: [tenki.cloud/docs/sandbox/harbor](https://tenki.cloud/docs/sandbox/harbor).
