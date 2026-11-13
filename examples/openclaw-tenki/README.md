# OpenClaw

Run every [OpenClaw](https://github.com/openclaw/openclaw) agent tool in a Tenki sandbox. With the [`@tenkicloud/openclaw`](https://www.npmjs.com/package/@tenkicloud/openclaw) plugin and `sandbox.mode: "all"`, shell commands, the filesystem bridge, and interactive PTY sessions run in a Tenki session instead of on your machine. The plugin is published on [ClawHub](https://clawhub.ai), with source at [LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw).

> **Status:** plugin 0.3.0 requires OpenClaw 2026.10.9 or later (`openclaw.install.minHostVersion`) and Node.js 24.22.1+ or 26.12.1+. Tested end to end on 2026.10.9. Plugin 0.2.x stays published for OpenClaw 2026.7.x hosts and does not load on 2026.8.1 or later. This example tracks 0.3.0; until it is on npm, `npm install` here pulls 0.2.0 and `verify.mjs` accepts either manifest.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Make my OpenClaw agents run their tools in Tenki sandboxes, following https://github.com/LuxorLabs/cookbook/tree/main/examples/openclaw-tenki.
1. Check my OpenClaw version with openclaw --version. Plugin 0.3.0 needs 2026.10.9 or later and Node 24.22.1+ (or 26.12.1+). If I'm on 2026.7.x, install plugin 0.2.x instead; if I'm on 2026.8.x or 2026.9.x, stop and tell me before changing anything.
2. Check that ssh, ssh-keygen, and tar are installed, then run openclaw plugins install clawhub:@tenkicloud/openclaw.
3. The Gateway needs TENKI_AUTH_TOKEN (a Tenki key starting with tk_, from https://app.tenki.cloud). Ask me to add it to ~/.openclaw/.env myself. Never ask me to paste the key to you, print it, or write it to a file yourself.
4. Add the plugins.entries.tenki and agents.defaults.sandbox blocks from the README to ~/.openclaw/openclaw.json (plus plugins.allow: ["tenki"] if the plugin was not installed from ClawHub), then run openclaw gateway restart and openclaw gateway status.
5. To check the Tenki side, clone https://github.com/LuxorLabs/cookbook, cd into examples/openclaw-tenki, run npm install and node verify.mjs (it needs the key exported in that shell; ask me to export it), and confirm the ✓ line.
6. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- An OpenClaw 2026.10.9 or later host, on Node.js `>=24.22.1` or `>=26.12.1`. For a 2026.7.x host, use plugin 0.2.x instead.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- `ssh`, `ssh-keygen`, and `tar` on the machine that runs OpenClaw.

### 1. Install

If you install OpenClaw from npm, pin 2026.10.9 or later:

```bash
npm install -g openclaw@2026.10.9 --allow-scripts=openclaw
openclaw onboard --install-daemon
```

Omit `--allow-scripts=openclaw` on npm 11.15 and earlier. Then install the plugin:

```bash
openclaw plugins install clawhub:@tenkicloud/openclaw
```

Or from a checkout: `(cd ~ && git clone https://github.com/LuxorLabs/tenki-openclaw && openclaw plugins install ./tenki-openclaw)`. A plugin installed from a local path or archive instead of ClawHub must also be listed in `plugins.allow` (Step 3), or the host refuses to load it. Don't `plugins install --link` a checkout that has its own `node_modules/openclaw`; the host rejects it (see Troubleshooting).

### 2. Set your API key

The plugin runs inside the Gateway, so the key goes in the Gateway's environment. For a Gateway running as a service, add it to `~/.openclaw/.env` (or `$OPENCLAW_STATE_DIR/.env`):

```
TENKI_AUTH_TOKEN=tk_...
```

`TENKI_API_KEY` also works, as does `authToken` in the plugin config. The plugin doesn't read the `tenki login` key. Sessions are created in the key's workspace.

### 3. Run

Add this to `~/.openclaw/openclaw.json` (JSON5) to enable the plugin and make `tenki` the sandbox backend for all agents:

```jsonc
{
  "plugins": {
    // Only for a plugin installed from a local path or archive. ClawHub installs don't need it.
    "allow": ["tenki"],
    "entries": {
      "tenki": {
        "enabled": true,
        "config": {
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
        // Defaults to "none". "rw" mirrors the agent workspace into the session.
        "workspaceAccess": "rw",
      },
    },
  },
}
```

Leave `image` out unless you have a registry image: Tenki rejects base-image ids such as `ubuntu-24`.

Then restart the Gateway:

```bash
openclaw gateway restart
openclaw gateway status
```

Agent tool calls now run in Tenki sessions tagged `openclaw`.

### 4. Verify

From this example's folder, with the key exported:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/openclaw-tenki
npm install
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY or a `tenki login` key also work
node verify.mjs
```

```
✓ openclaw-tenki: plugin contract → live find-by-tag → sh positional args → stdin staging → SSH cert + gateway → dispose
```

`verify.mjs` needs no OpenClaw host. It checks the published plugin's manifest (id `tenki`, the strict config schema, host version pin), then makes the Tenki calls the backend relies on against a live session: find by tag, exec with positional args, stdin staging, an SSH certificate and gateway stream, and dispose. It uses SDK 1.4.1 or later; plugin 0.3.0 pins `@tenkicloud/sandbox` 1.4.1 (0.2.0 pinned 0.5.2). The backend's own tests run at [LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw).

## Plugin config

The schema is strict: only these keys, strings non-empty, numbers 1 or more.

| Key | What it sets |
| --- | --- |
| `authToken` | Tenki API key. Prefer `TENKI_AUTH_TOKEN` / `TENKI_API_KEY` (Step 2). |
| `baseUrl` | Tenki API endpoint override. Defaults to the SDK's `TENKI_API_ENDPOINT` / `TENKI_API_URL` fallback. |
| `workspaceId` | Tenki workspace the sessions are created in. Optional. |
| `image` | Tenki registry image ref (`workspace/name:tag` or `name@<snapshot-id>`, listed by `tenki sandbox registry list`). Omit for the Tenki default image. Base-image ids such as `ubuntu-24` are rejected with `registry image not found`. |
| `workspaceRoot` | Absolute path inside the session for per-scope workspaces. Defaults to `/tmp/openclaw-sandboxes`. |
| `maxDurationMinutes` | Hard cap on session lifetime in minutes; the session is terminated after that much total runtime. Replaces `idleTimeoutMinutes`, which the SDK ignores. |
| `cpuCores` / `memoryMb` / `diskSizeGb` | Resources per session. |
| `tags` | Extra tags attached to created sessions, after `openclaw` and the runtime tag. |

## How it works

- **One session per sandbox scope.** The plugin finds it by a runtime tag (`oc-tenki-<slug>-<hash>`) and creates it only if none exists, resuming a `PAUSED` one.
- **Workspace upload.** On first use the plugin uploads your workspace and skills as a tarball. After that, tools work on the session's copy and nothing syncs back.
- **Commands** run as `/bin/sh -c` with a `set --` prefix for positional args, and stdin is staged as a session file under `/home/tenki`. From `verify.mjs`:

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

- **PTY sessions** are plain `ssh -tt` through a loopback socket that the plugin pipes to Tenki's SSH gateway over a WebSocket. The plugin keeps an ed25519 key under `$OPENCLAW_STATE_DIR/tenki` (or `~/.openclaw/tenki`) and mints short-lived per-session certificates. No `tenki` CLI is needed.

## Things to know

- **Sessions don't stop on idle.** The plugin never pauses a session and Tenki doesn't pause on idle. Set `maxDurationMinutes` for a hard cap; otherwise sessions close when OpenClaw removes the sandbox runtime. Find leftovers by the `openclaw` tag.
- **Outbound network is always on.** The config has no option to turn it off.
- `sandbox.docker.binds` isn't supported.
- Large workspaces are buffered in memory during upload.
- Bugs go to [LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw/issues). The upstream proposal, [openclaw/openclaw#111792](https://github.com/openclaw/openclaw/pull/111792), was closed.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `[not_found] registry image not found` | `image` is a registry ref, not a base-image id. Remove `image` or use a ref from `tenki sandbox registry list`. |
| Plugin skipped with `reason=provenance-invalid` | The plugin wasn't installed from ClawHub. Add `"allow": ["tenki"]` under `plugins`. |
| `Plugin entry is outside its captured source package` | You ran `plugins install --link` on a checkout with its own `node_modules/openclaw`. Install from ClawHub or a tarball instead. |
| `SSH sandbox environment requires secure script staging` | Plugin older than 0.3.0 on a 2026.10.x host. Upgrade the plugin. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY …` | Put the key in `~/.openclaw/.env` or the Gateway's environment, then `openclaw gateway restart`. |
| `Invalid tenki plugin config: …`, or the Gateway won't start | Run `openclaw doctor` and fix the key it names. |
| `Tenki workspaceRoot must be an absolute POSIX path` | Use an absolute `workspaceRoot`. |
| `Tenki sandbox backend does not support sandbox.docker.binds.` | Remove the binds for agents on the `tenki` backend. |
| `` No token. Set TENKI_AUTH_TOKEN, or run `tenki login`. `` from `verify.mjs` | Export a key or run `tenki login --api-key <key>`. |
| `✗ ssh-keygen failed: …` | Install the OpenSSH client. |

## Related

- [OpenClaw](https://github.com/openclaw/openclaw) and [ClawHub](https://clawhub.ai)
- [`@tenkicloud/openclaw` on npm](https://www.npmjs.com/package/@tenkicloud/openclaw) and [LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw)
- [DeerFlow](../deerflow-tenki/) and [Pause, snapshot, and resume](../snapshots-pause-resume/)
