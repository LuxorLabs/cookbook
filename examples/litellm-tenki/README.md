# LiteLLM proxy

Run a [LiteLLM](https://docs.litellm.ai) proxy in a long-lived Tenki sandbox and serve it on a named HTTPS URL that keeps its address when you redeploy. Your OpenAI and Anthropic keys are stored as Tenki workspace secrets. The sandbox only ever sees `secrets://NAME` references; Tenki swaps in the real key on the way out, and only on requests to that provider's API. Any OpenAI-compatible client, or Claude Code, can then use the proxy with one master key.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "LiteLLM proxy" example from https://github.com/LuxorLabs/cookbook, which runs a LiteLLM proxy in a long-lived Tenki sandbox on a named URL, with provider keys held as Tenki workspace secrets.
1. Clone the repo, cd into examples/litellm-tenki, and run npm install (Node.js 20 or later).
2. It needs TENKI_AUTH_TOKEN (a Tenki key starting with tk_, from https://app.tenki.cloud) and at least one of OPENAI_API_KEY or ANTHROPIC_API_KEY in the environment. If they are missing, stop and ask me to export them. Never print the keys or write them to a file.
3. Run node verify.mjs and confirm the ✓ line.
4. Run node run.mjs and give me the proxy URL and the LITELLM_MASTER_KEY line it prints.
5. If a step fails, use the Troubleshooting table in the example's README.md.
Remind me the proxy keeps running (and billing) until I run node run.mjs down.
```

## Quick start

You need:

- Node.js 20 or later. You don't install LiteLLM locally.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An OpenAI or Anthropic API key, or both. `verify.mjs` needs neither.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/litellm-tenki
npm install
```

### 2. Set your keys

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
export OPENAI_API_KEY=sk-...     # and/or ANTHROPIC_API_KEY
```

`run.mjs` reads keys from the environment only. `verify.mjs` also accepts a key saved with `tenki login --api-key <key>`. `TENKI_WORKSPACE_ID` is optional.

### 3. Run

```bash
node run.mjs
```

```text
proxy:   https://litellm--….us.sb.tenki.sh
sandbox: 01a1847d-…
models:  gpt-5-mini, claude-sonnet-4-5

export LITELLM_MASTER_KEY=sk-…   # save it; redeploys reuse it
```

It takes about 40 seconds: create the sandbox, `uv pip install 'litellm[proxy]==1.106.5'`, start the proxy, point the URL at it. Run `export LITELLM_MASTER_KEY=…` from the output. The proxy stays up after the script exits.

### 4. Verify

```bash
node verify.mjs
```

```text
  proxy: https://litellm-verify-50d931--….us.sb.tenki.sh (sticky=true)
✓ litellm-tenki: sticky proxy → named URL → health 200 → no/wrong key rejected → models [gpt-5-mini] → OpenAI saw the stored key (…89f8)
```

`verify.mjs` stores a fake OpenAI key as a workspace secret and deploys the proxy with it. It checks `/health/liveliness`, checks that `/v1/models` refuses a missing or wrong key and lists `gpt-5-mini` for the master key, then sends one chat request. OpenAI rejects the fake key with a 401 that shows its last four characters, which proves the stored value, not the `secrets://` reference, reached OpenAI. It deletes the URL, sandbox, policy, and secret either way.

## Use the proxy

```bash
export LITELLM_URL=https://litellm--….us.sb.tenki.sh   # the "proxy:" line

curl "$LITELLM_URL/v1/chat/completions" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" -H "content-type: application/json" \
  -d '{"model": "gpt-5-mini", "messages": [{"role": "user", "content": "Say hi"}]}'
```

Any OpenAI SDK works with the `/v1` base URL and the master key as the API key:

```python
from openai import OpenAI
import os

client = OpenAI(base_url=os.environ["LITELLM_URL"] + "/v1", api_key=os.environ["LITELLM_MASTER_KEY"])
print(client.chat.completions.create(model="claude-sonnet-4-5", messages=[{"role": "user", "content": "Say hi"}]).choices[0].message.content)
```

Claude Code talks to LiteLLM's Anthropic-format `/v1/messages` route:

```bash
ANTHROPIC_BASE_URL=$LITELLM_URL ANTHROPIC_AUTH_TOKEN=$LITELLM_MASTER_KEY \
  ANTHROPIC_MODEL=claude-sonnet-4-5 ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-sonnet-4-5 claude
```

To change the models, edit `PROVIDERS` in `proxy.mjs`. The `model_name` clients ask for is the part after the provider prefix (`openai/gpt-5-mini` → `gpt-5-mini`).

## How it works

`run.mjs` does four things, using helpers from `proxy.mjs`:

1. **Store the keys.** Each provider key you exported goes from your shell to the workspace secret store as `LITELLM_OPENAI_API_KEY` / `LITELLM_ANTHROPIC_API_KEY` (`workspace.secrets.create` or `.update`). The SDK can read back metadata only, never the value.
2. **Allow them out.** A request policy, `litellm-providers`, says where each secret may go:

   ```js
   await ws.secrets.policies.create("litellm-providers", [
     { origin: "https://api.openai.com", methods: ["GET", "POST"], pathPrefix: "/v1/", header: "Authorization", secrets: ["LITELLM_OPENAI_API_KEY"] },
     { origin: "https://api.anthropic.com", methods: ["GET", "POST"], pathPrefix: "/v1/", header: "x-api-key", secrets: ["LITELLM_ANTHROPIC_API_KEY"] },
   ]);
   ```

3. **Start the proxy.** The sandbox is created with `sticky: true` (it runs until terminated, with no lifetime cap) and `secretPolicies: ["litellm-providers"]`. LiteLLM starts with `OPENAI_API_KEY=secrets://LITELLM_OPENAI_API_KEY` in its environment, so it sends `Authorization: Bearer secrets://LITELLM_OPENAI_API_KEY`. Tenki's egress replaces the reference with the stored value when the request matches the policy. The image already trusts Tenki's egress CA (`SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`), so LiteLLM needs no TLS changes.
4. **Point the URL.** `tenki.previewUrls.create("litellm", { sessionId, port: 4000 })` creates a named preview URL. On a redeploy the slug exists, so `run.mjs` unbinds it, binds it to the new sandbox, and terminates the old one. Clients keep the same address. It only takes over a URL whose sandbox is named after the slug, so it won't hijack someone else's.

The proxy's master key is the only credential inside the sandbox. LiteLLM requires it on the API routes; the health checks and the API docs page at `/` are public.

## Redeploy and tear down

- **Redeploy** (new LiteLLM version, new models): `node run.mjs` again with the same `LITELLM_MASTER_KEY`. Provider keys you don't export keep their stored values. Export one to rotate it.
- **Second proxy:** `LITELLM_SLUG=litellm-staging node run.mjs`. The slug names the URL, the sandbox, and the policy (`<slug>-providers`).
- **Tear down:** `node run.mjs down` deletes the URL, terminates the sandbox, and deletes the policy and the `LITELLM_*` secrets.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY` | `run.mjs` reads only the environment. Export the key in this shell. |
| `set at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY` | No provider key in the environment and none stored yet. Export one. |
| `preview URL "litellm" is bound to sandbox …` | Something else in your workspace already uses that slug. Set `LITELLM_SLUG` to another name. |
| `uv venv … exited 1` | The package install failed in the sandbox. The error shows the end of its stderr; rerun `node run.mjs`. |
| `/v1/models` returns `500 Internal Server Error` or `400 No connected db.` | No `Authorization: Bearer $LITELLM_MASTER_KEY` header, or the wrong key. See Notes. |
| `401 Incorrect API key provided` from OpenAI, with the right key | The stored secret is stale. `export OPENAI_API_KEY=…` and run `node run.mjs` again. |
| `403 secret_injection_denied` in a provider error | The request carried a `secrets://` reference but its origin, method, or path matched no rule. Tenki refuses it rather than forward the reference. Add a rule in `upsertPolicy`. |
| Old sandboxes still running | A run was interrupted between creating the sandbox and binding the URL. Terminate them from [app.tenki.cloud](https://app.tenki.cloud). |

## Notes

- **The URL is public.** Tenki puts no login in front of a preview URL. The LiteLLM master key is the only thing that stops a stranger from spending your provider credit. Keep it secret, and rotate it by redeploying with a new `LITELLM_MASTER_KEY`.
- **LiteLLM returns 500 or 400, not 401, for a bad master key** when it runs without a database, as here. A missing key gives `500 Internal Server Error`, and a wrong key gives `400 No connected db.` (seen on 1.103.10, 1.104.8, 1.105.6, and 1.106.5). Either way, nothing is served. LiteLLM's virtual keys need a Postgres `database_url`, which this example doesn't set up.
- **What the policy protects, and what it doesn't.** Code in the sandbox can't read a provider key, and the key only goes to the listed origin and path. Code in the sandbox can still *use* the key by sending requests there. An upstream that echoes the `Authorization` header back would reveal it; OpenAI and Anthropic don't (OpenAI shows the last four characters).
- **Sticky means it runs, and bills, until you stop it.** `sticky: true` ignores `maxDurationMs`. Run `node run.mjs down` when you're done.
- **A redeploy has a short gap.** The URL is unbound from the old sandbox before it is bound to the new one, so requests during that moment fail.
- **Restart means redeploy.** The proxy is started with `setsid`, not a process supervisor. If it crashes, run `node run.mjs` again.

## Related

- [OpenCode](../opencode-sandbox/): a password-protected agent server on a preview URL
- [Expose a port](../expose-a-port/): preview URL basics
- [Tenki docs](https://tenki.cloud/docs)
- [LiteLLM proxy docs](https://docs.litellm.ai/docs/simple_proxy)
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox)
