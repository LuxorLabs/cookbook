# AgentBox

Run [AgentBox](https://github.com/madarco/agentbox) coding agents (`claude`, `codex`, `opencode`) in Tenki VMs. AgentBox moves your project into a dedicated VM, which it calls a box, and runs agents there in parallel with your own settings. With the [`@tenkicloud/agentbox-provider`](https://www.npmjs.com/package/@tenkicloud/agentbox-provider) plugin, every box is a Tenki VM with its own kernel, Docker inside, public preview URLs, and free pause/resume. You don't need Docker locally.

Pin the AgentBox CLI to **0.29.2**. Plugin 0.1.1 targets provider SDK v2, which AgentBox 0.27.1 through 0.29.2 load; 0.30.0 and later accept only v4. SDK v4 support is in progress in [tenki-agentbox-provider#6](https://github.com/LuxorLabs/tenki-agentbox-provider/pull/6).

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

Move both pins together. AgentBox runs plugins in-process with full access to your host and credentials, so only add plugins you trust.

### 2. Set your API key

```bash
export TENKI_AUTH_TOKEN=tk_...       # or add it to ~/.agentbox/secrets.env
agentbox doctor                      # shows the `tenki:` group
```

The plugin reads `TENKI_AUTH_TOKEN` (or the alias `TENKI_API_TOKEN`) from your shell, then from `~/.agentbox/secrets.env`. It doesn't read `TENKI_API_KEY` or a `tenki login` key. If no key is set, the first `prepare` or `create` prompts for one and saves it.

### 3. Bake the base image (once per workspace)

```bash
agentbox prepare --provider tenki
```

This boots a builder VM from Tenki's `sandbox` image, installs tmux, the AgentBox runtime, the coding agents, your agent settings, and MCP servers, then snapshots it and records the id in `~/.agentbox/tenki-prepared.json`. It takes 8 to 12 minutes on a billable 20 GB builder. Tail `~/.agentbox/logs/latest.log` to watch. Credentials are seeded per box, never into the image. If the snapshot is deleted or your token points at another workspace, the next `prepare` bakes again.

### 4. Create a box and start an agent

From your project's root:

```bash
agentbox create --provider tenki     # about 3 minutes
agentbox tenki claude                # Claude Code inside the box
```

Your project is a git clone on a per-box branch, including uncommitted and untracked changes. If AgentBox hasn't captured an agent's login yet, log in once inside a box and later boxes reuse it. Set `box.provider: tenki` in `agentbox.yaml` to drop `--provider tenki`.

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

`verify.mjs` checks that the published plugin exposes the SDK v2 provider contract AgentBox 0.29.2 loads (`create`, `start`, `reconnect`, `pause`, `resume`, `stop`, `destroy`, `exec`, `buildAttach`, `checkpoint.create`), then boots a small VM, runs a command, round-trips a file, and disposes of it. It doesn't need the AgentBox CLI and doesn't run `prepare` or `create`. It reads `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or a `tenki login` key. You can run it before the bake to confirm your key works.

## Working with boxes

- **Push from a box** with `agentbox-ctl git push`. The push goes through the host relay, which holds your git credentials, so keys never enter the box.
- **Preview URLs.** Every exposed port gets a public HTTPS URL; `expose:` in `agentbox.yaml` and `agentbox open` work as on other providers. The in-box web proxy listens on 8080. Anyone with a URL can reach that port, so use a signed, expiring URL for anything that shouldn't stay public.
- **Checkpoints.** From the project root, `agentbox checkpoint create --name setup` snapshots a warm box live, and `agentbox create --provider tenki --snapshot setup` boots new boxes from it.
- **Pause.** `agentbox pause <box>` and `agentbox start <box>` use Tenki pause/resume: free while paused, processes intact.
- **Lifetime.** Boxes get 45 minutes unless you set `AGENTBOX_TENKI_TIMEOUT_MS`. The host keepalive extends a box while you use it, starting from that value.

| Setting | Where | Notes |
| --- | --- | --- |
| VM size | `--size` / `box.size` | `cpu-memory[-disk]` in GB, e.g. `4-8-20` |
| Base image | `AGENTBOX_TENKI_BASE_IMAGE` | what `prepare` layers onto (default `sandbox`) |
| Workspace | `AGENTBOX_TENKI_WORKSPACE_ID` | defaults to the token's own scope |
| Session lifetime | `AGENTBOX_TENKI_TIMEOUT_MS` | seeds the host keepalive loop |
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
