# PraisonAI agent teams on Tenki

[PraisonAI](https://github.com/MervinPraison/PraisonAI) is a Python multi-agent framework: describe agents, hand them tools, and let a team or workflow run them in sequence, parallel, or hierarchy. Its Tenki compute provider gives a whole team **one shared [Tenki](https://tenki.cloud) microVM**: `compute="tenki"` provisions a single Firecracker sandbox for the run, binds every agent's `execute_command` / `read_file` / `write_file` / `list_files` tools to it, and tears it down when the run ends. Because all agents share the same `/workspace`, files written by one step are already there for the next.

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

team = PraisonAIAgents(agents=[researcher, writer], compute="tenki")
team.start()   # one Tenki microVM for the whole run, shut down at the end
```

The snippet needs an LLM key (e.g. `OPENAI_API_KEY`) like any PraisonAI run; the verify script below does not. `Workflow(..., compute="tenki")` works the same way, and provisioning is lazy — a run that never touches the sandbox never creates one. Passing a configured `TenkiCompute()` instance instead of the string also works.

## Setup (Python 3.10+)

```bash
uv venv --python 3.12                # or: python3.12 -m venv .venv
uv pip install -r requirements.txt   # praisonai[tenki]>=4.7.14
export TENKI_API_KEY=tk_...          # or TENKI_AUTH_TOKEN; optional TENKI_WORKSPACE_ID
```

**Install note.** `praisonai[tenki]` installs `praisonaiagents`, `praisonai-sandbox` (where `TenkiCompute` lives, as `praisonai_sandbox.compute.tenki`; the old `praisonai.integrations.compute` import still works) and the `tenki` SDK (>=1.4.0). Use releases from `praisonai` 4.7.14 / `praisonaiagents` 1.7.12 on, and don't pair an older `praisonaiagents` with a newer `praisonai`, or the `compute="tenki"` lookup breaks. The base install is heavy (litellm, textual, several `praisonai-*` packages), so expect a couple of minutes.

The provider uses `tenki` SDK 1.x, which accepts only `tk_` API keys.

Without `TENKI_WORKSPACE_ID`, sandboxes land in the first workspace on your account.

## What `ComputeConfig` maps to on Tenki

| `ComputeConfig` | Tenki | Notes |
| --- | --- | --- |
| `cpu`, `memory_mb` | `cpu_cores`, `memory_mb` | VM size |
| `env` | `env` | environment variables inside the sandbox |
| `networking={"type": "unrestricted"}` | `allow_outbound=True` | Tenki's outbound control is a single boolean, so any other type (e.g. `"limited"`) disables outbound entirely |
| `metadata={"tenki_image": ...}` | `image` | a Tenki registry snapshot ref; wins over `ComputeConfig.image`, whose Docker-style default means "Tenki's stock image" |
| `packages={"pip": [...], "npm": [...]}` | bootstrapped after boot | installs pip/npm via `apt-get` if missing; a failed install **tears the sandbox down** instead of reporting it ready |
| `auto_shutdown` + `idle_timeout_s` | in-process idle timer | the provider shuts the sandbox down after `idle_timeout_s` with no activity. The timer runs in your Python process, so it stops if the process dies |

## Verify

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

[`verify.py`](verify.py) proves the two halves without needing an LLM key: **registration** — `TenkiCompute` imports (module + barrel) and the core SDK's compute bridge resolves the string `"tenki"` to it, the exact path `compute="tenki"` takes — and **live** — provision a real microVM through the provider, run a command, round-trip a file byte-for-byte, shut down:

```
✓ praisonai-tenki: compute="tenki" resolves → provision → execute 42 → file round-trip → shutdown
```

## Notes

- The provider uses the **new `tenki` SDK** (`pip install tenki`), not the older `tenki-sandbox` package.
- Tenki's stock image runs commands as user `tenki` (passwordless sudo) and ships **without a `/workspace` directory**. The shared-workspace tools don't create it either (still true in praisonai 4.7.14). Have the first agent run `execute_command('sudo mkdir -p /workspace && sudo chown "$(id -un)" /workspace')`, use `$HOME` paths instead, or bake it into a custom image via `metadata={"tenki_image": ...}`. `verify.py` does exactly this.
- `get_status` / `list_instances` reconcile against live Tenki state, so a sandbox reaped by the idle timeout stops reporting `RUNNING`.
- The deprecated spelling `ManagedAgent(provider="tenki")` still works but warns; use `compute="tenki"` (or `LocalAgent(compute="tenki")` for a single agent).
