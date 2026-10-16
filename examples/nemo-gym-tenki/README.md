# NeMo Gym rollouts on Tenki

Run [NVIDIA NeMo Gym](https://github.com/NVIDIA-NeMo/Gym) sandboxes in Tenki microVMs. Each rollout's code runs in its own disposable VM, and NeMo Gym picks Tenki the same way it picks Docker or E2B: by the provider name in its config.

NeMo Gym loads sandbox providers from the `nemo_gym.sandbox_providers` entry point. Installing [`nemo-gym-tenki`](https://github.com/opencolin/nemo-gym-tenki) registers a `tenki` provider there, so it works with the NeMo Gym release on PyPI and needs no change to NeMo Gym.

> **Status: `nemo-gym-tenki` isn't on PyPI yet.** This example installs it from git, pinned to commit `ec0ee66`, the head of [opencolin/nemo-gym-tenki#1](https://github.com/opencolin/nemo-gym-tenki/pull/1), which moves it to the `tenki` 1.x SDK. A built-in `tenki` provider is also proposed upstream in [NVIDIA-NeMo/Gym#2346](https://github.com/NVIDIA-NeMo/Gym/pull/2346), which is open.

## Quick start

NeMo Gym 0.7.0 needs Python 3.13.14 or later. [uv](https://docs.astral.sh/uv/) reads the version from `pyproject.toml` and fetches a matching Python if you don't have one.

```bash
export TENKI_API_KEY=tk_...
uv sync                 # NeMo Gym 0.7.0, nemo-gym-tenki and tenki, into ./.venv
uv run python run.py
```

`run.py` stages an agent's solution into a sandbox, runs its tests there, and scores the result:

```
providers: apptainer, daytona, docker, e2b, ecs_fargate, enroot, local, opensandbox, openshell, tenki
sandbox 01a1…
exit 0: tests passed
reward 1.0
```

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
    await provider.close(handle)  # terminates the microVM
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

- **Auth.** The provider builds a Tenki SDK client, which reads `TENKI_API_KEY` (or the `TENKI_AUTH_TOKEN` alias) and uses the key's workspace. Set `connection.workspace_id` to pick a different one.
- **Spec mapping.** `SandboxSpec.resources` maps to `cpu_cores`, `memory_mb` and `disk_size_gb`; `spec.image` to a Tenki image; `spec.env` and `spec.metadata` pass through; `spec.ttl_s` becomes the VM's hard `max_duration`; `spec.files` are written into `spec.workdir` after the VM boots.
- **Network.** Outbound access is on by default, so rollouts can `pip install` or `git clone`. Set `create.allow_outbound: false` to lock a rollout down.
- **Reconnect across processes.** The provider implements NeMo Gym's optional `ConnectableProvider`: a handle can be serialized and reopened by sandbox ID in another process, which helps distributed rollout collection.
- **CPU only.** Tenki runs CPU microVMs. A spec that asks for `resources.gpu` is rejected; use a GPU provider for those environments.

## Check it works

```bash
node verify.mjs      # or: uv run python verify.py
```

`verify.py` checks that NeMo Gym lists the `tenki` provider, then creates a sandbox through it with a file staged into `spec.workdir` (the path `run.py` uses), runs that file and expects `42`, checks that `spec.env` reached the VM and that a non-zero exit code comes back, closes the sandbox, and confirms its status is no longer running:

```
✓ nemo-gym-tenki: `tenki` provider via entry point → create 01a1… with staged files → exec 42 → env → exit 3 → close (stopped)
```

`verify.mjs` runs `uv sync --locked` first (it installs uv into the current Python if it isn't on your `PATH`), so the cookbook's CI gets the same locked environment you do, separate from the other Python examples.

## Troubleshooting

- ❌ **`No interpreter found for Python >=3.13.14`.** Let uv fetch one (`uv python install 3.13`), or install Python 3.13.14+ yourself.
- ❌ **`NeMo Gym doesn't list a tenki provider`.** `nemo-gym-tenki` isn't installed in the environment you ran. Use `uv run`, or `.venv/bin/python`.
- ❌ **`unexpected keyword argument 'project_id'`.** Your config still sets `connection.project_id`. Tenki SDK 1.x uses workspaces: switch to `connection.workspace_id`, or drop it to use your key's workspace.
- ❌ **`does not attach GPUs`.** The spec requests a GPU; Tenki sandboxes are CPU only.

## Files

| File | Purpose |
|---|---|
| `pyproject.toml`, `uv.lock` | NeMo Gym 0.7.0, the provider pinned to a commit, and `tenki`, locked |
| `run.py` | Stage a solution, run its tests in a sandbox, score it |
| `verify.py`, `verify.mjs` | The live check, and the shim the cookbook's CI runs |

## Related

- [`../smolagents/`](../smolagents/): another framework that hands an agent's code to a Tenki executor
- [`../agentenv-tenki/`](../agentenv-tenki/): agent environments on Tenki
