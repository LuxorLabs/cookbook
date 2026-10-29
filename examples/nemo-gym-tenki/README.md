# NeMo Gym

Run and score the code a model writes during training, each attempt on its own disposable cloud machine.

[NVIDIA NeMo Gym](https://github.com/NVIDIA-NeMo/Gym) is a library for training language models with **reinforcement learning (RL)**: the model attempts a task many times, each attempt gets a score, and training nudges the model toward the attempts that scored well. A few terms you'll see:

- A **rollout** is one attempt at a task, for example the model writing a function to solve a coding problem.
- The **reward** is that attempt's score. Here it's `1.0` if the model's code passes the task's tests and `0.0` if it doesn't.
- A **sandbox provider** is where NeMo Gym runs the code it needs to score. It ships providers for Docker, E2B, and others.

Model-written code shouldn't run on your training machines, and you may run thousands of rollouts at once. [`nemo-gym-tenki`](https://github.com/opencolin/nemo-gym-tenki) adds a `tenki` provider, so each rollout's code runs in its own Tenki VM that's deleted afterwards. Once it's installed, NeMo Gym finds it by name, with no change to NeMo Gym itself.

This example scores one rollout: it puts a solution file in a sandbox, runs its tests, and prints the reward.

> **Status:** `nemo-gym-tenki` isn't on PyPI yet, so this example installs it from GitHub at a fixed commit. A built-in Tenki provider is proposed in NeMo Gym itself ([NVIDIA-NeMo/Gym#2346](https://github.com/NVIDIA-NeMo/Gym/pull/2346)).

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Run NeMo Gym rollouts in Tenki sandboxes, following https://github.com/LuxorLabs/cookbook/tree/main/examples/nemo-gym-tenki.
1. Clone https://github.com/LuxorLabs/cookbook, cd into examples/nemo-gym-tenki, and check that uv is installed (ask before installing it).
2. Run uv sync. uv fetches Python 3.13.14+ if needed.
3. It needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) exported in the shell. If it isn't set, stop and ask me to export it. Never print the key or write it to a file.
4. Run uv run python run.py and confirm "reward 1.0", then node verify.mjs and confirm the ✓ line.
5. To use it in my own NeMo Gym environment, add the sandbox_provider: tenki block from the README to its config.
6. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- [uv](https://docs.astral.sh/uv/). NeMo Gym 0.7.0 needs Python 3.13.14 or later, which uv fetches if you don't have it.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/nemo-gym-tenki
uv sync                 # NeMo Gym 0.7.0, nemo-gym-tenki, and tenki, into ./.venv
```

### 2. Set your API key

```bash
export TENKI_API_KEY=tk_...   # TENKI_AUTH_TOKEN also works
```

Sandboxes are created in the key's Tenki workspace. Set `connection.workspace_id` in the provider config to pick another.

### 3. Run

```bash
uv run python run.py
```

`run.py` lists the sandbox providers NeMo Gym can see (`tenki` should be among them), copies a model's solution into a new sandbox, runs its tests there, and turns the exit code into a reward:

```
providers: apptainer, daytona, docker, e2b, ecs_fargate, enroot, local, opensandbox, openshell, tenki
sandbox 01a1…
exit 0: tests passed
reward 1.0
```

### 4. Verify

```bash
node verify.mjs      # or: uv run python verify.py
```

```
✓ nemo-gym-tenki: `tenki` provider via entry point → create 01a1… with staged files → exec 42 → env → exit 3 → close (stopped)
```

`verify.py` checks that NeMo Gym lists the `tenki` provider, creates a sandbox with a file copied in, runs it, checks that environment variables reach the sandbox and that a failing command reports its exit code, then closes the sandbox and confirms it stopped. `verify.mjs` runs `uv sync --locked` first, installing uv into the current Python if it isn't on your `PATH`.

## The code

The provider has three calls: `create` starts a sandbox from a `SandboxSpec` (the working folder, files to copy in, size, and so on), `exec` runs a command in it, and `close` deletes it.

```python
from nemo_gym.sandbox.providers.base import SandboxSpec
from nemo_gym.sandbox.providers.registry import create_provider

# Pick the Tenki provider and size its VMs. In a NeMo Gym config file, the same
# settings go under `sandbox_provider:`.
provider = create_provider({"tenki": {"create": {"cpu_cores": 1, "memory_mb": 1024, "max_duration_s": 600}}})
# Start a sandbox with the model's solution copied into /home/tenki/task.
handle = await provider.create(SandboxSpec(workdir="/home/tenki/task", files={"solution.py": SOLUTION}))
try:
    r = await provider.exec(handle, "python3 solution.py", cwd="/home/tenki/task")
    reward = 1.0 if r.return_code == 0 else 0.0  # tests passed: full reward
finally:
    await provider.close(handle)  # terminates the sandbox
    await provider.aclose()
```

In a NeMo Gym environment config (the YAML file that describes a task), select the provider by name:

```yaml
sandbox_provider:
  tenki:
    create:
      cpu_cores: 2
      memory_mb: 4096
      max_duration_s: 1800   # hard cap on each VM's lifetime
```

## How it works

- **Spec fields.** Each `SandboxSpec` field becomes a Tenki setting: `resources` sets the VM's `cpu_cores`, `memory_mb`, and `disk_size_gb`; `image` picks a Tenki image; `env` and `metadata` pass through; `ttl_s` becomes the VM's maximum lifetime; `files` are written into `workdir` after the VM starts.
- **Network.** Outbound access is on, so rollouts can `pip install` or `git clone`. Set `create.allow_outbound: false` to lock a rollout down.
- **Reconnect from another process.** A sandbox handle can be saved and reopened by sandbox ID in a different process or on another machine (the provider implements NeMo Gym's `ConnectableProvider`). That lets you spread rollouts across many workers.
- **CPU only.** A spec that asks for `resources.gpu` is rejected.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `No interpreter found for Python >=3.13.14` | Run `uv python install 3.13`, or install Python 3.13.14+. |
| `NeMo Gym doesn't list a tenki provider` | Run with `uv run` or `.venv/bin/python`. |
| `unexpected keyword argument 'project_id'` | Replace `connection.project_id` with `connection.workspace_id`, or drop it. |
| `does not attach GPUs` | Use a GPU provider for that environment. |

## Files

| File | Purpose |
|---|---|
| `pyproject.toml`, `uv.lock` | NeMo Gym 0.7.0, the provider pinned to a commit, and `tenki`, locked |
| `run.py` | Stage a solution, run its tests in a sandbox, score it |
| `verify.py`, `verify.mjs` | The live check, and the shim CI runs |

## Related

- [Hugging Face smolagents](../smolagents/): another framework that hands an agent's code to a Tenki executor
- [AgentEnv](../agentenv-tenki/): RL environments on Tenki
