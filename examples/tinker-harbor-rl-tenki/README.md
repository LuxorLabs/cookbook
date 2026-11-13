# Tinker RL on Terminal-Bench

Train a model with reinforcement learning on [Terminal-Bench](https://www.tbench.ai) tasks, with every rollout in its own Tenki sandbox and no GPU on your side. [Tinker](https://thinkingmachines.ai/tinker/) hosts the model, the sampling and the training. [tinker-cookbook](https://github.com/thinking-machines-lab/tinker-cookbook)'s `harbor_rl` recipe gives the model a bash tool inside a task's container, lets it attempt the task, and rewards it with the task's own tests. The recipe takes its sandbox as a plug-in, and [`tinker_tenki.py`](tinker_tenki.py) is that plug-in for Tenki.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up Tinker RL on Terminal-Bench with Tenki sandboxes, following https://github.com/LuxorLabs/cookbook/tree/main/examples/tinker-harbor-rl-tenki.
1. Check that Python 3.12+ and uv are installed. Create a venv in that folder and install requirements.txt (this pulls in PyTorch, so it takes a minute).
2. It needs TENKI_API_KEY (starts with tk_, from https://app.tenki.cloud) and TINKER_API_KEY exported in the shell. If either isn't set, stop and ask me to export it. Never print a key or write it to a file.
3. Run `node verify.mjs` and confirm it prints two check marks. It needs no Tinker key.
4. Download the Terminal-Bench tasks with the uvx command in the README (ask me before downloading).
5. Run train.py on the two tasks in the README with max_steps=2 first, and tell me what it reports each step. Ask me before a longer run.
6. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- Python 3.12 or later and [uv](https://docs.astral.sh/uv/).
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- A Tinker API key, for the training run in step 5 only.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/tinker-harbor-rl-tenki
uv venv --python 3.12 && uv pip install -r requirements.txt
source .venv/bin/activate
```

This installs the Tenki SDK and tinker-cookbook at a pinned commit. tinker-cookbook brings PyTorch and Transformers with it for tokenizing; the training itself runs on Tinker's GPUs. The `[modal]` extra is there because the recipe imports its Modal sandbox module when it loads. Nothing runs on Modal and you don't need a Modal account.

### 2. Set your API keys

```bash
export TENKI_API_KEY=tk_...
export TINKER_API_KEY=...      # or run `tinker auth login`
```

### 3. Check the Tenki side with no Tinker key

```bash
node verify.mjs
```

This builds a one-file Harbor task on a Tenki sandbox, runs commands and file writes against it, and grades it with the recipe's own `HarborReward`: `0.0` before the fix, `1.0` after. Then it confirms the sandbox was terminated. It takes about 30 seconds. `python verify.py` does the same if you don't have Node.

### 4. Download the tasks

```bash
uvx harbor datasets download terminal-bench@2.0 -o ~/.cache/harbor/tasks/terminal-bench-2.0/
```

This is the 89 Terminal-Bench 2.0 task definitions (about 46 MB). The recipe reads them from `~/.cache/harbor/tasks/`.

### 5. Train

```bash
TB_TASKS=fix-git,overfull-hbox python train.py \
  model_name=Qwen/Qwen3-8B group_size=4 groups_per_batch=2 max_steps=10
```

`train.py` is the recipe's launcher with one change: it passes `tenki_sandbox_factory`. Every `key=value` is a field of the recipe's [`CLIConfig`](https://github.com/thinking-machines-lab/tinker-cookbook/blob/main/tinker_cookbook/recipes/harbor_rl/train.py): `model_name`, `group_size`, `groups_per_batch`, `learning_rate`, `max_turns`, `max_steps`, `wandb_project`, and the rest. `TB_TASKS` picks tasks by name; leave it unset to train on all 89.

Each step samples `group_size` attempts at each of `groups_per_batch` tasks, so this run starts 8 sandboxes at a time. The recipe logs metrics for every step to its run directory, and to Weights & Biases if you set `wandb_project`.

Terminal-Bench has four `easy` tasks. We ran each one's reference solution through `TenkiSandbox` and the recipe's grader: `fix-git` and `overfull-hbox` score `1.0`, so they make a sound first run. `cobol-modernization` and `prove-plus-comm` score `0` even with the right answer (see "What to know"). Two tasks and ten steps shows the loop working; it won't give you a trained model.

## How a rollout runs

For each attempt, the recipe asks the factory for a sandbox from the task's `environment/` folder, and [`tinker_tenki.py`](tinker_tenki.py) does this:

1. Creates a Tenki sandbox: 2 vCPU, 4 GB of memory, 50 GB of disk, ending at the recipe's `sandbox_timeout` plus 25 minutes of setup allowance.
2. Installs Docker in it. Tenki sandboxes can't boot a container image directly, so the task's container runs under Docker inside the sandbox.
3. Pulls the `docker_image` named in the task's `task.toml`, as Harbor does, or builds the Dockerfile if there isn't one or the pull fails.
4. Starts the container. From then on `run_command`, `read_file` and `write_file` are `docker exec` calls into it, which is all the recipe's bash tool and grader use.
5. At the end of the episode, the recipe uploads the task's tests, runs `test.sh` and reads `/logs/verifier/reward.txt`. Then it calls `cleanup()`, which terminates the sandbox.

Setup took 14 to 24 seconds per sandbox with the prebuilt images, with two or three starting at once. Building the Dockerfile instead took over two minutes for `prove-plus-comm`, and failed for `fix-git`, whose Dockerfile clones a GitHub repository while it builds. That is why the prebuilt image comes first.

## What to know

| | |
| --- | --- |
| Grading runs from `/root`, not the task's working directory | The recipe's `HarborReward` runs `test.sh` from `/root`. Tasks whose tests open files by relative path score `0` even when the answer is right. We confirmed this on `prove-plus-comm`: the same container scores `0` from `/root` and `1` from the task's `WORKDIR`. `cobol-modernization` also scores `0` with its reference solution; we didn't check why. It happens on any sandbox backend, so check a task with its reference solution before you train on it. |
| One size for every sandbox | Each sandbox is 2 vCPU, 4 GB, 50 GB, whatever the task's `task.toml` asks for. Change the defaults in `TenkiSandbox.create` for heavier tasks. |
| Dockerfile and `docker_image` tasks only | Tasks that need `docker-compose.yaml` or a GPU aren't supported. |
| A timed-out command returns exit code `-1` | The process inside the container can keep running after the timeout. |
| Concurrency | Every sandbox of a batch starts together (`group_size` × `groups_per_batch`). Keep that under your workspace's sandbox limit. |

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_API_KEY, or run `tenki login`.`` | `verify.py` found no key. Export one or run `tenki login --api-key <key>`. |
| `ModuleNotFoundError: No module named 'tinker_cookbook'` from `node verify.mjs` | Create the `.venv` here and install `requirements.txt`, or set `PYTHON`. |
| `ImportError: modal is required for ModalSandbox` | Install with the `[modal]` extra, as `requirements.txt` does. The recipe imports that module even though nothing runs on Modal. |
| `TinkerError: The api_key client option must be set …` | Export `TINKER_API_KEY` or run `tinker auth login`. |
| `FileNotFoundError` for `~/.cache/harbor/tasks/terminal-bench-2.0/terminal-bench` | Run the download in step 4. |
| `Unknown TB_TASKS: [...]` | A name in `TB_TASKS` isn't a Terminal-Bench 2.0 task. List them with `ls ~/.cache/harbor/tasks/terminal-bench-2.0/terminal-bench`. |
| `docker build failed: …` | The task has no usable `docker_image` and its Dockerfile can't build in the sandbox, often because it downloads something that moved. Pick another task. |
| A task's reward is always `0` | Run its reference solution first (see "What to know" on grading from `/root`). |
| A sandbox is still running after an interrupted run | List them with `tenki sandbox list --tags tinker-rl --state running`, and end each with `tenki sandbox terminate <id>`. |

## Related

- [Harbor](../harbor-tenki/): the same tasks as an eval, with an agent of your choice and no training.
- [tinker-cookbook's Harbor RL recipe](https://github.com/thinking-machines-lab/tinker-cookbook/tree/main/tinker_cookbook/recipes/harbor_rl)
- [Tenki Sandbox](https://tenki.cloud)
