# Omnara agents on Tenki sandboxes

[Omnara](https://github.com/omnara-ai/omnara) is an open-source managed agent platform. Use the API to run AI agents on any model and any machine, with tools, secrets, permissions, and streaming built in.

With a Tenki pool, each agent gets its own full Linux VM on [Tenki Sandbox](https://tenki.cloud/products/sandbox), with passwordless `sudo`, where it runs commands and installs whatever a task needs. Tenki contributed the integration in [omnara#537](https://github.com/omnara-ai/omnara/pull/537), and their [announcement](https://tenki.cloud/blog/omnara-tenki-sandboxes) has the background.

## What you need

- An Omnara account ([app.omnara.com](https://app.omnara.com))
- A Tenki API key. Create one in the Tenki dashboard under **Tenki Sandbox → API Keys**, with an [expiration](https://tenki.cloud/docs/account/api-keys) that outlives the pool.
- Node.js 22 or newer for the `omnara` CLI

## Set it up

Store your Tenki key as an org-owned secret in Omnara:

```bash
export TENKI_API_KEY="your-api-key"
npx omnara login
npx omnara secrets create --owner-kind org --name tenki-api-key \
  --material-kind generic --material-value "$TENKI_API_KEY"
```

Create a Tenki pool with the secret's ID, then share it with your project:

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

This pool gives each machine 2 vCPUs and 4 GB of memory, lets an agent ask for up to 4 vCPUs and 8 GB, runs at most two machines at once, and deletes a machine after 30 idle minutes. `--provider` takes JSON, so `tenki` keeps its inner quotes, and the required `--default-machine-provider-options '{}'` uses Tenki's base image. In the dashboard, create the same pool under **Machines → New pool → Tenki**, then click **Share with project**.

Launch the agent in [agent.yaml](agent.yaml), which uses `tenki-pool` for its machine, and chat with it:

```bash
npx omnara agents launch --file agent.yaml --name "Tenki agent" \
  --message "Install Docker, then run the hello-world container."
npx omnara agents chat agt_...
```

Omnara creates the VM when the agent launches. In our test runs, it was online about five seconds later, and the agent installed Docker with `sudo` in about 30 seconds. When you're done, archive the agent with `npx omnara agents archive agt_...`, and Omnara deletes the VM.

## How it works

**The VM.** Each Omnara machine is a Tenki VM, sized by the machine's CPU and memory, with a 20 GB disk on the base image. Tenki keeps it running, with no time limit, until Omnara deletes it.

**The daemon.** Omnara starts its daemon, `omnarad`, when the VM boots. The daemon runs as `tenki` in `/home/tenki` and connects outbound, so there are no ports to open, and inbound traffic to the VM stays off.

**No duplicate VMs.** Omnara tags every VM `omnara-managed` and records its Omnara machine ID in the VM's metadata. If the response to a create request is lost, Omnara finds the VM by that metadata instead of creating a second one.

**Deletion.** Omnara deletes the VM when the agent deletes the machine, when you archive the agent, or after `delete_after_idle_minutes` with no commands running. A machine without an idle period runs, and bills, until it's deleted. Files on a deleted machine are gone, and the agent can create a new one with `create_machine`.

## Options

Set these in the pool's `--default-machine-provider-options`, or for one agent with `machine_provider_options_overlay` in its `machine_sources` entry:

| Option | What it does |
| --- | --- |
| `image` | A [Tenki template](https://tenki.cloud/docs/sandbox/templates) image, such as `acme/agent-box:v1`. Leave it out to use Tenki's base image. Leave `runtime` out of the template, since Omnara supplies the start command. |
| `disk_size_gb` | 5 to 100. Defaults to 20 on the base image and to the template's size on a custom image. Set it with the CLI or API; the dashboard can't. |
| `startup_script` | Runs on each new machine before the daemon starts. It runs as `tenki`, so use `sudo` for anything that needs root. |

To let an agent use a different `image`, list it in the pool's allowlist with `--provider-config '{"allowed_images": [...]}'`.

## Verify

```bash
npm install
node verify.mjs
```

[verify.mjs](verify.mjs) checks the Tenki side without an Omnara account. It starts a VM configured like Omnara's, with a test command in place of the daemon, and checks that:

- the boot command runs as `tenki` with its environment
- the VM can download Omnara's daemon installer and the `omnarad` release, whose checksum and version match
- `sudo` works without a password
- the VM can be found by its tag and metadata, the way Omnara recovers a lost create

Then it deletes the VM. The provider itself is in [omnara-ai/omnara](https://github.com/omnara-ai/omnara/tree/main/internal/machinepool/providers/tenki).

## Notes

- **Plan limits.** Tenki's Starter plan allows 5 active sessions and machines up to 4 vCPUs and 8 GB, so keep the pool's limits within your plan.
- **Base image.** Ubuntu 24.04 with passwordless `sudo` and systemd, plus `git`, `gh`, Node.js, Bun, Python, Claude Code, Codex, and opencode. Docker isn't installed, but agents can install it, or you can add it to a template.
- **Self-hosted Omnara.** Tenki VMs connect back to your Omnara URL, so your deployment needs a [public HTTPS URL](https://docs.omnara.com/self-hosting/deployment#exposing-the-deployment-publicly).
- **Reference.** Omnara's [Tenki docs](https://docs.omnara.com/machines/providers/tenki) cover Tenki-specific settings, and the [create pool reference](https://docs.omnara.com/api-reference/endpoints/machine-pools/create-machine-pool) lists every pool field.
