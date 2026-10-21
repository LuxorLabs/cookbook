# Omnara

Run [Omnara](https://github.com/omnara-ai/omnara) agents on Tenki sandboxes. Omnara is an open-source managed agent platform with an API for running agents on any model and machine. With a Tenki machine pool, each agent gets its own Linux VM with passwordless `sudo`, where it runs commands and installs what a task needs. The integration landed in [omnara#537](https://github.com/omnara-ai/omnara/pull/537).

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up an Omnara agent that runs on a Tenki sandbox, following https://github.com/LuxorLabs/cookbook/tree/main/examples/omnara-tenki.
1. Clone https://github.com/LuxorLabs/cookbook, cd into examples/omnara-tenki, check that Node.js is 22 or later, and run npm install. Ask me to run npx omnara login myself.
2. It needs TENKI_API_KEY (a Tenki key from https://app.tenki.cloud) exported in the shell. If it isn't set, stop and ask me to export it. Never print the key or write it to a file.
3. Store the key as an org secret, create the tenki-pool machine pool, and share it with my project, using the commands in the README. Show me the pool limits before creating it.
4. Launch the agent in agent.yaml with npx omnara agents launch, and tell me the agent ID so I can chat with it.
5. Run node verify.mjs and confirm the ✓ line. Remind me to archive the agent when I'm done, which deletes its VM.
```

## Quick start

You need:

- An Omnara account at [app.omnara.com](https://app.omnara.com).
- A Tenki API key from [app.tenki.cloud](https://app.tenki.cloud) under **Tenki Sandbox → API Keys**, with an [expiration](https://tenki.cloud/docs/account/api-keys) that outlives the pool.
- Node.js 22 or later for the `omnara` CLI.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/omnara-tenki
npm install
npx omnara login
```

### 2. Set your API key

Store the Tenki key as an org-owned Omnara secret:

```bash
export TENKI_API_KEY="your-api-key"
npx omnara login
npx omnara secrets create --owner-kind org --name tenki-api-key \
  --material-kind generic --material-value "$TENKI_API_KEY"
```

### 3. Create a Tenki pool

Use the secret's ID, then share the pool with your project:

```bash
npx omnara pools create --name tenki-pool --provider '"tenki"' \
  --provider-auth-secret-id sec_... \
  --default-machine-provider-options '{}' \
  --default-machine-cpu 2 --default-machine-memory-mb 4096 \
  --max-machine-cpu 4 --max-machine-memory-mb 8192 \
  --max-total-cpu 8 --max-total-memory-mb 16384 --max-total-machines 2 \
  --delete-after-idle-minutes 30
npx omnara grant pools add --machine-pool-id mpo_...
```

Each machine gets 2 vCPUs and 4 GB, an agent can ask for up to 4 vCPUs and 8 GB, at most two machines run at once, and an idle machine is deleted after 30 minutes. `--provider` takes JSON, so `tenki` keeps its inner quotes, and `--default-machine-provider-options '{}'` (required) uses Tenki's base image. In the dashboard, the same pool is **Machines → New pool → Tenki**, then **Share with project**.

### 4. Run

Launch the agent in [`agent.yaml`](agent.yaml), which takes its machine from `tenki-pool`, and chat with it:

```bash
npx omnara agents launch --file agent.yaml --name "Tenki agent" \
  --message "Install Docker, then run the hello-world container."
npx omnara agents chat agt_...
```

Omnara creates the VM when the agent launches. When you're done, run `npx omnara agents archive agt_...` and Omnara deletes the VM.

### 5. Verify

```bash
node verify.mjs
```

```
✓ omnara-tenki: boot runtime as tenki → reach Omnara → find by tag + metadata → terminate
```

[`verify.mjs`](verify.mjs) checks the Tenki side without an Omnara account. It starts a VM configured like Omnara's, with a test command in place of the daemon, checks that the boot command runs as `tenki` with its environment, that the VM can reach Omnara's daemon installer, that `sudo` needs no password, and that the VM can be found by its tag and metadata. Then it deletes the VM. It reads `TENKI_API_KEY`, `TENKI_AUTH_TOKEN`, or a `tenki login` key.

## How it works

- **The VM.** Each Omnara machine is a Tenki VM sized by the machine's CPU and memory, with a 20 GB disk on the base image and no time limit.
- **The daemon.** Omnara starts `omnarad` at boot, running as `tenki` in `/home/tenki`. It connects outbound, so inbound traffic stays off.
- **No duplicate VMs.** Every VM is tagged `omnara-managed` with its Omnara machine ID in metadata, so a lost create response doesn't create a second VM.
- **Deletion.** The VM is deleted when the agent deletes the machine, when you archive the agent, or after `delete_after_idle_minutes` with no commands running. Without an idle period, a machine runs and bills until deleted. An agent can create a new machine with `create_machine`.

The provider's source is in [omnara-ai/omnara](https://github.com/omnara-ai/omnara/tree/main/internal/machinepool/providers/tenki).

## Options

Set these in the pool's `--default-machine-provider-options`, or for one agent with `machine_provider_options_overlay` in its `machine_sources` entry:

| Option | What it does |
| --- | --- |
| `image` | A [Tenki template](https://tenki.cloud/docs/sandbox/templates) image, such as `acme/agent-box:v1`. Leave it out to use Tenki's base image. Leave `runtime` out of the template, since Omnara supplies the start command. |
| `disk_size_gb` | 5 to 100. Defaults to 20 on the base image and to the template's size on a custom image. Set it with the CLI or API; the dashboard can't. |
| `startup_script` | Runs on each new machine before the daemon starts. It runs as `tenki`, so use `sudo` for anything that needs root. |

To let an agent use another `image`, list it with `--provider-config '{"allowed_images": [...]}'`.

## Things to know

- **Plan limits.** Tenki's Starter plan allows 5 active sessions and machines up to 4 vCPUs and 8 GB, so keep the pool's limits within your plan.
- **Base image.** Ubuntu 24.04 with passwordless `sudo` and systemd, plus `git`, `gh`, Node.js, Bun, Python, Claude Code, Codex, and opencode. Docker isn't installed; agents can install it, or add it to a template.
- **Self-hosted Omnara** needs a [public HTTPS URL](https://docs.omnara.com/self-hosting/deployment#exposing-the-deployment-publicly), because Tenki VMs connect back to it.

## Related

- Omnara's [Tenki docs](https://docs.omnara.com/machines/providers/tenki) and [create pool reference](https://docs.omnara.com/api-reference/endpoints/machine-pools/create-machine-pool)
- [Omnara on Tenki sandboxes](https://tenki.cloud/blog/omnara-tenki-sandboxes) on the Tenki blog
- [Tenki templates](https://tenki.cloud/docs/sandbox/templates) and the [Tenki docs](https://tenki.cloud/docs)
