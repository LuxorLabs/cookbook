# OpenClaw

Keep your OpenClaw agents' commands and file edits off your computer by running them on a Tenki cloud machine.

[OpenClaw](https://github.com/openclaw/openclaw) is an open-source AI assistant you run yourself. A background service called the **Gateway** runs your agents, and those agents use **tools** to act: running shell commands, reading and editing files, and opening interactive terminal sessions. OpenClaw can **sandbox** those tools, so they run somewhere other than the Gateway's machine, and it lets plugins supply that somewhere.

The [`@tenkicloud/openclaw`](https://www.npmjs.com/package/@tenkicloud/openclaw) plugin makes it a Tenki sandbox. With `sandbox.mode: "all"`, every agent's tools run in its own Tenki sandbox instead of on your machine. The plugin is published on [ClawHub](https://clawhub.ai), OpenClaw's plugin directory, with source at [LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw).

> **Status:** plugin 0.2.0 works only with OpenClaw 2026.7.x (tested on 2026.7.34). OpenClaw 2026.8.1 and later, including `latest`, removed something the plugin imports, so it fails to load there even though the install reports success.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Make my OpenClaw agents run their tools in Tenki sandboxes, following https://github.com/LuxorLabs/cookbook/tree/main/examples/openclaw-tenki.
1. Check my OpenClaw version with openclaw --version. The plugin loads only on 2026.7.x, so if I'm on 2026.8.1 or later, stop and tell me before changing anything.
2. Check that ssh, ssh-keygen, and tar are installed, then run openclaw plugins install clawhub:@tenkicloud/openclaw.
3. The Gateway needs TENKI_AUTH_TOKEN (a Tenki key starting with tk_, from https://app.tenki.cloud). Ask me to add it to ~/.openclaw/.env myself. Never ask me to paste the key to you, print it, or write it to a file yourself.
4. Add the plugins.entries.tenki and agents.defaults.sandbox blocks from the README to ~/.openclaw/openclaw.json, then run openclaw gateway restart and openclaw gateway status.
5. To check the Tenki side, clone https://github.com/LuxorLabs/cookbook, cd into examples/openclaw-tenki, run npm install and node verify.mjs (it needs the key exported in that shell; ask me to export it), and confirm the ✓ line.
6. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- A machine running OpenClaw 2026.7.x. That release needs Node.js `>=22.22.3 <23`, `>=24.15.0 <25`, or `>=25.9.0`.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- `ssh`, `ssh-keygen`, and `tar` on the machine that runs OpenClaw.

### 1. Install

If you install OpenClaw from npm, pin a 2026.7.x version:

```bash
npm install -g openclaw@2026.7.34 --allow-scripts=openclaw
openclaw onboard --install-daemon
```

Omit `--allow-scripts=openclaw` on npm 11.15 and earlier. Then install the plugin:

```bash
openclaw plugins install clawhub:@tenkicloud/openclaw
```

Or from a checkout: `(cd ~ && git clone https://github.com/LuxorLabs/tenki-openclaw && openclaw plugins install ./tenki-openclaw)`.

### 2. Set your API key

The plugin runs inside the Gateway, so the Gateway needs the key in its environment. For a Gateway running as a service, add it to `~/.openclaw/.env` (or `$OPENCLAW_STATE_DIR/.env`):

```
TENKI_AUTH_TOKEN=tk_...
```

`TENKI_API_KEY` also works, as does `authToken` in the plugin config. The plugin doesn't read the `tenki login` key. Sandboxes are created in the key's Tenki workspace. (In the Tenki API and in this README, a running sandbox is also called a **session**.)

### 3. Run

Add this to `~/.openclaw/openclaw.json` to turn on the plugin and make Tenki the place every agent's tools run (`mode: "all"` sandboxes every agent, and `backend: "tenki"` picks this plugin):

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

Then restart the Gateway:

```bash
openclaw gateway restart
openclaw gateway status
```

Agent tool calls now run in Tenki sandboxes tagged `openclaw`. Ask an agent to run `uname -a` and it reports a Linux VM, not your machine.

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

`verify.mjs` doesn't need OpenClaw installed. It checks the published plugin's manifest (its id, config schema, and supported OpenClaw versions), then makes the same Tenki calls the plugin relies on against a live sandbox: find a sandbox by tag, run a command with arguments, pass a command its input, open an SSH connection, and delete the sandbox. It uses SDK 1.4.1 or later; the published plugin pins `@tenkicloud/sandbox` 0.5.2. The backend's own tests run at [LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw).

## Plugin config

The schema is strict: only these keys, strings non-empty, numbers 1 or more.

| Key | What it sets |
| --- | --- |
| `authToken` | Tenki API key. Prefer `TENKI_AUTH_TOKEN` / `TENKI_API_KEY` (Step 4). |
| `baseUrl` | Tenki API endpoint override. Defaults to the SDK's `TENKI_API_ENDPOINT` / `TENKI_API_URL` fallback. |
| `workspaceId` | Tenki workspace the sessions are created in. Optional. |
| `image` | Base image id for created sessions. Omit for the Tenki default image. |
| `workspaceRoot` | Absolute path inside the sandbox where each agent's copy of its workspace goes. Defaults to `/tmp/openclaw-sandboxes`. |
| `idleTimeoutMinutes` | Passed to Tenki when creating a sandbox. Don't rely on it to stop one (see [Things to know](#things-to-know)). |
| `cpuCores` / `memoryMb` / `diskSizeGb` | Resources per session. |
| `tags` | Extra tags attached to created sessions, after `openclaw` and the runtime tag. |

## How it works

- **One sandbox per OpenClaw sandbox scope** (by default, per agent). The plugin tags each sandbox (`oc-tenki-<slug>-<hash>`), finds it by that tag, and creates one only if none exists. A paused one is resumed.
- **Workspace upload.** On first use the plugin uploads the agent's workspace (its working files) and skills as one archive. After that, tools work on the sandbox's copy, and changes don't sync back to your machine.
- **Commands** run through `/bin/sh -c`. The plugin passes a script's arguments (`$1`, `$2`, …) with a `set --` prefix. Tenki's command call has no input stream, so when a command needs input, the plugin writes it to a file in the sandbox and the command reads it from there. From `verify.mjs`:

```js
  // Shell scripts run as `/bin/sh -c`, with a `set --` prefix that sets their arguments $1..$n.
  const r1 = await session.exec("/bin/sh", { args: ["-c", `set -- 'hello world'\necho "arg:$1"`] });
  assert(r1.exitCode === 0 && stdoutText(r1).trim() === "arg:hello world", `positional args: ${JSON.stringify(stdoutText(r1))}`);

  // The SDK's exec call has no input stream, so the plugin writes input to a file and the command reads it from there.
  const stdinFile = `/home/tenki/.openclaw-stdin-${randomUUID()}`;
  await session.writeFile(stdinFile, "stdin staged as a session file\n");
  const r2 = await session.exec("/bin/sh", {
    args: ["-c", `exec 0<"$OPENCLAW_STDIN_FILE" && rm -f -- "$OPENCLAW_STDIN_FILE"\ncat`],
    env: { OPENCLAW_STDIN_FILE: stdinFile },
  });
  assert(r2.exitCode === 0 && stdoutText(r2).trim() === "stdin staged as a session file", `stdin staging: ${JSON.stringify(stdoutText(r2))}`);
```

- **Interactive terminals** (what OpenClaw calls PTY sessions) use plain `ssh`. The plugin connects it to Tenki's SSH gateway over a WebSocket. It keeps an SSH key under `$OPENCLAW_STATE_DIR/tenki` (or `~/.openclaw/tenki`) and gets a short-lived certificate for each sandbox, so there are no passwords or keys to manage. No `tenki` CLI is needed.

## Things to know

- **Sandboxes don't stop on their own.** The plugin never pauses a sandbox and sets no lifetime cap, and Tenki doesn't pause idle sandboxes, so `idleTimeoutMinutes` doesn't stop anything. A sandbox closes when OpenClaw removes the agent's sandbox. Find leftovers by the `openclaw` tag.
- **Outbound network is always on.** The config has no option to turn it off.
- `sandbox.docker.binds` isn't supported.
- Large workspaces are buffered in memory during upload.
- Bugs go to [LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw/issues). The upstream proposal, [openclaw/openclaw#111792](https://github.com/openclaw/openclaw/pull/111792), was closed.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Plugin tenki cannot import openclaw/plugin-sdk/zod` | You're on OpenClaw 2026.8.1 or later. Install 2026.7.34. |
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
