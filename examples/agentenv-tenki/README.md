# How to run Scale AI's AgentEnv tasks on Tenki VMs

**Audience:** Python developers who build RL environments or agent tasks with Scale AI's AgentEnv Framework and want each environment and each agent on its own cloud VM.
**Time:** ~10 minutes, plus a few more if you build the optional Docker snapshot in Step 6.
**Outcome:** `agent-env run hello --sandbox tenki` runs on a Tenki VM, and `node verify.mjs` prints its `✓` line.

> **Honesty note:** a VM booted from the Tenki base image installs Docker and Compose v2 the first time AgentEnv uses it, which takes a few minutes per new VM. `verify.mjs` skips that step and `agent-env run hello` doesn't. Step 6 snapshots a VM that already has Docker so later VMs skip the install.

[AgentEnv Framework](https://www.agentenvframework.com) is Scale AI's open-source (Apache-2.0) framework for building RL environments: apps exposed over MCP, seed data, a virtual clock, triggers and RBAC. Tasks are written as DAGs of steps that deploy an environment, bring in an agent and grade the result. Sandboxes are pluggable, and `tenki` has been a built-in backend since [agentenv-framework#187](https://github.com/scaleapi/agentenv-framework/pull/187), first released in `agentenv-framework` 0.9.1325. With it, each environment and each agent gets its own [Tenki](https://tenki.cloud) VM, with Docker inside and a public HTTPS URL for every exposed port.

## Prerequisites

- Python 3.11.4 or later (`agentenv-framework` requires it) and `uv`. The steps below create a Python 3.12 venv.
- A Tenki `tk_` API key. Create one as described in [API keys](https://tenki.cloud/docs/account/api-keys).
- Node, only to run the verify shim (`node verify.mjs`). You can run `verify.py` with Python instead.
- The `tenki` CLI, only for the snapshot in Step 6.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/agentenv-tenki
```

Every later command runs from this directory. That matters here: `agent-env` finds this folder's `.agentenv/config.toml` by walking up from the working directory.

## Step 2 — Install

The Tenki SDK is an optional extra of `agentenv-framework`:

```bash
uv venv --python 3.12
uv pip install -r requirements.txt      # agentenv-framework[tenki]
```

`requirements.txt`:

```
agentenv-framework[tenki]>=0.9.1326
tenki[async]>=1.4.1
```

The `[tenki]` extra pins the Tenki Python SDK as `tenki[async]~=1.4.1`. Without the extra, selecting `tenki` fails with a `ConfigError` that names it.

If you'd rather have the CLI as a tool, run `uv tool install 'agentenv-framework[tenki]'` and call `agent-env` instead of `.venv/bin/agent-env`. `verify.py` imports `agent_env`, so the check in Step 5 still needs the venv.

## Step 3 — Authenticate

```bash
export TENKI_API_KEY=tk_...             # https://tenki.cloud/docs/account/api-keys
```

The provider authenticates with the `tenki` Python SDK (1.4), which takes only a `tk_` API key. The provider reads that key from AgentEnv's config, never from the process environment directly, so this folder ships [`.agentenv/config.toml`](.agentenv/config.toml), which points it at `TENKI_API_KEY`:

```toml
[sandbox]
default       = "tenki"
agent_default = "tenki"

[sandbox.providers.tenki.config]
api_key = "env:TENKI_API_KEY"
```

`default` covers environments and sandboxes, and `agent_default` covers agents. For a shared deployment, put the key in your secret store (for example as `tenki_api_key`) and set `api_key = "secret:tenki_api_key"`. Never put the key itself in `config.toml`.

Check what `agent-env` resolved. It prints the file in effect and masks the key:

```bash
.venv/bin/agent-env config show
```

**A key stored by `tenki login` isn't enough for `agent-env`.** `config.toml` resolves `env:TENKI_API_KEY`, so export the variable in the shell you run tasks from. `verify.py` is more lenient: it also reads `TENKI_AUTH_TOKEN` or the key in `~/.config/tenki/config.yaml`.

To keep your local default and pick Tenki per run, add only the `[sandbox.providers.tenki.config]` table to your config and pass `--sandbox tenki`, or `--env-sandbox tenki` / `--agent-sandbox tenki` on `agent-env task run`.

## Step 4 — Run a task on Tenki

The bundled `hello` task deploys a sandbox, loads a file into it and grades it, with no model needed:

```bash
.venv/bin/agent-env run hello --sandbox tenki
.venv/bin/agent-env -v run hello --sandbox tenki   # also logs each VM: session_id, cpu, memory, disk, ports
```

With `-v`, each VM logs a line as it starts: `Tenki VM started: session_id=… cpu=… memory=…MB disk=…GB ports=… attribution=…`.

From there, the [AgentEnv docs](https://www.agentenvframework.com/docs) cover environments, agents and verifiers. Every environment and agent in those tasks lands on its own Tenki VM.

## Step 5 — Check it works

```bash
node verify.mjs        # or: .venv/bin/python verify.py
```

`verify.mjs` is a shim for the cookbook's Node harness: it runs `verify.py` with `.venv/bin/python` if that exists, else `$PYTHON` or `python3`. On success it prints:

```
✓ agentenv-tenki: `tenki` provider from config.toml → create_vm + exposed port → root exec (42) → terminate
```

[`verify.py`](verify.py) resolves the `tenki` backend through `agent-env`'s own registry from this folder's `config.toml`, then drives that provider against the live API:

```python
async def main():
    provider = build_sandbox_provider("tenki")
    if not isinstance(provider, TenkiSandboxProvider):
        raise AssertionError(f"`tenki` resolved to {type(provider).__name__}")

    sb = await provider.create_vm(cpu=2, memory=4096, timeout=600, exposed_ports=[8080], setup_for_gateway=False)
    try:
        url = sb.tunnel_urls.get(8080, "")
        if not url.startswith("https://"):
            raise AssertionError(f"port 8080 URL: {url!r}")
        code, out, err = await sb.exec_with_output("sudo", "sh", "-c", "id -u; python3 -c 'print(6*7)'")
        if code != 0 or out.split() != ["0", "42"]:
            raise AssertionError(f"exec: exit={code} stdout={out!r} stderr={err!r}")
    finally:
        await sb.terminate()
```

This proves that `agent-env` picks up this folder's config, and that the provider boots a live VM, exposes port 8080 on an `https://` URL, runs a command as root (`0`, then `42`) and terminates the VM. It doesn't prove the full task path: `setup_for_gateway=False` skips the Docker bootstrap that `agent-env run hello` does, which takes a few minutes on the base image, and no model or agent is involved. That's why CI runs this check and not `hello`. The provider's own unit and smoke tests live upstream in [scaleapi/agentenv-framework](https://github.com/scaleapi/agentenv-framework/tree/main/src/agent_env/providers/sandbox_providers/tenki).

## Step 6 — Optional: snapshot a VM that has Docker

To skip the Docker install on every new VM, build one VM that has Docker and Compose v2, and snapshot it once with the `tenki` CLI:

```bash
tenki sandbox create --name agentenv-docker --cpu 2 --memory-mb 4096 --disk-size-gb 20 --max-duration 30m
tenki sandbox exec --session agentenv-docker -c 'sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2 docker-buildx curl'
tenki sandbox exec --session agentenv-docker -c 'sudo systemctl start docker && sudo docker info --format "{{.ServerVersion}}"'
tenki sandbox snapshot create agentenv-docker --name agentenv-docker --wait-durable
tenki sandbox terminate agentenv-docker
```

Then add `snapshot_id = "<id>"` under `[sandbox.providers.tenki.config]` (`tenki sandbox snapshot list` lists your snapshots). Every VM booted from it skips the install.

**Keep the snapshot VM at 2 vCPU and 4 GiB.** A VM can be restored larger than its snapshot, not smaller, and 2 vCPU / 4 GiB is the smallest VM the provider starts. Images your environments and agents pull from a registry can be pulled into the same VM before you snapshot it, and VMs booted from it find them in place.

All keys under `[sandbox.providers.tenki.config]` (unknown keys are refused):

- `api_key`, required: an `env:` or `secret:` reference.
- `base_url`: the Tenki API endpoint, default `https://api.tenki.cloud`.
- `snapshot_id`: boot every VM from this snapshot.
- `image`: boot every VM from this Tenki registry image instead. Set at most one of `image` and `snapshot_id`.
- `min_disk_gb`: the smallest VM disk, default `20`. Docker keeps both compressed and extracted layers, so agent-env's 10 GB default is raised.

## What the provider does

- **One VM per sandbox.** The gateway's docker-compose, an agent's `docker run`, image loading and artifact collection run under Docker inside the VM. Commands run as root, so the `sudo` agent-env prefixes is dropped.
- **Ports:** each exposed port gets a public HTTPS URL under `sb.tenki.sh` (HTTP and WebSocket), with no platform authentication.
- **Egress:** allow-all, or an allowlist of up to 256 hostnames and 64 IPv4 CIDRs, applied outside the VM so it covers `dockerd` and every container. Tenki's own preview domains (`*.sb.tenki.sh`, `*.us.sb.tenki.sh`) are always allowed, so a restricted agent can still reach its environments. A wildcard covers one label: `*.example.com` matches `files.example.com`, not `a.b.example.com`.
- **Sizing:** whole vCPUs, with a floor of 2 vCPU / 4 GiB. A request beyond Tenki's limits is refused before anything is created, not shrunk.
- **Lifetime:** the sandbox `timeout` is the VM's hard maximum lifetime, so a crashed run can't leave a VM running past it. It is also every command's time budget. A VM whose setup fails is terminated.
- **Attribution:** every VM is tagged `agentenv`. `tenki sandbox list --tags agentenv` lists them, and `tenki sandbox get <session id> --json` shows a VM's metadata.

## Troubleshooting

**❌ ``✗ The `tenki` SDK (1.4) behind agent-env's provider takes only a `tk_` API key.``** `verify.py` found no `tk_` key in `TENKI_API_KEY`, `TENKI_AUTH_TOKEN` or `~/.config/tenki/config.yaml`. Create a key at https://tenki.cloud/docs/account/api-keys and `export TENKI_API_KEY=tk_...`.

**❌ `Unresolved env:TENKI_API_KEY reference (no value and no default)`.** `config.toml` points the provider at `TENKI_API_KEY`, and it isn't set in this shell. `agent-env` doesn't read the key `tenki login` stores. Export the variable.

**❌ `[sandbox.providers.tenki.config] requires a non-empty 'api_key'`.** `agent-env` didn't find a config with the Tenki table, usually because you ran it from outside this folder. Run from `examples/agentenv-tenki`, or add the table to your own config. `agent-env config show` prints which file is in effect.

**❌ Selecting `tenki` fails with a `ConfigError` that names the `tenki` extra.** The Tenki SDK isn't installed. Run `uv pip install -r requirements.txt`, or install `'agentenv-framework[tenki]'`.

**❌ `[sandbox.providers.tenki.config] has unknown key(s): [...]`.** The provider accepts only `api_key`, `base_url`, `image`, `snapshot_id` and `min_disk_gb`. Fix the key name.

**❌ `[sandbox.providers.tenki.config] takes at most one of 'image' and 'snapshot_id'`.** Both are set. Keep one.

**❌ `Tenki cannot size a VM for cpu=…, memory=…MB, disk=…GB`.** The request is beyond Tenki's limits (128 vCPU, 512 GiB memory, 100 GB disk). A workspace's own lower limit is enforced when the VM is created. Ask for less.

**❌ `NetworkPolicyUnsupportedError`.** The run's egress policy has IPv6 or malformed entries, or more than 256 hostnames or 64 CIDRs. It is refused before anything is created, and a fallback chain skips to its next provider. Use IPv4 entries within those limits.

**❌ A VM with an egress allowlist can't install Docker or pull images.** Tenki sets a VM's egress when it is created, and installing Docker on the base image, image pulls and builds all need their registries allowed. Boot allowlisted VMs from a snapshot that has Docker (Step 6), and allow the registries you pull from.

**❌ Warning: `Tenki capped VM …'s lifetime to …s of the …s requested`.** Your workspace's maximum session duration is lower than the task's `timeout`, so Tenki granted less. The provider budgets commands by the lifetime granted. Request a `timeout` that fits, or expect the VM to stop at the granted lifetime.

## FAQ

**When shouldn't I use this?**
When you need GPUs, which the provider doesn't support. When a step must boot a specific OCI image per call: `create_vm(image=...)` is refused, VMs boot the configured `image` or `snapshot_id`, and OCI images run under Docker inside them. When an exposed port must not be reachable from the internet, since port URLs are public with no platform authentication. When your agent's model key must stay out of the sandbox: an agent's `LITELLM_API_KEY` is passed into its sandbox, as on other providers. And when your egress rules need IPv6.

**Do I need a model key?**
Not for `hello` or `verify.py`. Tasks with agents read the model endpoint and key from AgentEnv's `[model]` table, and the agent's `LITELLM_API_KEY` is passed into its Tenki VM.

## Related

- [AgentEnv Framework](https://www.agentenvframework.com) and its [docs](https://www.agentenvframework.com/docs)
- [agentenv-framework#187](https://github.com/scaleapi/agentenv-framework/pull/187), the PR that added the `tenki` provider
- Provider reference: [tenki/README.md](https://github.com/scaleapi/agentenv-framework/blob/main/src/agent_env/providers/sandbox_providers/tenki/README.md) upstream
- [Tenki docs](https://tenki.cloud/docs)
- [`../snapshots-pause-resume/`](../snapshots-pause-resume/): Tenki snapshots from the SDK
