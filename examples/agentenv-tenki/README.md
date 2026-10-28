# AgentEnv

Give every AI agent task you test or train on its own disposable cloud machine.

[AgentEnv Framework](https://www.agentenvframework.com), from Scale AI, is an open-source (Apache-2.0) tool for building **environments**: reproducible setups where an AI agent attempts a job and gets a score. A coding environment might start a web app, ask an agent to fix a bug in it, then run the app's tests to grade the fix. Teams use these scores to evaluate agents and to train models with **reinforcement learning (RL)**, where the score is the signal the model learns from.

In AgentEnv, a **task** is a list of steps that run in order: deploy the environment, bring in the agent, and grade the result. Each environment and each agent runs inside a **sandbox**, a machine AgentEnv starts for that run. The built-in `tenki` sandbox backend makes each of those a Tenki VM, with Docker installed and a public HTTPS URL for every port the task opens. Nothing runs on your computer, and you can run many tasks side by side.

This example runs AgentEnv's bundled `hello` task on Tenki. It needs no model key.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Run Scale AI's AgentEnv tasks on Tenki VMs, following https://github.com/LuxorLabs/cookbook/tree/main/examples/agentenv-tenki.
1. Clone https://github.com/LuxorLabs/cookbook and cd into examples/agentenv-tenki. Run every later command from there.
2. Check that uv and Python 3.11.4+ are available, then run uv venv --python 3.12 and uv pip install -r requirements.txt.
3. It needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) exported in the shell. If it isn't set, stop and ask me to export it. Never print the key or write it to a file.
4. Run .venv/bin/agent-env -v run hello --sandbox tenki (the first run installs Docker in the VM and takes a few minutes), then node verify.mjs, and confirm the ✓ line.
5. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- Python 3.11.4 or later and [uv](https://docs.astral.sh/uv/).
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- The `tenki` CLI, only for the optional snapshot.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/agentenv-tenki
uv venv --python 3.12
uv pip install -r requirements.txt   # agentenv-framework[tenki]>=0.9.1326, tenki[async]>=1.4.1
```

Run every command from this folder. `agent-env` reads its settings from `.agentenv/config.toml`, which it looks for in the current folder and its parents. To install the CLI as a tool instead, run `uv tool install 'agentenv-framework[tenki]'` and call `agent-env`.

### 2. Set your API key

```bash
export TENKI_API_KEY=tk_...
```

AgentEnv only reads the key through its config file. This folder's [`.agentenv/config.toml`](.agentenv/config.toml) makes Tenki the default and tells it to read the key from that variable:

```toml
[sandbox]
default       = "tenki"
agent_default = "tenki"

[sandbox.providers.tenki.config]
api_key = "env:TENKI_API_KEY"
```

`default` sets where environments run and `agent_default` sets where agents run. A `tenki login` key isn't enough for `agent-env`. For a shared deployment, use `api_key = "secret:tenki_api_key"`, and never put the key itself in the file. `.venv/bin/agent-env config show` prints the config in effect with the key masked.

### 3. Run

The bundled `hello` task is the smallest possible task: it starts a sandbox, copies a file into it, and checks the file is there. It uses no model:

```bash
.venv/bin/agent-env -v run hello --sandbox tenki
```

With `-v`, each VM logs `Tenki VM started: session_id=… cpu=… memory=…MB disk=…GB ports=…`. The first run on the base image installs Docker and Compose v2, which takes a few minutes. A [snapshot](#start-vms-faster-from-a-snapshot) skips that.

### 4. Verify

```bash
node verify.mjs        # or: .venv/bin/python verify.py
```

```
✓ agentenv-tenki: `tenki` provider from config.toml → create_vm + exposed port → root exec (42) → terminate
```

[`verify.py`](verify.py) is a faster check of the Tenki side. It asks AgentEnv for the `tenki` backend named in this folder's config, then uses it directly: it starts a VM with port 8080 open, runs a command as root, and deletes the VM.

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

It skips the Docker install (`setup_for_gateway=False`) and involves no agent, so it finishes in well under the few minutes `hello` takes. The provider's own tests are [upstream](https://github.com/scaleapi/agentenv-framework/tree/main/src/agent_env/providers/sandbox_providers/tenki).

## Use Tenki for one run only

Keep your local default, add only the `[sandbox.providers.tenki.config]` table to your config, and pass `--sandbox tenki`, or `--env-sandbox tenki` / `--agent-sandbox tenki` on `agent-env task run`.

## Provider config

Keys under `[sandbox.providers.tenki.config]` (unknown keys are refused):

- `api_key`, required: an `env:` or `secret:` reference.
- `base_url`: default `https://api.tenki.cloud`.
- `snapshot_id`: boot every VM from this snapshot.
- `image`: boot every VM from this Tenki registry image. Set at most one of `image` and `snapshot_id`.
- `min_disk_gb`: smallest VM disk, default `20`.

## Start VMs faster from a snapshot

Build one VM with Docker and Compose v2 and snapshot it:

```bash
tenki sandbox create --name agentenv-docker --cpu 2 --memory-mb 4096 --disk-size-gb 20 --max-duration 30m
tenki sandbox exec --session agentenv-docker -c 'sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2 docker-buildx curl'
tenki sandbox exec --session agentenv-docker -c 'sudo systemctl start docker && sudo docker info --format "{{.ServerVersion}}"'
tenki sandbox snapshot create agentenv-docker --name agentenv-docker --wait-durable
tenki sandbox terminate agentenv-docker
```

Then set `snapshot_id = "<id>"` in the provider config (`tenki sandbox snapshot list` shows it). Keep the snapshot VM at 2 vCPU and 4 GiB, the smallest the provider starts, because a VM can be restored larger than its snapshot but not smaller. You can pull your registry images into it before snapshotting.

## How the provider works

- **One VM per sandbox.** Inside it, the environment's own services run under Docker Compose, the agent runs in its own Docker container, and output files are collected for grading. Commands run as root.
- **Ports:** each exposed port gets a public HTTPS URL under `sb.tenki.sh` (HTTP and WebSocket), with no authentication in front of it.
- **Outbound network:** allow-all, or an allowlist of up to 256 hostnames and 64 IPv4 CIDRs, applied outside the VM. `*.sb.tenki.sh` and `*.us.sb.tenki.sh` are always allowed. A wildcard covers one label.
- **Sizing:** whole vCPUs, at least 2 vCPU / 4 GiB. A request beyond Tenki's limits is refused, not shrunk.
- **Lifetime:** the task's `timeout` is the VM's hard maximum lifetime and every command's time budget. A VM whose setup fails is terminated.
- **Tags:** every VM is tagged `agentenv`, so `tenki sandbox list --tags agentenv` lists them.

## Things to know

- No GPUs.
- `create_vm(image=...)` is refused. VMs boot the configured `image` or `snapshot_id`, and a task's Docker images run under Docker inside them.
- An agent's model key, `LITELLM_API_KEY`, is passed into its VM, as on other backends. Tasks with agents read the model from AgentEnv's `[model]` table.
- Outbound network rules are IPv4 only.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``✗ The `tenki` SDK (1.4) behind agent-env's provider takes only a `tk_` API key.`` | `verify.py` found no key. Export `TENKI_API_KEY=tk_...`. |
| `Unresolved env:TENKI_API_KEY reference (no value and no default)` | Export `TENKI_API_KEY` in this shell. |
| `[sandbox.providers.tenki.config] requires a non-empty 'api_key'` | Run from `examples/agentenv-tenki`, or add the table to your config. |
| `ConfigError` naming the `tenki` extra | Run `uv pip install -r requirements.txt`. |
| `[sandbox.providers.tenki.config] has unknown key(s): [...]` | Use only the keys listed above. |
| `… takes at most one of 'image' and 'snapshot_id'` | Keep one. |
| `Tenki cannot size a VM for cpu=…, memory=…MB, disk=…GB` | Ask for at most 128 vCPU, 512 GiB memory, and 100 GB disk, or your workspace's lower limit. |
| `NetworkPolicyUnsupportedError` | Use IPv4 entries within the 256 hostname and 64 CIDR limits. |
| An allowlisted VM can't install Docker or pull images | Boot from a snapshot with Docker, and allow your registries. |
| `Tenki capped VM …'s lifetime to …s of the …s requested` | Your workspace's maximum session duration is lower. Request a shorter `timeout`. |

## Related

- [AgentEnv Framework](https://www.agentenvframework.com), its [docs](https://www.agentenvframework.com/docs), and [agentenv-framework#187](https://github.com/scaleapi/agentenv-framework/pull/187) (the `tenki` provider)
- [Provider reference](https://github.com/scaleapi/agentenv-framework/blob/main/src/agent_env/providers/sandbox_providers/tenki/README.md) upstream
- [Pause, snapshot, and resume](../snapshots-pause-resume/) and the [Tenki docs](https://tenki.cloud/docs)
