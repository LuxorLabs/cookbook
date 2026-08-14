# OpenClaw agents on Tenki sandboxes

[OpenClaw](https://github.com/openclaw/openclaw) is an open-source personal AI assistant you run yourself, with plugins and skills distributed through [ClawHub](https://clawhub.ai). The [`@tenkicloud/openclaw`](https://www.npmjs.com/package/@tenkicloud/openclaw) plugin ([LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw)) is a sandbox **backend**: with `sandbox.mode: "all"`, every agent tool execution — shell commands, the filesystem bridge, interactive PTY sessions — runs inside a [Tenki](https://tenki.cloud) Firecracker microVM instead of on your machine.

Each sandbox scope gets one session, found-or-created by a runtime tag (`oc-tenki-<slug>-<hash>`, plus `openclaw` on all of them): existing sessions are reused, `PAUSED` ones are resumed, and an idle session that pauses stops billing until the agent comes back.

## Set it up

```bash
openclaw plugins install clawhub:@tenkicloud/openclaw
export TENKI_AUTH_TOKEN=tk_...        # or TENKI_API_KEY; env wins over config
```

(Or from a checkout: `git clone https://github.com/LuxorLabs/tenki-openclaw && openclaw plugins install ./tenki-openclaw`.)

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

Shell scripts run over the SDK exec surface as `/bin/sh -c`, with a `set --` prefix carrying positional args and stdin staged as a session file that the script redirects onto fd 0. Interactive PTY sessions are plain `ssh -tt` — but there is no raw host or port to point it at: the plugin listens on a loopback socket and pipes each connection into the SDK's gateway **WebSocket** SSH stream. Tenki's edge gateway accepts only certificate auth, so the plugin keeps a dedicated ed25519 key and mints short-lived per-session user certificates through the SDK, re-minting near expiry.

## Verify

```bash
npm install
node verify.mjs
```

No OpenClaw host needed: [`verify.mjs`](verify.mjs) asserts the published plugin's OpenClaw manifest contract (plugin id `tenki`, strict `configSchema`, extension entry, host version pin), then proves the live path the backend rides on — create a tagged session, find it by tag, exec with the `set --` prefix, round-trip stdin through a staged session file, mint an SSH cert and open the gateway stream, dispose. The backend's own behavior is covered by CI at [LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw).

## Notes

- This is a **community plugin** installed from ClawHub — it does not ship with OpenClaw. (It was proposed upstream in [openclaw/openclaw#111792](https://github.com/openclaw/openclaw/pull/111792), which was closed; the standalone package is the supported path.)
- The plugin pins `@tenkicloud/sandbox` 0.5.2; this example depends on `^0.5.4`, which has the same session surface.
- Bugs go to [LuxorLabs/tenki-openclaw](https://github.com/LuxorLabs/tenki-openclaw/issues), not the OpenClaw tracker.
