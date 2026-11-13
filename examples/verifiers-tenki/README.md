# verifiers on Tenki

Run an [Environments Hub](https://app.primeintellect.ai/dashboard/environments) environment's rollouts in Tenki sandboxes instead of Prime sandboxes, with no fork of [verifiers](https://github.com/PrimeIntellect-ai/verifiers). verifiers loads out-of-tree runtimes from your own package, and [`tenki_backend.py`](tenki_backend.py) is that package for Tenki: every rollout gets its own sandbox, the task's container image runs under Docker inside it, and the evaluator (your machine) keeps running the model interception server and the scoring. The model traffic reaches the sandbox through a Tenki host-port tunnel, so a run needs a Tenki key and a model key and no Prime account.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up verifiers on Tenki sandboxes, following https://github.com/LuxorLabs/cookbook/tree/main/examples/verifiers-tenki.
1. Check that Python 3.12+ and uv are installed. Create a venv in that folder and install requirements.txt (this pulls in transformers and datasets, so it takes a minute).
2. It needs TENKI_API_KEY (starts with tk_, from https://app.tenki.cloud) exported in the shell. If it isn't set, stop and ask me to export it. Never print a key or write it to a file.
3. Run `node verify.mjs` and confirm it prints two check marks. It needs no model key.
4. Run `python eval.py` with no flags (replays the reference answer on 2 gsm8k tasks) and confirm 2 valid.
5. For a scored run, ask me which OpenAI-compatible endpoint and model to use and the name of the env var that holds its key (never read the key). Then run eval.py with --model, --base-url and --api-key-var, and tell me the rewards.
6. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- Python 3.12 or later and [uv](https://docs.astral.sh/uv/).
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- A key for any OpenAI-compatible model endpoint, for the scored run in step 5 only.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/verifiers-tenki
uv venv --python 3.12 && uv pip install -r requirements.txt
source .venv/bin/activate
```

This installs the Tenki SDK, verifiers at an exact build (see "What to know" for why it isn't a release), and the `primeintellect/gsm8k` environment straight from the Environments Hub.

### 2. Set your API key

```bash
export TENKI_API_KEY=tk_...   # TENKI_AUTH_TOKEN also works
```

`verify.py` and `eval.py` also read the key that `tenki login` saved. The `vf-eval` and `vf-validate` commands read it from the environment only.

### 3. Check the Tenki side with no model key

```bash
node verify.mjs
```

This loads the backend the way verifiers does (`type = "custom"` plus `import_path`), starts a sandbox, and checks what verifiers expects of a runtime: commands, exit codes and stdin, killing a process, a 3 MB file round trip, running as another user, and a server on your machine reached from inside the task container. Then it confirms the sandbox was terminated. It takes about 30 seconds. `python verify.py` does the same if you don't have Node.

### 4. Replay the reference answer on a Hub environment, no model

```bash
python eval.py
```

This runs `vf-validate --only-gold` on two `gsm8k` tasks. For each task, verifiers starts a Tenki sandbox, runs the task's setup (the grader's dependencies install inside the container with `uv`), feeds the task's reference answer to the grader and expects a score of `1.0`. It's the model-free check that a task and its grader work on the runtime. Expect `"valid": 2`.

### 5. Run a scored eval with a model

```bash
export OPENROUTER_API_KEY=...        # any OpenAI-compatible endpoint works
python eval.py --model openai/gpt-4o-mini \
  --base-url https://openrouter.ai/api/v1 --api-key-var OPENROUTER_API_KEY -n 5
```

This is `vf-eval` with the Tenki runtime: each rollout starts a sandbox, a bash-tool agent inside the container talks to your model endpoint through the interception server on your machine, and the grader scores the answer in the same sandbox. Results land in `outputs/<run>/traces.jsonl`, one episode per line, and `eval.py` ends with the mean reward. We ran this with five tasks against `openai/gpt-4o-mini` on OpenRouter:

```text
13:10:13    INFO running 5x1 rollouts on openai/gpt-4o-mini
13:10:13    INFO interception up: url=http://127.0.0.1:65379
13:10:45    INFO rollout done: id=4f605eb4... task=2 reward=1.000 turns=1 stop=agent_completed
13:10:45    INFO rollout done: id=54e7d382... task=1 reward=1.000 turns=1 stop=agent_completed
13:10:53    INFO rollout done: id=b577c538... task=3 reward=1.000 turns=1 stop=agent_completed
13:10:54    INFO rollout done: id=cd6caa56... task=0 reward=1.000 turns=1 stop=agent_completed
13:10:55    INFO rollout done: id=cc40f685... task=4 reward=1.000 turns=1 stop=agent_completed
5 episodes, mean reward 1.000
```

Five sandboxes ran at once. Five easy questions say the plumbing works, not how good a model is.

To use the runtime from your own config, set this under the agent in a `vf-eval` TOML file or as `--env.agent.runtime.*` flags (run from this folder, or put it on `PYTHONPATH`, so `tenki_backend` imports):

```toml
[env.agent.runtime]
type = "custom"
import_path = "tenki_backend.TenkiBackend"
cpu = 2        # vCPUs
memory = 4     # GB
disk = 20      # GB
```

## How a rollout runs

For each rollout, verifiers builds the backend from that config and calls it like any runtime. [`tenki_backend.py`](tenki_backend.py) does this:

1. `start()` creates a Tenki sandbox with your `cpu`, `memory` and `disk`, tagged `verifiers-tenki`, ending on its own after `max_duration` (two hours) if nothing tears it down.
2. Installs Docker in it. Tenki sandboxes can't boot a container image directly, so the task's image runs as a container under Docker inside the sandbox, started with host networking so it shares the sandbox's loopback.
3. `run`, `exec`, `run_background`, `read` and `write` are `docker exec` calls into that container. Files travel over the exec's stdin, because the sandbox's own file API only reaches `/home/tenki`. Environment values travel in the exec's environment, not on its command line. `kill()` signals the process inside the container, since the `docker exec` client doesn't forward signals.
4. Model traffic: verifiers starts one interception server on your machine for the whole eval and gives the agent's runtime its URL through `host_url`. The backend opens a Tenki host-port tunnel from the sandbox's loopback to that port on your machine, so the agent calls `127.0.0.1:<port>` inside the sandbox and the request arrives at your server.
5. `teardown()` closes the tunnels and terminates the sandbox, and `cleanup()` does the same through the sync client when the process exits early.

The environment is untouched: `primeintellect/gsm8k` knows nothing about Tenki. It sets up a `uv` script and scores with `runtime.run_uv_script`, and that runs in the Tenki container as it would on Prime.

Setup took about 15 to 20 seconds per sandbox (creating the sandbox takes about a second; the rest is installing Docker and pulling `python:3.11-slim`), and a `gsm8k` rollout took 30 to 60 seconds end to end.

## Trust the reward

A grader that runs in the same sandbox as the agent can be tampered with by the agent. `gsm8k` here scores inside the rollout's own sandbox (verifiers' `shared` scoring mode), which is fine for a model that only answers a math question and not for an agent with a shell and a stake in the score. verifiers can instead grade in a fresh, separate runtime that the agent never touched (`isolated` scoring, which provisions a second backend of the same config). This example doesn't exercise that path, so check it on your own environment before relying on it.

## What to know

| | |
| --- | --- |
| verifiers pin | The out-of-tree runtime hook landed after the 0.4.0 release (on 2026-10-19), so `requirements.txt` pins the PyPI build `0.4.1.dev118`, which is main at commit `b8cce23df` from 2026-10-30. That version is a per-commit build, so re-pin on purpose, and expect `RuntimeBackend` to change: verifiers' v1 API moves daily. |
| `vf-eval` is on its way out | It logs that verifiers is moving evals to prime-rl's `uv run eval`. The runtime config is the same there: `type = "custom"` and `import_path`. |
| No Compose support | The backend doesn't declare `SUPPORTS_COMPOSE`, so verifiers refuses a task that deploys Compose services before it creates anything. Declaring it doesn't help: verifiers' Compose path runs `docker compose` on the evaluator host and only accepts its own `DockerConfig`, so it never calls a custom backend (we checked: it fails with `Local Compose requires DockerConfig`). Docker runs in the sandbox, so Compose files work there if your own task code runs them; verifiers just can't drive it. |
| No network policy | A task that sets `network.allow` is refused. Tenki fixes a sandbox's egress rules when it is created, and verifiers opens the network for setup and restricts it before the agent runs. |
| No tool servers in their own runtime | Not declared (`SUPPORTS_PORT_EXPOSURE`): verifiers expects the URL of a runtime that is on the host network, and a sandbox is not. Tool servers that share the agent's runtime work. |
| No GPUs, no private registries | The sandbox is CPU only and `docker run` pulls the image anonymously. |
| One sandbox per rollout | `vf-eval -c` defaults to 128 rollouts at once. Set `-c` to what your workspace's sandbox limit allows. A rollout that can't create its sandbox ends as a `SandboxError`; add `[[env.agent.retries.rules]]` for it as in verifiers' evaluation docs. |
| Sandbox size | `cpu`, `memory` and `disk` default to 2 vCPU, 4 GB and 20 GB. A task's own `resources` apply when you leave the runtime's at their defaults. |
| The image needs `sleep` | As on verifiers' other runtimes, the image's entrypoint is replaced by `sleep infinity`, so start any daemon the image normally launches in the task's `setup`. |

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_API_KEY, or run `tenki login`.`` | `verify.py` or `eval.py` found no key. Export one or run `tenki login --api-key <key>`. |
| `missing auth token: set TENKI_AUTH_TOKEN or TENKI_API_KEY` from `vf-eval` or `vf-validate` | Those commands read only the environment. Export `TENKI_API_KEY`, or use `eval.py`, which also reads the `tenki login` key. |
| `ModuleNotFoundError: No module named 'verifiers'` from `node verify.mjs` | Create the `.venv` here and install `requirements.txt`, or set `PYTHON`. |
| `ValueError: cannot import custom runtime 'tenki_backend.TenkiBackend'` | `tenki_backend` isn't on the Python path. Run from this folder with `eval.py`, or set `PYTHONPATH=.` for `vf-eval`. |
| `the custom runtime cannot run Compose services` | See "No Compose support" above. |
| `requires a network policy, but the custom runtime does not enforce network policies` | The task sets `network.allow`. Tenki can't change a sandbox's egress after creation; run that task on Prime or Docker. |
| `tenki sandbox provisioning failed: Received http2 header with status: 503` | The Tenki API was briefly unavailable. Creating a sandbox already retries a few times; run again. |
| `docker run ... failed: ... pull access denied` or `manifest unknown` | The image is private or doesn't exist. The backend pulls anonymously from the image's registry. |
| `vf-eval` asks for `PRIME_API_KEY` or fails uploading | Its default endpoint is Prime Inference and it uploads the run to Prime. `eval.py` passes your endpoint and `--no-push`; do the same by hand. |
| A sandbox is still running after an interrupted run | List them with `tenki sandbox list --tags verifiers-tenki --state running`, and end each with `tenki sandbox terminate <id>`. |

## Related

- [verifiers runtimes](https://github.com/PrimeIntellect-ai/verifiers/blob/main/docs/runtimes.md): the runtime plugin contract this implements.
- [Harbor](../harbor-tenki/): the same pattern, Docker inside a Tenki sandbox, for Harbor agent evals.
- [Tenki Sandbox](https://tenki.cloud)
