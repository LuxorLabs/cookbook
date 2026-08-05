# AgentBox coding agents on Tenki

[AgentBox](https://github.com/madarco/agentbox) moves your project into a dedicated VM — local or cloud — and runs coding agents (`claude`, `codex`, `opencode`) inside it, in parallel, with your own settings along for the ride. Tenki is a community provider ([agentbox#296](https://github.com/madarco/agentbox/pull/296)): with the [`@tenkicloud/agentbox-provider`](https://www.npmjs.com/package/@tenkicloud/agentbox-provider) plugin, every box becomes a [Tenki](https://tenki.cloud) Firecracker microVM — its own kernel, Docker inside the box, public preview URLs, and free pause/resume, with no local Docker needed.

## Set it up

```bash
npm i -g @madarco/agentbox @tenkicloud/agentbox-provider
agentbox plugin add @tenkicloud/agentbox-provider
agentbox plugin list                 # -> tenki … (SDK v2)

export TENKI_AUTH_TOKEN=tk_...       # or add it to ~/.agentbox/secrets.env
agentbox doctor                      # shows the `tenki:` group
```

A plugin runs in-process with full host and credential access — **`plugin add` is the trust boundary**.

## Use it

```bash
agentbox prepare --provider tenki    # one-time: bake the base image (tmux, runtime, agents), pin the snapshot
agentbox create --provider tenki     # a box, booted from that snapshot in seconds
agentbox tenki claude                # drop straight into Claude Code inside the box
```

Pin it project-wide with `box.provider: tenki` in `agentbox.yaml`. Your project arrives as a git clone on a per-box branch, carrying uncommitted and untracked changes; agent settings and MCP servers are baked in by `prepare`, and credentials are seeded per box, never into the image.

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

The baked snapshot id lives in `~/.agentbox/tenki-prepared.json`; `TENKI_API_TOKEN` is accepted as a token alias.

## Verify

```bash
npm install
node verify.mjs
```

No agentbox CLI or baked image needed: [`verify.mjs`](verify.mjs) asserts the published plugin registers `providerModule.provider` with the **SDK v2 provider contract** AgentBox drives (`create`/`exec`/`pause`/`resume`/`checkpoint`/…), then proves the **live Tenki path every box rides on** — boot a microVM, exec, file round-trip, dispose. The box workflow itself is covered by the plugin's CI at [LuxorLabs/tenki-agentbox-provider](https://github.com/LuxorLabs/tenki-agentbox-provider).

## Notes

- The in-box web proxy listens on **8080**, not 80 — preview URLs account for this.
- `agentbox prune` skips Tenki boxes; clean up from the [Tenki dashboard](https://app.tenki.cloud) instead.
- Git pushes go through the relay: `agentbox-ctl git push` inside the box.
- Bugs go to [LuxorLabs/tenki-agentbox-provider](https://github.com/LuxorLabs/tenki-agentbox-provider/issues), not the AgentBox tracker.
