#!/usr/bin/env bash
# Runs inside the sandbox: install OpenClaw, onboard it, and start the gateway as a systemd user service.
# Env: OPENCLAW_VERSION, PUBLIC_URL, OPENCLAW_GATEWAY_TOKEN, and optionally ANTHROPIC_API_KEY.
set -euo pipefail

npm install -g "openclaw@${OPENCLAW_VERSION}" --allow-scripts=openclaw --no-audit --no-fund

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then model=(--anthropic-api-key "$ANTHROPIC_API_KEY"); else model=(--auth-choice skip); fi
openclaw onboard --non-interactive --accept-risk --mode local "${model[@]}" \
  --gateway-bind lan --gateway-auth token --gateway-token "$OPENCLAW_GATEWAY_TOKEN" \
  --skip-daemon --skip-health --skip-channels --skip-skills --skip-hooks --skip-search --skip-ui

# The preview URL is the only allowed browser origin. Tenki's edge connects from 172.30.0.0/16 and
# rebuilds X-Forwarded-For; the gateway rejects proxied requests unless that source is trusted.
openclaw config set gateway.publicOrigin "$PUBLIC_URL"
openclaw config set gateway.trustedProxies '["172.30.0.0/16"]' --strict-json

# systemd restarts the gateway if it exits; lingering keeps the user manager up with no login session.
sudo loginctl enable-linger "$(id -un)"
XDG_RUNTIME_DIR="/run/user/$(id -u)" openclaw gateway install

for _ in $(seq 60); do curl -fsS http://127.0.0.1:18789/healthz && exit 0; sleep 2; done
echo "gateway did not become healthy" >&2
exit 1
