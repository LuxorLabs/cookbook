# How to run a PraisonAI agent team on one shared Tenki sandbox

**Audience:** Python developers who build agent teams or workflows with PraisonAI and want the agents' shell and file tools to run in a disposable cloud VM instead of on their own machine.
**Time:** ~5 minutes.
**Outcome:** `node verify.mjs` prints its `✓` line after PraisonAI's Tenki provider boots a live microVM, runs a command in it, round-trips a file and shuts it down. You also have the snippet that puts a whole team on one sandbox.

> **Honesty note:** Tenki's stock image has no `/workspace` directory, and PraisonAI's shared tools don't create it. If your agents write under `/workspace`, the first one has to create it with `sudo`, as the snippet in [Use it](#use-it) does.

## Why bother

[PraisonAI](https://github.com/MervinPraison/PraisonAI) is a Python multi-agent framework. You describe agents, give them tools, and a team or workflow runs them in sequence, in parallel, or in a hierarchy. Its Tenki compute provider gives a whole team one shared [Tenki](https://tenki.cloud) microVM. `tools_run_on="tenki"` provisions a single Firecracker sandbox for the run, binds every agent's `execute_command`, `read_file`, `write_file` and `list_files` tools to it, and tears it down when the run ends. All agents share one filesystem, so a file one step writes is already there for the next. The model calls stay on your machine. Only those four tools move.

Provisioning is lazy: a run that never calls one of those tools never creates a sandbox.

## Install

You need Python 3.10 or later (`praisonai` 4.7.14 supports up to 3.14), and Node 20 or later if you want to run the check through `verify.mjs`. Get the example:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/praisonai-tenki
```

Every later command runs from this directory. Create a virtualenv and install the pins:

```bash
uv venv --python 3.12                # or: python3.12 -m venv .venv
uv pip install -r requirements.txt   # praisonai[tenki]>=4.7.14
```

Without uv, create the venv with `python3.12 -m venv .venv` and install with `.venv/bin/pip install -r requirements.txt`. Keep the name `.venv`, because `verify.mjs` looks for `.venv/bin/python`.

The pins in `requirements.txt`:

```
# praisonai 4.7.14+ ships the Tenki compute provider. The [tenki] extra pulls in
# praisonai-sandbox (where TenkiCompute now lives); praisonai itself requires the
# matching praisonaiagents>=1.7.12.
praisonai[tenki]>=4.7.14
tenki>=1.4.1
```

`praisonai[tenki]` installs `praisonaiagents`, `praisonai-sandbox` and the `tenki` SDK (`>=1.4.0`). `TenkiCompute` lives in `praisonai-sandbox` as `praisonai_sandbox.compute.tenki`. The old `praisonai.integrations.compute.tenki` import still works and gives you the same class.

Use `praisonai` 4.7.14 or later with `praisonaiagents` 1.7.12 or later. Pairing an older `praisonaiagents` with a newer `praisonai` breaks the `"tenki"` lookup. The base install is heavy (litellm, textual, several `praisonai-*` packages), so expect it to take a couple of minutes.

## Authenticate

Create a `tk_` API key at https://app.tenki.cloud and export it:

```bash
export TENKI_API_KEY=tk_...          # or TENKI_AUTH_TOKEN; optional TENKI_WORKSPACE_ID
```

The provider uses `tenki` SDK 1.x, which accepts only `tk_` API keys.

`verify.py` also reads a key stored with `tenki login --api-key <key>` in `~/.config/tenki/config.yaml`. A team run doesn't. The provider takes an explicit `api_key`, then `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY`, and the SDK client it builds doesn't read that file. **Export one of the variables before you run a team**, even if `tenki login` already worked for the check.

Without `TENKI_WORKSPACE_ID`, the provider calls `who_am_i()` and puts sandboxes in the first workspace your key returns.

## Use it

A team run needs an LLM key (for example `OPENAI_API_KEY`), like any PraisonAI run. The check in [Check it works](#check-it-works) doesn't.

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
team.start()   # one Tenki microVM for the whole run, shut down at the end
```

`PraisonAIAgents` is the older name for `AgentTeam`, and both accept `tools_run_on=`. `Workflow(..., tools_run_on="tenki")` (`Workflow` is the older name for `AgentFlow`) works the same way. To set the key or workspace in code, pass a `TenkiCompute(api_key=..., workspace_id=...)` instance instead of the string.

The stock image runs commands as user `tenki`, which has passwordless sudo. It ships without `/workspace`, and the shared-workspace tools don't create it either (as of praisonai 4.7.14). That's why the first agent's instructions start with the `sudo mkdir`. The other ways around it are to use `$HOME` paths, or to bake the directory into a custom image via `metadata={"tenki_image": ...}` where you build the `ComputeConfig` yourself.

## Size the sandbox with `ComputeConfig`

When you call the provider yourself, as `verify.py` does, a `ComputeConfig` describes the VM. From `verify.py`:

```python
# 2. Live: the same provider class against a real microVM.
compute = TenkiCompute(api_key=resolve_token())
config = ComputeConfig(cpu=1, memory_mb=1024, idle_timeout_s=120)

try:
    info = asyncio.run(compute.provision(config))
except Exception as e:  # noqa
    print(f"✗ provision failed: {type(e).__name__}: {e}")
    sys.exit(1)
```

Here's what each field maps to on Tenki:

| `ComputeConfig` | Tenki | Notes |
| --- | --- | --- |
| `cpu`, `memory_mb` | `cpu_cores`, `memory_mb` | VM size |
| `env` | `env` | environment variables inside the sandbox |
| `networking={"type": "unrestricted"}` (the default) | `allow_outbound=True` | Tenki's outbound control is a single boolean, so any other type (e.g. `"limited"`) disables outbound entirely |
| `metadata={"tenki_image": ...}` | `image` | a Tenki registry snapshot ref; wins over `ComputeConfig.image`, whose Docker-style default means "Tenki's stock image" |
| `packages={"pip": [...], "npm": [...]}` | bootstrapped after boot | installs pip/npm via `apt-get` if missing; a failed install **tears the sandbox down** instead of reporting it ready |
| `auto_shutdown` + `idle_timeout_s` | in-process idle timer | the provider shuts the sandbox down after `idle_timeout_s` with no activity (on by default, 300 s). The timer runs in your Python process, so it stops if the process dies |

The idle timer is PraisonAI's, not a Tenki setting. Tenki itself doesn't pause or end a sandbox for being idle.

A team or workflow run started with `tools_run_on="tenki"` builds its own `ComputeConfig` from the defaults: 1 CPU, 1024 MB, outbound on, the stock image and the 300-second idle timer.

`get_status` and `list_instances` check live Tenki state, so a sandbox that Tenki ended on its side (for example at its lifetime cap) stops reporting `RUNNING`.

## Check it works

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

`verify.mjs` runs `verify.py` with `.venv/bin/python` if it exists, and otherwise with `$PYTHON` or `python3`. On success it prints:

```
✓ praisonai-tenki: tools_run_on="tenki" resolves → provision → execute 42 → file round-trip → shutdown
```

[`verify.py`](verify.py) runs two checks, and neither needs an LLM key. The registration check confirms that `TenkiCompute` imports from both paths and that the core SDK's resolver (`praisonaiagents`) turns the string `"tenki"` into a `TenkiCompute`. That resolver is the lookup `tools_run_on="tenki"` goes through. The live check provisions a real microVM through the provider and runs `python3 -c 'print(6 * 7)'`. It creates `/workspace` with the same `sudo mkdir` a team run on the stock image needs, round-trips 256 random bytes byte-for-byte, and shuts the VM down:

```python
    # The stock image runs as user `tenki` and has no /workspace yet; create it
    # once, exactly as a real team run on the stock image would (see README).
    r = asyncio.run(compute.execute(
        info.instance_id,
        'sudo mkdir -p /workspace && sudo chown "$(id -un)" /workspace',
    ))
    assert r["exit_code"] == 0, r
```

The check doesn't run an agent turn. It doesn't test how the four tools get bound to a team's agents, or a full team run.

## Troubleshooting

**❌ ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.py` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY` or `~/.config/tenki/config.yaml`. Export `TENKI_API_KEY=tk_...`, or run `tenki login --api-key <key>`.

**❌ `Token must be a tk_ API key (tenki SDK 1.x). Set TENKI_API_KEY=tk_...`** (or, during a team run, `invalid auth token: expected an API key or service token starting with tk_`). The key you supplied doesn't start with `tk_`, and SDK 1.x accepts nothing else. Create a `tk_` key at https://app.tenki.cloud.

**❌ A team run fails with `missing auth token: set TENKI_AUTH_TOKEN or TENKI_API_KEY`.** The provider's SDK client reads the key only from those variables or an explicit `api_key`, not from `~/.config/tenki/config.yaml`. Export `TENKI_API_KEY` in the shell that runs your team, or pass `TenkiCompute(api_key=...)`.

**❌ `TypeError: ... got an unexpected keyword argument 'compute'`.** In `praisonaiagents` 1.7.x, `AgentTeam`/`PraisonAIAgents` and `AgentFlow`/`Workflow` name the argument `tools_run_on=`, not `compute=`. Pass `tools_run_on="tenki"`.

**❌ An agent's write to `/workspace/...` fails with a permission error.** The stock image has no `/workspace`, commands run as user `tenki`, and `write_file` creates parent directories without `sudo`. Have the first agent run `sudo mkdir -p /workspace && sudo chown "$(id -un)" /workspace`, use `$HOME` paths, or bake the directory into a custom image via `metadata={"tenki_image": ...}`.

**❌ `✗ provision failed: ImportError: Tenki SDK required. Install with: pip install tenki`.** You installed `praisonai` without the `[tenki]` extra, so the `tenki` SDK is missing. Install from `requirements.txt`, which pulls in `praisonai[tenki]` and `tenki>=1.4.1`.

**❌ `RuntimeError: pip install failed: ...` (or `npm install failed: ...`) from `provision`.** A package in `ComputeConfig.packages` failed to install. The provider tears the sandbox down rather than hand back a half-provisioned one. Fix the package spec and provision again.

## FAQ

**When shouldn't I use this?**
When your agents need per-host network rules: Tenki's outbound control is a single boolean, so any `networking` type other than `"unrestricted"` turns outbound off entirely. When agents must not see each other's files: a team or workflow run shares one sandbox and one filesystem by design. When results have to outlive the run: the sandbox, and everything in it, is torn down when the run ends. When your process might die mid-run: the idle timer lives in your Python process, so if the process dies, nothing on the PraisonAI side shuts the sandbox down. And when you need a light install, because `praisonai` pulls in litellm, textual and several `praisonai-*` packages.

**Can I put a single agent on Tenki instead of a whole team?**
Yes. `Agent(..., tools_run_on="tenki")` moves that one agent's tools. `LocalAgent(compute="tenki")` still works in praisonai 4.7.14 but emits a `FutureWarning` asking for `LocalAgent(tools_run_on="tenki")`. The deprecated spelling `ManagedAgent(provider="tenki")` also still works but warns. Use `LocalAgent(tools_run_on="tenki")` instead.

**Does the check need an LLM key?**
No. `verify.py` drives the provider directly, not an agent run, so it needs only a Tenki key.

## Related

- [PraisonAI](https://github.com/MervinPraison/PraisonAI), and its Tenki provider source, [`praisonai_sandbox/compute/tenki.py`](https://github.com/MervinPraison/PraisonAI/blob/main/src/praisonai-sandbox/praisonai_sandbox/compute/tenki.py)
- [`praisonai` on PyPI](https://pypi.org/project/praisonai/)
- [Tenki docs](https://tenki.cloud/docs)
- [`../crewai-code-interpreter/`](../crewai-code-interpreter/): a CrewAI agent with a Tenki code-interpreter tool
- [`../smolagents/`](../smolagents/): a smolagents `CodeAgent` that runs its code in a Tenki sandbox
