# OpenClaw gateway on Tenki

Host the [OpenClaw](https://openclaw.ai) gateway in a [Tenki](https://tenki.cloud) sandbox that keeps running until you terminate it, and open its dashboard at a fixed HTTPS address. `run.mjs` creates a sticky sandbox, installs and onboards OpenClaw without prompts, starts the gateway as a systemd service, and points a named preview URL at port 18789. Rerun it and the same URL moves to the new sandbox.

This runs the whole gateway on Tenki. To keep OpenClaw on your machine and run only its agent tools in Tenki sandboxes, see [OpenClaw sandbox backend](../openclaw-tenki/).

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Host an OpenClaw gateway on Tenki, following https://github.com/LuxorLabs/cookbook/tree/main/examples/openclaw-gateway-tenki.
1. Clone the repo, cd into examples/openclaw-gateway-tenki, and run npm install (Node.js 20 or later).
2. It needs TENKI_AUTH_TOKEN (a Tenki key starting with tk_, from https://app.tenki.cloud), OPENCLAW_GATEWAY_TOKEN, and optionally ANTHROPIC_API_KEY in the environment. If one is missing, stop and ask me to export it. Never print the keys or write them to a file.
3. Run node verify.mjs and confirm the ✓ line.
4. Run node run.mjs and give me the dashboard URL and sandbox ID it prints.
5. When I've opened the dashboard and entered my gateway token, list the pending pairing request with tenki sandbox exec --session <sandbox-id> -- bash -lc 'openclaw devices list' and approve the one I confirm.
6. If a step fails, use the Troubleshooting table in the example's README.md.
Remind me that the sandbox runs until it is terminated.
```

## Quick start

You need:

- Node.js 20 or later.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- A model provider key. The example wires `ANTHROPIC_API_KEY`; without it the gateway starts with no model and you add one later.
- The [`tenki` CLI](https://tenki.cloud/docs) for approving devices and cleaning up.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/openclaw-gateway-tenki
npm install
```

### 2. Set your keys

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
export OPENCLAW_GATEWAY_TOKEN=$(openssl rand -hex 32)
export ANTHROPIC_API_KEY=sk-ant-...
```

Preview URLs are public, so the gateway token is what keeps strangers out. Save it in your password manager: you paste it into the dashboard. `OPENCLAW_SLUG` (default `openclaw`) names the preview URL.

### 3. Run

```bash
node run.mjs
```

```text
dashboard: https://openclaw--<workspace>.us.sb.tenki.sh
sandbox:   01a1…
```

It takes about a minute. Open the dashboard, paste the gateway token into **Gateway secret**, and click **Connect**. A new browser then waits for pairing approval. Approve it from your machine:

```bash
tenki sandbox exec --session <sandbox-id> -- bash -lc 'openclaw devices list'
tenki sandbox exec --session <sandbox-id> -- bash -lc 'openclaw devices approve <requestId>'
```

Or open a shell with `tenki sandbox ssh <sandbox-id>` and run `openclaw` commands there.

### 4. Verify

```bash
node verify.mjs
```

```text
  preview URL: https://openclaw-91ac22--<workspace>.us.sb.tenki.sh
✓ openclaw-gateway-tenki: sticky sandbox → onboard 2026.10.8 → /healthz → dashboard 200 → wss wrong token rejected → hello-ok
```

`verify.mjs` needs no model key. It runs `setup.sh` in a sticky sandbox behind a uniquely named preview URL, checks `/healthz` and the dashboard page over that URL, then opens a WebSocket through it: a wrong token gets `AUTH_TOKEN_MISMATCH` and a fresh random token gets `hello-ok`. It deletes the URL and the sandbox either way. It takes about 80 seconds.

## How it works

`setup.sh` runs inside the sandbox:

```bash
npm install -g "openclaw@${OPENCLAW_VERSION}" --allow-scripts=openclaw --no-audit --no-fund
openclaw onboard --non-interactive --accept-risk --mode local "${model[@]}" \
  --gateway-bind lan --gateway-auth token --gateway-token "$OPENCLAW_GATEWAY_TOKEN" \
  --skip-daemon --skip-health --skip-channels --skip-skills --skip-hooks --skip-search --skip-ui
openclaw config set gateway.publicOrigin "$PUBLIC_URL"
openclaw config set gateway.trustedProxies '["172.30.0.0/16"]' --strict-json
sudo loginctl enable-linger "$(id -un)"
XDG_RUNTIME_DIR="/run/user/$(id -u)" openclaw gateway install
```

- **Bind to `lan`.** Tenki's edge connects to the sandbox's network interface, not loopback, so a loopback-bound gateway answers `502`. OpenClaw requires a token or password for a non-loopback bind.
- **`publicOrigin`** makes the preview URL the only browser origin the gateway accepts. A dashboard opened from any other origin is refused with `origin not allowed`.
- **`trustedProxies`.** The edge connects from `172.30.0.0/16` and rewrites `X-Forwarded-For` (a client can't spoof it). Without this setting the gateway rejects every proxied request with `proxy_attribution_required`.
- **systemd.** The sandbox runs systemd, so `openclaw gateway install` registers a user service that restarts the gateway if it exits. Lingering keeps it running with nobody logged in.
- **The named URL is separate from the sandbox.** `run.mjs` reuses the URL with your slug, or creates it bound to the new sandbox. A URL that already serves an older sandbox moves to the new one only after the new gateway is healthy, so a rebuild swaps sandboxes behind the same address. The hostname is `<slug>--<workspace suffix>.<region>.sb.tenki.sh`, and the slug is unique in your workspace. A URL created without a sandbox has no region in its hostname and doesn't serve until it is bound, which is why `run.mjs` always binds before it reads the address.
- **Sticky.** `sticky: true` keeps the sandbox running with no lifetime cap, across pause and resume.

## Notes

- **Cost and cleanup.** The sandbox runs, and bills, until you terminate it. `tenki sandbox terminate <sandbox-id>` removes it and also deletes the named URL bound to it. Running `run.mjs` again with the same slug recreates the same address.
- **State lives on the sandbox disk.** Config, sessions, paired devices, and the model key sit in `~/.openclaw` on the sandbox. A rebuilt sandbox starts fresh, so you pair your browser again.
- **One sandbox at a time.** After a rebuild, `run.mjs` prints the previous sandbox's ID. It no longer serves the URL but keeps running until you terminate it.
- **Model key.** `setup.sh` passes `ANTHROPIC_API_KEY` to `--anthropic-api-key`. For another provider, swap the flag (`openclaw onboard --help` lists them), or add one later from the dashboard.
- **Paused sandboxes** serve no traffic: the URL returns `404` until you resume.
- **OpenClaw version.** `OPENCLAW_VERSION` pins 2026.10.8, which needs Node.js 24.22.1 or later. The Tenki base image ships Node.js 24.22.1.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Set OPENCLAW_GATEWAY_TOKEN, …` | Export a token, e.g. `export OPENCLAW_GATEWAY_TOKEN=$(openssl rand -hex 32)`. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `` No token. Set TENKI_AUTH_TOKEN, or run `tenki login`. `` from `verify.mjs` | Export a key or run `tenki login --api-key <key>`. |
| Dashboard says **This Gateway expects its token** | Paste `OPENCLAW_GATEWAY_TOKEN` into **Gateway secret**. |
| Dashboard waits on `pairing required` | Approve the browser with `openclaw devices list` and `openclaw devices approve <requestId>` (step 3). |
| `{"type":"proxy_attribution_required"}` | The edge connected from an address outside `trustedProxies`. Find it with `openclaw logs` (`observed unattributable proxy-shaped traffic from <ip>`) and add it to `gateway.trustedProxies`. |
| `origin not allowed` | `gateway.publicOrigin` doesn't match the URL you opened. Rerun `run.mjs` with the same `OPENCLAW_SLUG`. |
| `setup.sh failed` | `run.mjs` prints the script's stderr and terminates the new sandbox. Your existing URL stays on the old one. |

## Related

- [OpenClaw sandbox backend](../openclaw-tenki/): run OpenClaw's agent tools in Tenki sandboxes
- [Expose a port](../expose-a-port/): preview URL basics
- [Pause, snapshot, and resume](../snapshots-pause-resume/)
- [OpenClaw docs: Gateway](https://docs.openclaw.ai/gateway) and [Connect and pair](https://docs.openclaw.ai/web/control-ui/connect-and-pair)
