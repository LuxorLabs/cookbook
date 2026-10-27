# NeMo Gym

Run [NVIDIA NeMo Gym](https://github.com/NVIDIA-NeMo/Gym) rollouts in Tenki sandboxes, one disposable VM per rollout. Installing [`nemo-gym-tenki`](https://github.com/opencolin/nemo-gym-tenki) registers a `tenki` provider on NeMo Gym's `nemo_gym.sandbox_providers` entry point, so NeMo Gym picks Tenki by name, the same way it picks Docker or E2B, with no change to NeMo Gym itself.

> **Status:** `nemo-gym-tenki` isn't on PyPI yet. This example installs it from git at commit `ec0ee66` ([opencolin/nemo-gym-tenki#1](https://github.com/opencolin/nemo-gym-tenki/pull/1)), which uses the `tenki` 1.x SDK. A built-in provider is proposed upstream in [NVIDIA-NeMo/Gym#2346](https://github.com/NVIDIA-NeMo/Gym/pull/2346).

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

The provider uses the key's workspace. Set `connection.workspace_id` to pick another.

### 3. Run

```bash
uv run python run.py
```

`run.py` stages an agent's solution into a sandbox, runs its tests there, and scores the result:

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

`verify.py` checks that NeMo Gym lists the `tenki` provider, creates a sandbox with a file staged into `spec.workdir`, runs it, checks `spec.env` and a non-zero exit code, closes the sandbox, and confirms it stopped. `verify.mjs` runs `uv sync --locked` first, installing uv into the current Python if it isn't on your `PATH`.

## The code

```python
from nemo_gym.sandbox.providers.base import SandboxSpec
from nemo_gym.sandbox.providers.registry import create_provider

# The same dict goes under `sandbox_provider:` in a NeMo Gym config.
provider = create_provider({"tenki": {"create": {"cpu_cores": 1, "memory_mb": 1024, "max_duration_s": 600}}})
# spec.files are written into spec.workdir when the sandbox is created.
handle = await provider.create(SandboxSpec(workdir="/home/tenki/task", files={"solution.py": SOLUTION}))
try:
    r = await provider.exec(handle, "python3 solution.py", cwd="/home/tenki/task")
    reward = 1.0 if r.return_code == 0 else 0.0
finally:
    await provider.close(handle)  # terminates the sandbox
    await provider.aclose()
```

In a NeMo Gym environment config, select the provider by name:

```yaml
sandbox_provider:
  tenki:
    create:
      cpu_cores: 2
      memory_mb: 4096
      max_duration_s: 1800   # hard cap on each VM's lifetime
```

## How it works

- **Spec mapping.** `SandboxSpec.resources` maps to `cpu_cores`, `memory_mb`, and `disk_size_gb`; `spec.image` to a Tenki image; `spec.env` and `spec.metadata` pass through; `spec.ttl_s` becomes the VM's `max_duration`; `spec.files` are written into `spec.workdir` after boot.
- **Network.** Outbound access is on, so rollouts can `pip install` or `git clone`. Set `create.allow_outbound: false` to lock a rollout down.
- **Reconnect across processes.** The provider implements `ConnectableProvider`, so a handle can be serialized and reopened by sandbox ID elsewhere, for distributed rollout collection.
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
