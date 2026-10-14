# Scale AI's AgentEnv on Tenki

[AgentEnv Framework](https://www.agentenvframework.com) is Scale AI's open-source (Apache-2.0) framework for building RL environments: apps exposed over MCP, seed data, a virtual clock, triggers and RBAC, with tasks written as DAGs of steps that deploy an environment, bring in an agent and grade the result. Sandboxes are pluggable, and since [agentenv-framework#187](https://github.com/scaleapi/agentenv-framework/pull/187) (released in `agentenv-framework` 0.9.1326) `tenki` is a built-in backend: each environment and each agent gets its own [Tenki](https://tenki.cloud) VM, with Docker inside and a public HTTPS URL for every exposed port.

## Set up (Python 3.11.4+)

The Tenki SDK is an optional extra:

```bash
uv venv --python 3.12
uv pip install -r requirements.txt      # agentenv-framework[tenki]
export TENKI_API_KEY=tk_...             # https://tenki.cloud/docs/account/api-keys
```

Or install the CLI as a tool: `uv tool install 'agentenv-framework[tenki]'`.

The provider authenticates with the `tenki` Python SDK (1.4), which takes only a `tk_` API key. It reads the key from its config, never from the environment directly, so this folder ships an [`.agentenv/config.toml`](.agentenv/config.toml) that points at it:

```toml
[sandbox]
default       = "tenki"   # environments and sandboxes
agent_default = "tenki"   # agents

[sandbox.providers.tenki.config]
api_key = "env:TENKI_API_KEY"   # or "secret:tenki_api_key" from your secret store
```

`agent-env` finds the file by walking up from the working directory; `agent-env config show` prints what it resolved, with the key masked. To keep your local default and pick Tenki per run, add only the `[sandbox.providers.tenki.config]` table and pass `--sandbox tenki` (or `--env-sandbox tenki` / `--agent-sandbox tenki` on `agent-env task run`).

## Run a task on Tenki

The bundled `hello` task deploys a sandbox, loads a file into it and grades it, with no model needed:

```bash
.venv/bin/agent-env run hello --sandbox tenki
.venv/bin/agent-env -v run hello --sandbox tenki   # also logs each VM: session_id, cpu, memory, disk, ports
```

From there, the [AgentEnv docs](https://www.agentenvframework.com/docs) cover environments, agents and verifiers; every environment and agent in those tasks lands on its own Tenki VM.

## Faster startup

A VM booted from the Tenki base image installs Docker and Compose v2 the first time AgentEnv uses it. Snapshot a VM that has them once:

```bash
tenki sandbox create --name agentenv-docker --cpu 2 --memory-mb 4096 --disk-size-gb 20 --max-duration 30m
tenki sandbox exec --session agentenv-docker -c 'sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2 docker-buildx curl'
tenki sandbox exec --session agentenv-docker -c 'sudo systemctl start docker && sudo docker info --format "{{.ServerVersion}}"'
tenki sandbox snapshot create agentenv-docker --name agentenv-docker --wait-durable
tenki sandbox terminate agentenv-docker
```

Then add `snapshot_id = "<id>"` under `[sandbox.providers.tenki.config]`. Keep the snapshot VM at 2 vCPU and 4 GiB: a VM can be restored larger than its snapshot, not smaller. Other keys: `base_url`, `image` (a Tenki registry image, instead of `snapshot_id`) and `min_disk_gb` (default 20).

## What the provider does

- **One VM per sandbox.** The gateway's docker-compose, an agent's `docker run`, image loading and artifact collection run under Docker inside the VM. Commands run as root.
- **Ports:** each exposed port gets a public HTTPS URL under `sb.tenki.sh` (HTTP and WebSocket).
- **Egress:** allow-all, or an allowlist of up to 256 hostnames and 64 IPv4 CIDRs, applied outside the VM so it covers `dockerd` and every container. Tenki's own preview domains are always allowed, so a restricted agent can still reach its environments.
- **Sizing:** whole vCPUs, with a floor of 2 vCPU / 4 GiB; a request beyond Tenki's limits is refused before anything is created.
- **Lifetime:** the sandbox `timeout` is the VM's hard maximum lifetime, so a crashed run can't leave a VM running past it. A VM whose setup fails is terminated.
- **Attribution:** every VM is tagged `agentenv` (`tenki sandbox list --tags agentenv`).

## Verify

```bash
node verify.mjs        # or: .venv/bin/python verify.py
```

[`verify.py`](verify.py) resolves the `tenki` backend through `agent-env`'s own registry from this folder's `config.toml`, then drives that provider against the live API: `create_vm` with an exposed port → checks the `https://` port URL → runs a command as root (`42`) → terminates. It skips the Docker bootstrap that `agent-env run hello` does, which takes a few minutes on the base image; the provider's own unit and smoke tests live upstream in [scaleapi/agentenv-framework](https://github.com/scaleapi/agentenv-framework/tree/main/src/agent_env/providers/sandbox_providers/tenki).

## Notes

- GPUs are not supported, and a per-call `image` is refused: VMs boot the configured `image` or `snapshot_id`, and OCI images run under Docker inside them.
- An agent's `LITELLM_API_KEY` is passed into its sandbox, as on other providers.
- Provider reference: [tenki/README.md](https://github.com/scaleapi/agentenv-framework/blob/main/src/agent_env/providers/sandbox_providers/tenki/README.md) upstream.
