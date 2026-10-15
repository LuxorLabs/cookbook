# How to run OpenClaw agent tools in Tenki microVMs

**Audience:** People who run [OpenClaw](https://github.com/openclaw/openclaw), the open-source personal AI assistant, and want its agents' commands to run on a remote VM instead of on their own machine.
**Time:** ~5 minutes to clone, install, and run the check (in CI, `npm install` plus `node verify.mjs` take about 7 seconds). Installing and onboarding an OpenClaw 2026.7.x host, then installing and configuring the plugin, comes on top.
**Outcome:** With the [`@tenkicloud/openclaw`](https://www.npmjs.com/package/@tenkicloud/openclaw) plugin enabled, every agent tool execution in OpenClaw runs inside a [Tenki](https://tenki.cloud) Firecracker microVM, and `node verify.mjs` prints a `✓` line.

> **Honesty note:** Plugin 0.2.0 loads only on OpenClaw 2026.7.x. On 2026.8.1 or later, which includes `latest`, the install (with `--accept-capabilities`) reports success and the plugin then fails to load. Step 2 has the details.

OpenClaw distributes plugins and skills through [ClawHub](https://clawhub.ai). `@tenkicloud/openclaw` ([LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw)) is a sandbox backend: with `sandbox.mode: "all"`, every agent tool execution (shell commands, the filesystem bridge, interactive PTY sessions) runs inside a Tenki microVM instead of on your machine.

Each sandbox scope gets one Tenki session, the microVM its commands run in. The plugin finds that session by a runtime tag (`oc-tenki-<slug>-<hash>`; every session also carries `openclaw`) and creates it only if none exists, so an existing session is reused and a `PAUSED` one is resumed. On first use, the plugin uploads your local workspace into the session as a tarball; after that, tools read and write the session's copy, and nothing syncs back to your machine.

## Prerequisites

- An OpenClaw 2026.7.x host no older than 2026.7.1-2, the plugin's `minHostVersion`. The plugin is tested on 2026.7.34. That release's `engines` field asks for Node.js `>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0`.
- A Tenki API key (`tk_…`). Create one at https://app.tenki.cloud.
- The OpenSSH client (`ssh` and `ssh-keygen`) and `tar` on the machine that runs OpenClaw. The plugin generates its key with `ssh-keygen`, runs interactive sessions with plain `ssh`, and packs the workspace upload with `tar`. `verify.mjs` calls `ssh-keygen` too.
- Node.js and npm for the check in Step 6. CI runs it on Node 20.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/openclaw-tenki
```

The `npm` and `node` commands below run from this directory. The `openclaw` commands run wherever you use OpenClaw. The folder holds `package.json` and [`verify.mjs`](verify.mjs), a check that needs no OpenClaw host. The plugin itself installs into OpenClaw, not into this folder.

## Step 2 — Run a compatible OpenClaw host

**Plugin 0.2.0 loads on OpenClaw 2026.7.x (tested on 2026.7.34) but not on 2026.8.1 or later**, which includes the current `latest` and `extended-stable` tags (2026.10.3 and 2026.9.33 as of October 2026). OpenClaw retired the `openclaw/plugin-sdk/zod` subpath that the plugin imports, so a newer host fails to load it with `Plugin tenki cannot import openclaw/plugin-sdk/zod`. On those hosts the install (with the `--accept-capabilities` flag they require) still prints "Installed plugin: tenki", because the plugin's `minHostVersion` (`>=2026.7.1-2`) has no upper bound. Until a fixed plugin release ships, run it on a 2026.7.x host.

If you install OpenClaw from npm, pin the version. This is OpenClaw's own npm install line with `latest` replaced:

```bash
npm install -g openclaw@2026.7.34 --allow-scripts=openclaw
openclaw onboard --install-daemon
```

OpenClaw's README says the `--allow-scripts=openclaw` flag is for npm 12 or npm 11.16+; on npm 11.15 and earlier, omit it. `openclaw onboard` verifies model access, creates the workspace, and configures the Gateway. If you already run a 2026.7.x host, skip the install.

## Step 3 — Install the plugin

```bash
openclaw plugins install clawhub:@tenkicloud/openclaw
```

Or install from a checkout of the plugin repo. The parentheses run the commands in a subshell, so the clone lands in your home directory, outside the cookbook checkout, and your shell stays in the example folder:

```bash
(cd ~ && git clone https://github.com/LuxorLabs/tenki-openclaw && openclaw plugins install ./tenki-openclaw)
```

"Installed plugin: tenki" means the files are in place, not that the plugin loads on your host. OpenClaw hosts newer than 2026.7.x also require `--accept-capabilities` on install, but plugin 0.2.0 doesn't load on those hosts (Step 2).

## Step 4 — Authenticate

```bash
export TENKI_AUTH_TOKEN=tk_...        # or TENKI_API_KEY
```

The plugin uses the `authToken` value from its plugin config if you set one, and otherwise `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY`. Set the variable in the environment the OpenClaw Gateway runs in, since the plugin runs inside the Gateway process. The plugin's README recommends the environment variable over storing the key in config.

An `export` only reaches a Gateway you start from that same shell. If the Gateway runs as the launchd/systemd service that `openclaw onboard --install-daemon` installed in Step 2, put the key in OpenClaw's global env file, `~/.openclaw/.env` (or `$OPENCLAW_STATE_DIR/.env`), instead:

```
TENKI_AUTH_TOKEN=tk_...
```

OpenClaw's environment docs list that file, the Gateway's process environment, and the `env` block in `~/.openclaw/openclaw.json` among the trusted sources for provider credentials, and none of them overrides a value that is already set. The restart at the end of Step 5 picks the key up.

**The plugin does not read `~/.config/tenki/config.yaml`**, so a key saved with `tenki login` doesn't authenticate it. (`verify.mjs` does read that file; see Step 6.) Sessions are created in the workspace your key belongs to, so `workspaceId` in the plugin config is optional.

## Step 5 — Turn on the Tenki backend

OpenClaw's config is `~/.openclaw/openclaw.json`, in JSON5, so comments and trailing commas are allowed. Add these keys to it to enable the plugin and make `tenki` the sandbox backend for all agents:

```jsonc
{
  "plugins": {
    "entries": {
      "tenki": {
        "enabled": true,
        "config": {
          "image": "ubuntu-24",
          "memoryMb": 4096,
        },
      },
    },
  },
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "backend": "tenki",
      },
    },
  },
}
```

The config schema is strict: `authToken`, `baseUrl`, `workspaceId`, `image`, `workspaceRoot`, `idleTimeoutMinutes`, `cpuCores`, `memoryMb`, `diskSizeGb`, and `tags` are the only keys. Strings must be non-empty, and numbers must be 1 or more.

| Key | What it sets |
| --- | --- |
| `authToken` | Tenki API key. Prefer `TENKI_AUTH_TOKEN` / `TENKI_API_KEY` (Step 4). |
| `baseUrl` | Tenki API endpoint override. Defaults to the SDK's `TENKI_API_ENDPOINT` / `TENKI_API_URL` fallback. |
| `workspaceId` | Tenki workspace the sessions are created in. Optional. |
| `image` | Base image id for created sessions. Omit for the Tenki default image. |
| `workspaceRoot` | Absolute path inside the session for per-scope workspaces. Defaults to `/tmp/openclaw-sandboxes`. |
| `idleTimeoutMinutes` | Passed to session create. Don't rely on it to stop a session (see FAQ). |
| `cpuCores` / `memoryMb` / `diskSizeGb` | Resources per session. |
| `tags` | Extra tags attached to created sessions, after `openclaw` and the runtime tag. |

Then restart the Gateway and check that it came back up:

```bash
openclaw gateway restart
openclaw gateway status
```

OpenClaw's plugin docs say to restart the Gateway after changing plugin enablement before the plugin's code runs. The restart also loads a key you added to `~/.openclaw/.env` in Step 4.

## Step 6 — Check it works

```bash
npm install
node verify.mjs
```

`package.json`:

```json
{
  "name": "openclaw-tenki",
  "private": true,
  "type": "module",
  "description": "Cookbook example — OpenClaw agents with all tool execution in Tenki Firecracker microVMs via @tenkicloud/openclaw.",
  "dependencies": {
    "@tenkicloud/openclaw": "^0.2.0",
    "@tenkicloud/sandbox": ">=1.4.1"
  }
}
```

**The published plugin pins `@tenkicloud/sandbox` 0.5.2**, and that is the SDK it uses inside OpenClaw. This example declares `>=1.4.1`, and `verify.mjs` runs the same session calls against that newer SDK.

The check uses `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`, falling back to the key `tenki login` saved in `~/.config/tenki/config.yaml`. `TENKI_WORKSPACE_ID` is optional. It prints:

```
✓ openclaw-tenki: plugin contract → live find-by-tag → sh positional args → stdin staging → SSH cert + gateway → dispose
```

No OpenClaw host is needed. `verify.mjs` first checks the published plugin's OpenClaw manifest contract: plugin id `tenki`, a strict `configSchema` with all ten keys, an extension entry, a host version pin, and the `@tenkicloud/sandbox` dependency. It reads the manifest instead of importing the plugin, because the plugin's bundle only imports inside an OpenClaw host. It then makes the same Tenki calls the backend relies on, against a live session: create a session tagged `openclaw` and `oc-tenki-cookbook-verify`, find it by tag, exec with the `set --` prefix, round-trip stdin through a staged session file, mint an SSH cert and open the gateway stream, and dispose of the session.

It does not run the backend itself, an agent, or a model, and it uses SDK 1.4.1 or later rather than the plugin's 0.5.2. The backend's own behavior is covered by CI at [LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw).

## How commands reach the VM

Shell scripts run over the SDK exec surface as `/bin/sh -c`, with a `set --` prefix carrying positional args. Tenki's exec API rejects empty argv elements, and filesystem-bridge scripts pass empty positionals, so the plugin inlines them with shell quoting. The SDK exec surface has no stdin stream, so stdin is staged as a session file under `/home/tenki` that the script redirects onto fd 0. `verify.mjs` exercises both:

```js
  // Shell scripts run as `/bin/sh -c` with a `set --` prefix carrying $1..$n.
  const r1 = await session.exec("/bin/sh", { args: ["-c", `set -- 'hello world'\necho "arg:$1"`] });
  assert(r1.exitCode === 0 && stdoutText(r1).trim() === "arg:hello world", `positional args: ${JSON.stringify(stdoutText(r1))}`);

  // No stdin stream on the SDK exec surface: the backend stages stdin as a session file onto fd 0.
  const stdinFile = `/home/tenki/.openclaw-stdin-${randomUUID()}`;
  await session.writeFile(stdinFile, "stdin staged as a session file\n");
  const r2 = await session.exec("/bin/sh", {
    args: ["-c", `exec 0<"$OPENCLAW_STDIN_FILE" && rm -f -- "$OPENCLAW_STDIN_FILE"\ncat`],
    env: { OPENCLAW_STDIN_FILE: stdinFile },
  });
  assert(r2.exitCode === 0 && stdoutText(r2).trim() === "stdin staged as a session file", `stdin staging: ${JSON.stringify(stdoutText(r2))}`);
```

Interactive PTY sessions are plain `ssh -tt`, but the VM has no raw host or port to point `ssh` at. Instead, the plugin listens on a loopback socket and pipes each connection into an SSH stream that the SDK opens over a WebSocket to Tenki's gateway. Tenki's edge gateway accepts only certificate auth, so the plugin keeps a dedicated ed25519 key, generated once under the OpenClaw state dir (`$OPENCLAW_STATE_DIR/tenki`, or `~/.openclaw/tenki`), and mints short-lived per-session user certificates through the SDK, re-minting near expiry. No `tenki` CLI is needed anywhere.

## Troubleshooting

**❌ `Plugin tenki cannot import openclaw/plugin-sdk/zod`.** Your OpenClaw host is 2026.8.1 or later, which no longer has the `openclaw/plugin-sdk/zod` subpath plugin 0.2.0 imports. Run the plugin on a 2026.7.x host (Step 2) until a fixed plugin release ships.

**❌ `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option`.** The plugin's SDK found no key in its config or environment. It doesn't read the key `tenki login` saved, and a key you exported in your terminal doesn't reach a Gateway running as a service. Put `TENKI_AUTH_TOKEN=tk_...` in `~/.openclaw/.env` or the Gateway's own environment, or set `authToken` in the plugin config, then run `openclaw gateway restart` (Step 4).

**❌ `Invalid tenki plugin config: …`, or the Gateway refuses to start after you edit the plugin config.** A key outside the ten in Step 5, an empty string, or a number below 1. OpenClaw validates `openclaw.json` against the plugin's schema strictly, so it can reject the file before the plugin runs. Run `openclaw doctor` to see the exact issue, then remove or fix the key. A relative `workspaceRoot` passes the schema and fails separately in the plugin with `Tenki workspaceRoot must be an absolute POSIX path`.

**❌ `Tenki sandbox backend does not support sandbox.docker.binds.`** Your OpenClaw sandbox config sets `sandbox.docker.binds`, which the Tenki backend refuses. Remove the binds for agents that use the `tenki` backend.

**❌ `` No token. Set TENKI_AUTH_TOKEN, or run `tenki login`. ``** (from `verify.mjs`). The check found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export one, or run `tenki login --api-key <key>`.

**❌ `✗ ssh-keygen failed: …`** (from `verify.mjs`). The check couldn't generate its throwaway ed25519 key. Install the OpenSSH client so `ssh-keygen` is on your `PATH`. The plugin also runs `ssh-keygen` to create its own key, so the machine running OpenClaw needs it too.

## FAQ

**Does this ship with OpenClaw?** No. It's a community plugin from ClawHub. It was proposed upstream in [openclaw/openclaw#111792](https://github.com/openclaw/openclaw/pull/111792), which was closed, and the standalone package is the supported path. Bugs go to [LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw/issues), not the OpenClaw tracker.

**Does an idle agent stop costing money?** Not on its own. The plugin never pauses a session and sets no lifetime cap. It passes `idleTimeoutMinutes` through to session create, but Tenki sandboxes don't pause on idle. Pausing is free, and a paused session keeps its memory and disk. If a scope's session is `PAUSED`, the plugin resumes it on next use. The plugin closes a scope's sessions when OpenClaw removes that sandbox runtime. Every session it creates carries the `openclaw` tag, so you can find the ones you no longer need.

**Can the agent's commands reach the internet?** Yes. The plugin creates every session with outbound network allowed, and its config has no key to turn that off.

**When shouldn't I use this?**
- When your OpenClaw host is 2026.8.1 or later and you can't run a 2026.7.x host. Plugin 0.2.0 won't load until a fixed release ships.
- When your sandbox config needs `sandbox.docker.binds`, which the backend refuses.
- When you need sandboxes with no outbound network, which the plugin has no option for.
- When your workspace is large. The plugin buffers the workspace upload as a tarball in memory.
- When you need the agent's file changes on your machine, or expect edits you make locally (to the workspace or to skills) to reach a session that's already running. The plugin uploads both once, when the scope's runtime root is first created in the session, and syncs nothing back.
- When you expect sandbox handles to clean up their SSH listener. The SSH forwarder listener lives for the Gateway process lifetime, one per sandbox scope.

## Related

- [OpenClaw](https://github.com/openclaw/openclaw) and [ClawHub](https://clawhub.ai), where the plugin is published.
- [`@tenkicloud/openclaw`](https://www.npmjs.com/package/@tenkicloud/openclaw) on npm, with source and issues at [LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw).
- [openclaw/openclaw#111792](https://github.com/openclaw/openclaw/pull/111792), the closed upstream proposal.
- [Tenki docs](https://tenki.cloud/docs).
- [`../deerflow-tenki/`](../deerflow-tenki/), DeerFlow agents with Tenki as a community sandbox provider.
- [`../snapshots-pause-resume/`](../snapshots-pause-resume/), pausing and resuming a Tenki sandbox. The plugin resumes paused sessions but never pauses one.
