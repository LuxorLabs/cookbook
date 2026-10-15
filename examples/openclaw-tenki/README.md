# OpenClaw agents on Tenki sandboxes

[OpenClaw](https://github.com/openclaw/openclaw) is an open-source personal AI assistant you run yourself, with plugins and skills distributed through [ClawHub](https://clawhub.ai). The [`@tenkicloud/openclaw`](https://www.npmjs.com/package/@tenkicloud/openclaw) plugin ([LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw)) is a sandbox **backend**: with `sandbox.mode: "all"`, every agent tool execution — shell commands, the filesystem bridge, interactive PTY sessions — runs inside a [Tenki](https://tenki.cloud) Firecracker microVM instead of on your machine.

Each sandbox scope gets one Tenki session (the microVM its commands run in). The plugin finds that session by a runtime tag (`oc-tenki-<slug>-<hash>`; every session also carries `openclaw`) and creates it only if none exists, so existing sessions are reused and `PAUSED` ones are resumed. An idle session that pauses stops billing until the agent comes back.

## Set it up

```bash
openclaw plugins install clawhub:@tenkicloud/openclaw
export TENKI_AUTH_TOKEN=tk_...        # or TENKI_API_KEY; env wins over config
```

(Or from a checkout: `git clone https://github.com/LuxorLabs/tenki-openclaw && openclaw plugins install ./tenki-openclaw`.)

> **Host compatibility:** plugin 0.2.0 loads on OpenClaw 2026.7.x (tested on 2026.7.34) but not on 2026.8.1 or later, which includes `latest` (2026.10.3). OpenClaw retired the `openclaw/plugin-sdk/zod` subpath that the plugin imports, so a newer host fails to load it with `Plugin tenki cannot import openclaw/plugin-sdk/zod`. The install still prints "Installed plugin: tenki" because the plugin's `minHostVersion` (`>=2026.7.1-2`) has no upper bound. Until a fixed plugin release ships, run it on a 2026.7.x host. Newer hosts also require `--accept-capabilities` on install.

Then enable it in your OpenClaw config:

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

The config schema is strict — `authToken`, `baseUrl`, `workspaceId`, `image`, `workspaceRoot`, `idleTimeoutMinutes`, `cpuCores`, `memoryMb`, `diskSizeGb`, and `tags` are the only keys.

## How execution reaches the VM

Shell scripts run over the SDK exec surface as `/bin/sh -c`, with a `set --` prefix carrying positional args and stdin staged as a session file that the script redirects onto fd 0. Interactive PTY sessions are plain `ssh -tt`, but the VM has no raw host or port to point `ssh` at. Instead, the plugin listens on a loopback socket and pipes each connection into an SSH stream that the SDK opens over a WebSocket to Tenki's gateway. Tenki's edge gateway accepts only certificate auth, so the plugin keeps a dedicated ed25519 key and mints short-lived per-session user certificates through the SDK, re-minting near expiry.

## Verify

```bash
npm install
node verify.mjs
```

No OpenClaw host is needed. [`verify.mjs`](verify.mjs) first checks the published plugin's OpenClaw manifest contract (plugin id `tenki`, strict `configSchema`, extension entry, host version pin). It then makes the same Tenki calls the backend relies on, against a live session: create a tagged session, find it by tag, exec with the `set --` prefix, round-trip stdin through a staged session file, mint an SSH cert and open the gateway stream, dispose. It does not run the backend itself; that behavior is covered by CI at [LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw).

## Notes

- This is a **community plugin** installed from ClawHub — it does not ship with OpenClaw. (It was proposed upstream in [openclaw/openclaw#111792](https://github.com/openclaw/openclaw/pull/111792), which was closed; the standalone package is the supported path.)
- The published plugin pins `@tenkicloud/sandbox` 0.5.2. This example declares `>=1.4.1`, and `verify.mjs` runs the same session calls against that newer SDK.
- Bugs go to [LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw/issues), not the OpenClaw tracker.
