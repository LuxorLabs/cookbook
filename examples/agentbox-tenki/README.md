# AgentBox

Run Claude Code, Codex, or OpenCode on a copy of your project in a cloud VM, with as many running side by side as you like.

[AgentBox](https://github.com/madarco/agentbox) is a command-line tool that gives each coding agent its own isolated machine, which it calls a **box**. It copies your project into the box (including changes you haven't committed), installs the agents with your settings, and lets you attach to any box to watch or take over. Because each agent has its own box, several can work at once without stepping on each other or on your computer.

Where boxes run is up to a **provider** plugin. With [`@tenkicloud/agentbox-provider`](https://www.npmjs.com/package/@tenkicloud/agentbox-provider), every box is a Tenki VM, with Docker inside, public URLs for previewing apps the agent runs, and free pause and resume. You don't need Docker on your machine.

> **Use AgentBox 0.29.2.** The Tenki plugin (0.1.1) is built for AgentBox's older plugin interface, provider SDK v2, which versions 0.27.1 through 0.29.2 support. AgentBox 0.30.0 and later accept only v4 and won't load it. Support for the newer interface is in progress in [tenki-agentbox-provider#6](https://github.com/LuxorLabs/tenki-agentbox-provider/pull/6).

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up AgentBox with Tenki VMs for my project, following https://github.com/LuxorLabs/cookbook/tree/main/examples/agentbox-tenki.
1. Check that Node.js is 20.10 or later and that ssh and ssh-keygen are installed.
2. Install exactly @madarco/agentbox@0.29.2 and @tenkicloud/agentbox-provider@0.1.1 globally, then run agentbox plugin add @tenkicloud/agentbox-provider and agentbox plugin list. Ask me before installing anything globally.
3. It needs TENKI_AUTH_TOKEN (a Tenki key starting with tk_, from https://app.tenki.cloud). If it isn't set, stop and ask me to export it. Never print the key or write it to a file. Then run agentbox doctor.
4. Tell me the base-image bake takes 8 to 12 minutes and is billable, and ask before running agentbox prepare --provider tenki.
5. From my project root, run agentbox create --provider tenki and tell me how to attach with agentbox tenki claude.
6. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- Node.js 20.10 or later.
- An OpenSSH client (`ssh`, `ssh-keygen`). AgentBox uses it to attach you to a box.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- A git project for the agents to work on.

### 1. Install AgentBox and the plugin

```bash
npm i -g @madarco/agentbox@0.29.2 @tenkicloud/agentbox-provider@0.1.1
agentbox plugin add @tenkicloud/agentbox-provider
agentbox plugin list                 # -> tenki … (SDK v2)
```

Upgrade the two together. AgentBox plugins run with full access to your machine and credentials, so only add plugins you trust.

### 2. Set your API key

```bash
export TENKI_AUTH_TOKEN=tk_...       # or add it to ~/.agentbox/secrets.env
agentbox doctor                      # shows the `tenki:` group
```

The plugin reads `TENKI_AUTH_TOKEN` (or the alias `TENKI_API_TOKEN`) from your shell, then from `~/.agentbox/secrets.env`. It doesn't read `TENKI_API_KEY` or a `tenki login` key. If no key is set, the first `prepare` or `create` prompts for one and saves it.

### 3. Build the base image (once per workspace)

New boxes start from a prepared image, so they don't reinstall everything each time. Build it once:

```bash
agentbox prepare --provider tenki
```

This starts a temporary VM from Tenki's `sandbox` image, installs tmux, AgentBox's own tools, the coding agents, your agent settings, and MCP servers (extra tools for the agents), then saves it as a snapshot and records the id in `~/.agentbox/tenki-prepared.json`. It takes 8 to 12 minutes, billed as a normal 20 GB VM. Tail `~/.agentbox/logs/latest.log` to watch. Your credentials are added to each box when it's created, never saved in the image. If the snapshot is deleted or your key points at another workspace, the next `prepare` builds it again.

### 4. Create a box and start an agent

From your project's root:

```bash
agentbox create --provider tenki     # about 3 minutes
agentbox tenki claude                # Claude Code inside the box
```

Inside the box, your project is a git clone on its own branch, including uncommitted and untracked changes. `agentbox tenki claude` attaches your terminal to Claude Code running there. If AgentBox hasn't captured an agent's login yet, log in once inside a box and later boxes reuse it. Set `box.provider: tenki` in `agentbox.yaml` to drop `--provider tenki`.

### 5. Verify the setup

From `cookbook/examples/agentbox-tenki`:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/agentbox-tenki
npm install
node verify.mjs
```

```
✓ agentbox-tenki: plugin exposes the SDK v2 tenki provider → live boot → exec (box 42) → file round-trip → dispose
```

`verify.mjs` checks that the published plugin has every function AgentBox 0.29.2 expects from a provider (`create`, `start`, `reconnect`, `pause`, `resume`, `stop`, `destroy`, `exec`, `buildAttach`, `checkpoint.create`), then boots a small VM, runs a command, round-trips a file, and disposes of it. It doesn't need the AgentBox CLI and doesn't run `prepare` or `create`. It reads `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or a `tenki login` key. You can run it before the bake to confirm your key works.

## Working with boxes

- **Push from a box** with `agentbox-ctl git push`. The push is relayed through your machine, which holds your git credentials, so keys never enter the box.
- **Preview URLs.** Every exposed port gets a public HTTPS URL; `expose:` in `agentbox.yaml` and `agentbox open` work as on other providers. The in-box web proxy listens on 8080. Anyone with a URL can reach that port, so use a signed, expiring URL for anything that shouldn't stay public.
- **Checkpoints.** From the project root, `agentbox checkpoint create --name setup` snapshots a warm box live, and `agentbox create --provider tenki --snapshot setup` boots new boxes from it.
- **Pause.** `agentbox pause <box>` and `agentbox start <box>` use Tenki pause/resume: free while paused, processes intact.
- **Lifetime.** A box shuts down after 45 minutes unless you set `AGENTBOX_TENKI_TIMEOUT_MS`. While you're using a box, AgentBox keeps extending that deadline.

| Setting | Where | Notes |
| --- | --- | --- |
| VM size | `--size` / `box.size` | `cpu-memory[-disk]` in GB, e.g. `4-8-20` |
| Base image | `AGENTBOX_TENKI_BASE_IMAGE` | what `prepare` layers onto (default `sandbox`) |
| Workspace | `AGENTBOX_TENKI_WORKSPACE_ID` | defaults to the token's own scope |
| Box lifetime | `AGENTBOX_TENKI_TIMEOUT_MS` | how long a box lives before AgentBox extends it |
| Default checkpoint | `box.defaultCheckpoint` | generic AgentBox key |

## Clean up

- `agentbox destroy <name>` removes a box. Do this before removing the plugin, or AgentBox can't manage Tenki boxes.
- `agentbox prune` skips Tenki boxes. Clean up leftovers, including a paused `agentbox-prepare` builder from a failed bake, in the [Tenki dashboard](https://app.tenki.cloud).
- The baked image and checkpoint snapshots stay in your workspace until you delete them in the dashboard.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `targets provider SDK v2; this AgentBox supports v4` | Reinstall `@madarco/agentbox@0.29.2` and run `plugin add` again. |
| `unknown provider "tenki"` | Run `agentbox plugin add @tenkicloud/agentbox-provider`. |
| `Tenki credentials not configured.` | Export `TENKI_AUTH_TOKEN` or add it to `~/.agentbox/secrets.env`. `TENKI_API_KEY` doesn't count. |
| `agentbox doctor` shows the base image `not prepared` | Run `agentbox prepare --provider tenki`. |
| A box expired mid-session | Set `AGENTBOX_TENKI_TIMEOUT_MS` higher before `create`. |
| Attach fails, or `` `ssh-keygen` is required `` | Install OpenSSH. Per-box keys in `~/.agentbox/boxes/<session-id>/ssh/` are safe to delete. |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `✗ SDK_API_VERSION is …` or `✗ providerModule.provider missing members` | The installed plugin no longer matches AgentBox 0.29.2. Check the plugin's [releases](https://github.com/LuxorLabs/tenki-agentbox-provider/releases). |

Report plugin bugs at [LuxorLabs/tenki-agentbox-provider](https://github.com/LuxorLabs/tenki-agentbox-provider/issues).

## Related

- [AgentBox](https://github.com/madarco/agentbox) ([agent-box.sh](https://agent-box.sh)) and [agentbox#296](https://github.com/madarco/agentbox/pull/296)
- [`@tenkicloud/agentbox-provider`](https://www.npmjs.com/package/@tenkicloud/agentbox-provider) ([source](https://github.com/LuxorLabs/tenki-agentbox-provider))
- [Pause, snapshot, and resume](../snapshots-pause-resume/) and [Expose a port](../expose-a-port/)
- [Tenki docs](https://tenki.cloud/docs)
