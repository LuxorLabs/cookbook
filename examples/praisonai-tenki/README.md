# PraisonAI

Run a [PraisonAI](https://github.com/MervinPraison/PraisonAI) agent team on one shared Tenki sandbox. `tools_run_on="tenki"` provisions one sandbox for the run, binds every agent's `execute_command`, `read_file`, `write_file`, and `list_files` tools to it, and shuts it down when the run ends. All agents share one filesystem, so a file one step writes is there for the next. Model calls stay on your machine. The sandbox is created on the first tool call, so a run that never uses those tools never creates one.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "PraisonAI" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/praisonai-tenki, create a .venv there on Python 3.10 or later, and install requirements.txt. The install takes a couple of minutes.
2. It needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) in the environment. If it isn't set, stop and ask me to export it. Never print the key or write it to a file.
3. Run node verify.mjs and confirm the ✓ line.
4. If I want a team run: check that OPENAI_API_KEY (or another LLM key) is set, ask me if not, then save the team snippet from the README as team.py and run it with .venv/bin/python.
5. If a step fails, use the Troubleshooting table in the example's README.md.
Then show me how to put my own PraisonAI team on one Tenki sandbox with tools_run_on="tenki", creating /workspace first.
```

## Quick start

You need:

- Python 3.10 or later. [uv](https://docs.astral.sh/uv/) is optional.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An LLM key such as `OPENAI_API_KEY`, for a team run only.

### 1. Install

Create the venv in the example directory as `.venv`; `verify.mjs` looks for it there.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/praisonai-tenki
uv venv --python 3.12
uv pip install -r requirements.txt   # praisonai[tenki]>=4.7.14, tenki>=1.4.1
```

Without uv: `python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt`. The install pulls in litellm, textual, and several `praisonai-*` packages, so it takes a couple of minutes. Use `praisonai` 4.7.14 or later with `praisonaiagents` 1.7.12 or later; older pairings break the `"tenki"` lookup.

### 2. Set your API key

```bash
export TENKI_API_KEY=tk_...   # or TENKI_AUTH_TOKEN
```

A team run reads the key from `TenkiCompute(api_key=...)`, `TENKI_AUTH_TOKEN`, or `TENKI_API_KEY`. `verify.py` also accepts a key saved with `tenki login --api-key <key>`, but a team run doesn't. Without `TENKI_WORKSPACE_ID`, sandboxes go in the first workspace your key returns.

### 3. Verify

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

```
✓ praisonai-tenki: tools_run_on="tenki" resolves → provision → execute 42 → file round-trip → shutdown
```

`verify.py` checks that `"tenki"` resolves to `TenkiCompute`, then provisions a real sandbox, runs `python3`, creates `/workspace`, round-trips 256 random bytes, and shuts it down. It needs no LLM key and doesn't run an agent turn.

### 4. Run a team

```python
from praisonaiagents import Agent, PraisonAIAgents

researcher = Agent(instructions=(
    "Create /workspace if missing: sudo mkdir -p /workspace && sudo chown $(id -un) /workspace. "
    "Then inspect the Python environment on the sandbox and write what you find "
    "to /workspace/notes.md"
))
writer = Agent(instructions=(
    "Read /workspace/notes.md and write a two-line summary to /workspace/report.md"
))

team = PraisonAIAgents(agents=[researcher, writer], tools_run_on="tenki")
team.start()   # one Tenki sandbox for the whole run, shut down at the end
```

`PraisonAIAgents` is the older name for `AgentTeam`; `Workflow` (`AgentFlow`) also takes `tools_run_on="tenki"`. For a single agent, use `Agent(..., tools_run_on="tenki")` or `LocalAgent(tools_run_on="tenki")`. To set the key or workspace in code, pass `TenkiCompute(api_key=..., workspace_id=...)` instead of the string.

## Create `/workspace` first

Tenki's stock image has no `/workspace`, commands run as user `tenki` (with passwordless sudo), and PraisonAI's tools don't create the directory. That's why the first agent above runs `sudo mkdir`. Alternatives: use `$HOME` paths, or use a custom image with `metadata={"tenki_image": ...}`.

## Size the sandbox with `ComputeConfig`

When you call the provider yourself, as `verify.py` does, a `ComputeConfig` describes the VM:

```python
# 2. Live: the same provider class against a real sandbox.
compute = TenkiCompute(api_key=resolve_token())
config = ComputeConfig(cpu=1, memory_mb=1024, idle_timeout_s=120)

try:
    info = asyncio.run(compute.provision(config))
except Exception as e:  # noqa
    print(f"✗ provision failed: {type(e).__name__}: {e}")
    sys.exit(1)
```

| `ComputeConfig` | Tenki | Notes |
| --- | --- | --- |
| `cpu`, `memory_mb` | `cpu_cores`, `memory_mb` | VM size |
| `env` | `env` | environment variables inside the sandbox |
| `networking={"type": "unrestricted"}` (the default) | `allow_outbound=True` | Tenki's outbound control is a single boolean, so any other type (e.g. `"limited"`) disables outbound entirely |
| `metadata={"tenki_image": ...}` | `image` | a Tenki registry snapshot ref; wins over `ComputeConfig.image`, whose Docker-style default means "Tenki's stock image" |
| `packages={"pip": [...], "npm": [...]}` | bootstrapped after boot | installs pip/npm via `apt-get` if missing; a failed install **tears the sandbox down** instead of reporting it ready |
| `auto_shutdown` + `idle_timeout_s` | in-process idle timer | the provider shuts the sandbox down after `idle_timeout_s` with no activity (on by default, 300 s). The timer runs in your Python process, so it stops if the process dies |

The idle timer is PraisonAI's, not Tenki's: it runs in your Python process and stops if the process dies. Tenki doesn't end idle sandboxes on its own.

A `tools_run_on="tenki"` run uses the defaults: 1 CPU, 1024 MB, outbound on, the stock image, and a 300-second idle timer. `get_status` and `list_instances` read live Tenki state.

`TenkiCompute` lives in `praisonai-sandbox` as `praisonai_sandbox.compute.tenki`. The old `praisonai.integrations.compute.tenki` import still works.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | Export `TENKI_API_KEY` or run `tenki login --api-key <key>`. |
| `Token must be a tk_ API key …` or `invalid auth token …` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `missing auth token` during a team run | A team run doesn't read the `tenki login` key. Export `TENKI_API_KEY` or pass `TenkiCompute(api_key=...)`. |
| `TypeError: … unexpected keyword argument 'compute'` | Use `tools_run_on="tenki"`. |
| Permission error writing to `/workspace/...` | Create it with `sudo` first, as above. |
| `ImportError: Tenki SDK required` | Install `requirements.txt`, which includes the `[tenki]` extra. |
| `RuntimeError: pip install failed: …` from `provision` | A package in `ComputeConfig.packages` failed, so the sandbox was torn down. Fix the spec. |

## Related

- [PraisonAI](https://github.com/MervinPraison/PraisonAI) and its [Tenki provider source](https://github.com/MervinPraison/PraisonAI/blob/main/src/praisonai-sandbox/praisonai_sandbox/compute/tenki.py)
- [CrewAI](../crewai-code-interpreter/) and [smolagents](../smolagents/)
- [Tenki docs](https://tenki.cloud/docs)
