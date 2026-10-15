# AgentBox coding agents on Tenki

[AgentBox](https://github.com/madarco/agentbox) moves your project into a dedicated VM — local or cloud — and runs coding agents (`claude`, `codex`, `opencode`) inside it, in parallel, with your own settings along for the ride. Tenki is a community AgentBox provider ([agentbox#296](https://github.com/madarco/agentbox/pull/296)). With the [`@tenkicloud/agentbox-provider`](https://www.npmjs.com/package/@tenkicloud/agentbox-provider) plugin installed, every box (AgentBox's name for one of those VMs) becomes a [Tenki](https://tenki.cloud) Firecracker microVM with its own kernel, Docker inside the box, public preview URLs, and free pause/resume. You don't need Docker on your machine.

## Set it up

```bash
npm i -g @madarco/agentbox @tenkicloud/agentbox-provider
agentbox plugin add @tenkicloud/agentbox-provider
agentbox plugin list                 # -> tenki … (SDK v2)

export TENKI_AUTH_TOKEN=tk_...       # or add it to ~/.agentbox/secrets.env
agentbox doctor                      # shows the `tenki:` group
```

AgentBox runs a plugin in-process with the CLI, with full access to your host and credentials, so **`plugin add` is the trust boundary**: only add plugins you trust.

## Use it

```bash
agentbox prepare --provider tenki    # one-time: bake the base image (tmux, runtime, agents), pin the snapshot
agentbox create --provider tenki     # a box, booted from that snapshot in seconds
agentbox tenki claude                # drop straight into Claude Code inside the box
```

To make Tenki the provider for the whole project, set `box.provider: tenki` in `agentbox.yaml`. Inside each box, your project is a git clone on a per-box branch, carrying your uncommitted and untracked changes. `prepare` bakes your agent settings and MCP servers into the image; credentials are seeded per box, never into the image.

Checkpoints snapshot a warm box — dependencies installed, services running — and new boxes boot from it:

```bash
agentbox checkpoint create --name setup
agentbox create --provider tenki --snapshot setup
```

`agentbox pause <box>` / `agentbox start <box>` are native Tenki pause/resume: free while paused, running processes intact.

## Configuration

| Setting | Where | Notes |
| --- | --- | --- |
| VM size | `--size` / `box.size` | `cpu-memory[-disk]` in GB, e.g. `4-8-20` |
| Base image | `AGENTBOX_TENKI_BASE_IMAGE` | what `prepare` layers onto (default `sandbox`) |
| Workspace | `AGENTBOX_TENKI_WORKSPACE_ID` | defaults to the token's own scope |
| Session lifetime | `AGENTBOX_TENKI_TIMEOUT_MS` | seeds the host keepalive loop |
| Default checkpoint | `box.defaultCheckpoint` | generic AgentBox key |

The baked snapshot id lives in `~/.agentbox/tenki-prepared.json`. `TENKI_API_TOKEN` is accepted as an alias for `TENKI_AUTH_TOKEN`.

## Verify

```bash
npm install
node verify.mjs
```

This needs neither the agentbox CLI nor a baked image. [`verify.mjs`](verify.mjs) first asserts that the published plugin registers `providerModule.provider` with the **SDK v2 provider contract** AgentBox drives (`create`/`exec`/`pause`/`resume`/`checkpoint`/…). It then proves the **live Tenki path every box rides on**: boot a microVM, exec, file round-trip, dispose. The box workflow itself is covered by the plugin's CI at [LuxorLabs/tenki-agentbox-provider](https://github.com/LuxorLabs/tenki-agentbox-provider).

## Notes

- The in-box web proxy listens on **8080**, not 80 — preview URLs account for this.
- `agentbox prune` skips Tenki boxes; clean up from the [Tenki dashboard](https://app.tenki.cloud) instead.
- Git pushes go through the relay: `agentbox-ctl git push` inside the box.
- Bugs go to [LuxorLabs/tenki-agentbox-provider](https://github.com/LuxorLabs/tenki-agentbox-provider/issues), not the AgentBox tracker.
