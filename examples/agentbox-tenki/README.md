# How to run AgentBox coding agents in Tenki VMs

A Tenki sandbox holds a clone of your project on its own branch, with Claude Code running inside it. `node verify.mjs` passes.

About 20 minutes. Most of that is the one-time `agentbox prepare` bake (roughly 8 to 12 minutes) and the first `agentbox create` (about 3 minutes).

The published plugin (0.1.1) targets AgentBox's provider SDK v2, so pin the AgentBox CLI to **0.29.2**. AgentBox 0.27.1 (the plugin's documented minimum) through 0.29.2 loads it. 0.30.0 and later accept only v4 and refuse this plugin at `plugin add`. SDK v4 support is in progress upstream ([tenki-agentbox-provider#6](https://github.com/LuxorLabs/tenki-agentbox-provider/pull/6)) and has not been released yet.

[AgentBox](https://github.com/madarco/agentbox) moves your project into a dedicated VM, local or cloud, and runs coding agents (`claude`, `codex`, `opencode`) inside it, in parallel, with your own settings. AgentBox calls each of those VMs a box. Tenki is a community AgentBox provider ([agentbox#296](https://github.com/madarco/agentbox/pull/296)). With the [`@tenkicloud/agentbox-provider`](https://www.npmjs.com/package/@tenkicloud/agentbox-provider) plugin installed, every box becomes a [Tenki](https://tenki.cloud) VM with its own kernel, Docker inside the box, public preview URLs, and free pause/resume. You don't need Docker on your machine.

## Prerequisites

- Node.js 20.10 or newer. That's AgentBox 0.29.2's minimum. The plugin itself needs 20.
- An OpenSSH client (`ssh` and `ssh-keygen`) on your machine. AgentBox uses it to attach you to a box.
- A Tenki account and a `tk_` API key. Create one at https://app.tenki.cloud.
- A git project you want the agents to work on.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/agentbox-tenki
```

The example holds the verify script you'll run in Step 8. Steps 5 and 7 run the AgentBox commands from your own project instead.

## Step 2 — Install AgentBox 0.29.2 and the Tenki plugin

```bash
npm i -g @madarco/agentbox@0.29.2 @tenkicloud/agentbox-provider@0.1.1
agentbox plugin add @tenkicloud/agentbox-provider
agentbox plugin list                 # -> tenki … (SDK v2)
```

Keep both pins, and move them together. A newer CLI refuses the 0.1.1 plugin (see the version pin at the top of this page), and a plugin release that targets SDK v4 won't load in AgentBox 0.29.2, which accepts only v1 and v2.

AgentBox runs a plugin in-process with the CLI, with full access to your host and credentials, so **`plugin add` is the trust boundary**: only add plugins you trust.

## Step 3 — Authenticate

```bash
export TENKI_AUTH_TOKEN=tk_...       # or add it to ~/.agentbox/secrets.env
agentbox doctor                      # shows the `tenki:` group
```

The plugin reads `TENKI_AUTH_TOKEN` from your shell first, then from `~/.agentbox/secrets.env`. `TENKI_API_TOKEN` is accepted as an alias. It doesn't read `TENKI_API_KEY`, a project `.env` file, or the key that `tenki login` stores, so set one of those two names even if other Tenki tools already work for you.

If you skip this step, the first `agentbox prepare --provider tenki` or `agentbox create --provider tenki` you run on a terminal prompts for the token and saves it to `~/.agentbox/secrets.env`.

To confirm your key can boot a Tenki VM before you spend 8 to 12 minutes on the bake, you can run Step 8 now.

## Step 4 — Bake the base image (once per workspace)

```bash
agentbox prepare --provider tenki
```

`prepare` boots a throwaway builder VM from Tenki's `sandbox` base image, installs tmux, the AgentBox runtime and the coding agents, snapshots it, and pins the snapshot id in `~/.agentbox/tenki-prepared.json`. Every box after that boots from this snapshot.

It also bakes your agent settings and MCP servers into the image. Credentials are seeded per box when the box is created, never into the image.

The bake takes roughly 8 to 12 minutes, and it's billable: it boots a builder VM with a 20 GB disk. To watch it, tail `~/.agentbox/logs/latest.log` in another terminal. You need it once per Tenki workspace. If the snapshot is later deleted, or your token points at another workspace, the next `prepare` notices and bakes again.

## Step 5 — Create a box and start an agent

Run these from your project's root directory, not from the example directory:

```bash
agentbox create --provider tenki     # a box, booted from the baked snapshot
agentbox tenki claude                # drop straight into Claude Code inside the box
```

Because `create` boots from the baked snapshot, `claude`, `codex` and `opencode` are already installed when the box comes up, so there's no install step. The whole `create` command still takes about 3 minutes. Inside each box, your project is a git clone on a per-box branch, carrying your uncommitted and untracked changes.

If AgentBox hasn't yet captured a login for an agent from a box you've used, there's nothing to seed, and that agent starts logged out. Log in once inside the box. AgentBox captures that login and seeds it into later boxes.

To make Tenki the provider for the whole project, set `box.provider: tenki` in `agentbox.yaml`. Then you can leave out `--provider tenki`.

To push commits from inside a box, run `agentbox-ctl git push`. The push goes through the AgentBox host relay, which holds your git credentials, so your keys never enter the box.

Every port you expose gets a public HTTPS preview URL. The `expose:` entries in `agentbox.yaml` and `agentbox open` work as they do on any cloud provider. The in-box web proxy listens on **8080**, not 80. Preview URLs account for this. Anyone who has a preview URL can reach that port, with no token. For a port that shouldn't stay publicly reachable, use a signed, expiring URL instead.

## Step 6 — Configure boxes (optional)

| Setting | Where | Notes |
| --- | --- | --- |
| VM size | `--size` / `box.size` | `cpu-memory[-disk]` in GB, e.g. `4-8-20` |
| Base image | `AGENTBOX_TENKI_BASE_IMAGE` | what `prepare` layers onto (default `sandbox`) |
| Workspace | `AGENTBOX_TENKI_WORKSPACE_ID` | defaults to the token's own scope |
| Session lifetime | `AGENTBOX_TENKI_TIMEOUT_MS` | seeds the host keepalive loop |
| Default checkpoint | `box.defaultCheckpoint` | generic AgentBox key |

A box gets a 45-minute lifetime unless you set `AGENTBOX_TENKI_TIMEOUT_MS` (in milliseconds). While you're using a box, the host keepalive loop extends that lifetime, starting from the value the box was created with.

## Step 7 — Checkpoint, pause, and clean up

Run this step from your project's root, as in Step 5. AgentBox scopes checkpoints to the project in your current directory, and `checkpoint create` with no box name picks that project's only box.

Checkpoints snapshot a warm box, with dependencies installed and services running, and new boxes boot from it:

```bash
agentbox checkpoint create --name setup
agentbox create --provider tenki --snapshot setup
```

Tenki takes the snapshot live, so the source box keeps running.

`agentbox pause <box>` / `agentbox start <box>` are native Tenki pause/resume: free while paused, running processes intact.

When you're done with a box, remove it with `agentbox destroy <name>`. Do this before you remove the plugin, because without the plugin AgentBox can't manage Tenki boxes. `agentbox prune` skips Tenki boxes, so clean up anything left over from the [Tenki dashboard](https://app.tenki.cloud) instead.

Destroying boxes or removing the plugin doesn't delete the baked base image or checkpoint snapshots in your Tenki workspace. Remove those from the [Tenki dashboard](https://app.tenki.cloud).

## Step 8 — Check it works

From `cookbook/examples/agentbox-tenki`:

```bash
npm install
node verify.mjs
```

[`verify.mjs`](verify.mjs) reads your key from `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or the key `tenki login` stored. It needs neither the agentbox CLI nor a baked image. First it asserts that the published plugin registers `providerModule.provider` with the SDK v2 provider contract AgentBox drives:

```js
const REQUIRED = ["create", "start", "reconnect", "pause", "resume", "stop", "destroy", "exec", "buildAttach"];

let sandbox;
try {
  const provider = plugin.providerModule?.provider;
  if (plugin.PROVIDER_NAME !== "tenki") throw new Error(`PROVIDER_NAME is ${JSON.stringify(plugin.PROVIDER_NAME)}`);
  if (plugin.SDK_API_VERSION !== 2) throw new Error(`SDK_API_VERSION is ${plugin.SDK_API_VERSION}, README pins AgentBox 0.29.2, which loads v1/v2`);
  if (provider?.name !== "tenki") throw new Error(`providerModule.provider.name is ${JSON.stringify(provider?.name)}`);
  const missing = REQUIRED.filter((k) => typeof provider?.[k] !== "function");
  if (typeof provider?.checkpoint?.create !== "function") missing.push("checkpoint.create");
  if (missing.length) throw new Error(`providerModule.provider missing members: ${missing.join(", ")}`);
```

Then it proves the live Tenki path every box rides on: it boots a 1-CPU, 1 GB VM, runs a command, round-trips a file, and disposes of the VM. On success it prints:

```
✓ agentbox-tenki: plugin exposes the SDK v2 tenki provider → live boot → exec (box 42) → file round-trip → dispose
```

This proves the plugin version this example installs (`^0.1.1`) exposes the provider contract AgentBox 0.29.2 loads, and that your key can boot and drive a Tenki VM. It doesn't run `prepare`, `create`, or an agent, and the plugin's own CI doesn't either (that runs its unit tests and a package contract check). Steps 4 and 5 are the real test of the box workflow.

verify.mjs uses the latest `@tenkicloud/sandbox` (`>=1.4.1`). The published plugin still depends on `^0.5.2`, so the live half of this check runs on a newer SDK than your boxes do.

## Troubleshooting

**❌ `targets provider SDK v2; this AgentBox supports v4` at `agentbox plugin add`.** Your AgentBox CLI is 0.30.0 or later, and those versions load only SDK v4 plugins. Reinstall the pinned CLI with `npm i -g @madarco/agentbox@0.29.2`, then run `plugin add` again.

**❌ `unknown provider "tenki"`.** The plugin isn't registered. Run `agentbox plugin add @tenkicloud/agentbox-provider` and confirm with `agentbox plugin list`.

**❌ `Tenki credentials not configured.`** The plugin found no `TENKI_AUTH_TOKEN` or `TENKI_API_TOKEN` in your shell or in `~/.agentbox/secrets.env`. A `TENKI_API_KEY` variable or a `tenki login` key doesn't count. Export `TENKI_AUTH_TOKEN` or add it to `~/.agentbox/secrets.env`, then check `agentbox doctor`.

**❌ `agentbox doctor` reports the base image as `not prepared`.** No snapshot has been baked for this workspace yet. Run `agentbox prepare --provider tenki`.

**❌ A builder named `agentbox-prepare` is left over after a failed `prepare`.** A failed bake can leave a paused builder behind, billable until its deadline, and `agentbox prune` doesn't cover plugin providers. Delete it from the [Tenki dashboard](https://app.tenki.cloud).

**❌ A box expired mid-session.** The keepalive extends a box you're using, but it starts from the lifetime the box was created with (45 minutes by default). Set `AGENTBOX_TENKI_TIMEOUT_MS` higher before `agentbox create`.

**❌ Attach fails to open a shell, or `` tenki attach: could not generate an SSH key — `ssh-keygen` is required ``.** Attach runs your machine's `ssh` and `ssh-keygen`. Install an OpenSSH client. Per-box key material lives in `~/.agentbox/boxes/<session-id>/ssh/`. The plugin mints a new certificate on every attach, so deleting that directory is safe.

**❌ `` No token. Set TENKI_AUTH_TOKEN, or run `tenki login`. ``** verify.mjs found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export one, or run `tenki login --api-key <key>`.

**❌ `✗ SDK_API_VERSION is …` or `✗ providerModule.provider missing members: …` from verify.mjs.** The plugin version that `npm install` put in this example no longer matches the SDK v2 contract that AgentBox 0.29.2 loads, so the CLI pin in this guide is out of date for it. Check the plugin's [releases](https://github.com/LuxorLabs/tenki-agentbox-provider/releases) for the AgentBox version it targets.

## FAQ

**When shouldn't I use this?** When you need AgentBox 0.30.0 or later: the published plugin loads only through 0.29.2 until SDK v4 support ships. When you can't give a plugin in-process access to your host and credentials. When you rely on `agentbox prune` for cleanup, because it skips Tenki boxes. And for services that must stay private, unless you use signed URLs, because preview URLs are public to anyone who has them.

**Do I need Docker on my machine?** No. Docker runs inside the box.

**Where is the baked snapshot recorded?** In `~/.agentbox/tenki-prepared.json`.

**Where do I report bugs?** At [LuxorLabs/tenki-agentbox-provider](https://github.com/LuxorLabs/tenki-agentbox-provider/issues), not the AgentBox tracker.

## Related

- [AgentBox](https://github.com/madarco/agentbox) and its site, [agent-box.sh](https://agent-box.sh)
- [`@tenkicloud/agentbox-provider`](https://www.npmjs.com/package/@tenkicloud/agentbox-provider) on npm, with source at [LuxorLabs/tenki-agentbox-provider](https://github.com/LuxorLabs/tenki-agentbox-provider)
- [agentbox#296](https://github.com/madarco/agentbox/pull/296): Tenki added as a community provider
- [tenki-agentbox-provider#6](https://github.com/LuxorLabs/tenki-agentbox-provider/pull/6): SDK v4 support, not yet released
- [Tenki docs](https://tenki.cloud/docs)
- [`../snapshots-pause-resume/`](../snapshots-pause-resume/): the Tenki snapshot and pause/resume calls on their own
- [`../expose-a-port/`](../expose-a-port/): a preview URL from a Tenki sandbox
