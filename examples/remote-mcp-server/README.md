# Remote MCP server

Host your own [MCP](https://modelcontextprotocol.io) server in a [Tenki sandbox](https://tenki.cloud/products/sandbox) and connect to it from Claude Code, the MCP Inspector, or any client that speaks Streamable HTTP. The server runs in a sticky sandbox, which stays up until you stop it, behind a named preview URL that keeps its address when you redeploy. Preview URLs are public, so the server checks a bearer token on every MCP request.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "Remote MCP server" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/remote-mcp-server, and run npm install (Node.js 20 or later).
2. The scripts need a Tenki API key (starts with tk_) in TENKI_AUTH_TOKEN. If it isn't set, stop and ask me to export it (keys come from https://app.tenki.cloud). Never print the key or write it to a file.
3. Run node verify.mjs and confirm the ✓ line.
4. Run node deploy.mjs and give me the MCP endpoint, the export MCP_TOKEN line, and the claude mcp add command it prints.
5. If a step fails, use the Troubleshooting table in the example's README.md.
Remind me the sandbox runs (and bills) until I run node deploy.mjs down.
```

## Quick start

You need:

- Node.js 20 or later.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/remote-mcp-server
npm install
```

### 2. Set your API key

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
```

`deploy.mjs` reads the key from the environment only. `verify.mjs` also accepts a key saved with `tenki login --api-key <key>`. `TENKI_WORKSPACE_ID` is optional.

### 3. Deploy

```bash
node deploy.mjs
```

```text
MCP endpoint: https://<preview-host>/mcp (sandbox 01a1…)
export MCP_TOKEN=<64 hex characters>
claude mcp add --transport http tenki-remote https://<preview-host>/mcp --header "Authorization: Bearer $MCP_TOKEN"
The sandbox runs until you stop it: node deploy.mjs down
```

Run the `export` line, then the `claude mcp add` line to give Claude Code the `echo` and `current_time` tools. To check the server from a terminal with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector@2.12.0 --cli https://<preview-host>/mcp \
  --header "Authorization: Bearer $MCP_TOKEN" --method tools/call --tool-name echo --tool-arg text=hello
```

The script exits once the server answers; the sandbox keeps running. Stop it with:

```bash
node deploy.mjs down   # deletes the preview URL, then terminates the sandbox
```

### 4. Verify

```bash
node verify.mjs
```

```text
  MCP endpoint: https://<preview-host>/mcp
✓ remote-mcp-server: sticky sandbox → named URL → /health 200 → /mcp 401 without token → tools [current_time,echo] → echo "mcp-verify-f6d41d"
```

`verify.mjs` deploys with a random slug and token, checks `/health`, checks that `/mcp` returns `401` with no token and with a wrong one, then lists the tools and calls `echo` with the MCP SDK's `StreamableHTTPClientTransport`. It deletes the URL and the sandbox either way.

## How it works

`server/server.mjs` runs inside the sandbox. It is plain Node.js on the official [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk):

- **`/mcp`** serves Streamable HTTP in stateless mode: a new `McpServer` and `StreamableHTTPServerTransport` per POST, so there are no session IDs to track. Other methods get `405`.
- **The token** arrives as `MCP_TOKEN` in the `exec` environment. The server hashes it, deletes it from `process.env`, and compares the SHA-256 of each request's `Authorization: Bearer` value with `crypto.timingSafeEqual`. A missing or wrong token gets `401`. The token is never logged.
- **`/health`** answers `200` without a token, so you can monitor the URL.

`deploy.mjs` does the Tenki side:

- **`sticky: true`** on `createAndWait` keeps the sandbox running until it is terminated. Sticky sandboxes ignore `maxDurationMs`.
- It writes `server/` into the sandbox, runs `npm install`, and starts the server with `setsid … &` so it outlives the `exec` call.
- **`tenki.previewUrls.create(slug, { sessionId, port })`** creates a named URL whose hostname starts with the slug. Use `previewUrl` as returned rather than building it. The slug is unique per workspace. Set `MCP_SLUG` to use another one (default `remote-mcp`).
- **Redeploying keeps the URL.** If the slug exists, `deploy.mjs` builds a new sandbox, calls `previewUrls.unbind` then `previewUrls.bind` to move the URL to it (bind fails on a URL that is still bound), waits for `/health`, and terminates the old sandbox. It names each sandbox after the slug and won't move or delete a URL bound to a sandbox with another name. Export `MCP_TOKEN` before redeploying so clients keep working; otherwise a new token is generated.

To add your own tools, call `server.registerTool(...)` in `buildServer()` and run `node deploy.mjs` again.

## Host tenki-mcp the same way

[`tenki-mcp`](https://github.com/LuxorLabs/tenki-mcp), Tenki's own MCP server, has a Streamable HTTP mode (its README labels it v2.0-beta; it ships in `@tenkicloud/mcp` 0.3.1 on npm). Behind a preview URL, start it like this:

```bash
TENKI_MCP_TRANSPORT=http TENKI_MCP_HTTP_HOST=0.0.0.0 PORT=3000 \
  TENKI_MCP_HTTP_TOKEN=<random token> \
  TENKI_MCP_ALLOWED_HOSTS=<preview-host> \
  TENKI_API_KEY=tk_... npx -y @tenkicloud/mcp@0.3.1
```

It refuses to bind `0.0.0.0` without `TENKI_MCP_HTTP_TOKEN`. Without `TENKI_MCP_ALLOWED_HOSTS`, its DNS-rebinding check rejects the preview hostname with `403 Invalid Host header`. A named preview URL knows its hostname before the server starts, which makes that setting easy to fill in. That server holds a Tenki API key and can create sandboxes and spend credits, so treat its token like the key.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `deploy.mjs` reads only the environment. Export the key in this shell. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `npm install failed: ...` | The sandbox couldn't reach the npm registry. Keep outbound network on (the default). |
| `.../health never answered; see /tmp/mcp.log in the sandbox` | The server crashed on start. The new sandbox was terminated; rerun, or start it by hand and read the log. |
| `<slug> is bound to sandbox <id>; set MCP_SLUG` | Something else in your workspace uses that slug. Pick another with `MCP_SLUG`. |
| Claude Code or the Inspector gets `401` | The header must be `Authorization: Bearer <token>` with the token from the current deploy. |
| The URL returns `404` | The sandbox was terminated. Terminating a sandbox also deletes the preview URLs bound to it. Run `node deploy.mjs` again. |

## Notes

- A sticky sandbox bills until you run `node deploy.mjs down` (or `tenki sandbox preview-url rm <id>` and `tenki sandbox rm <session>` with the [Tenki CLI](https://tenki.cloud/docs/sandbox/cli)).
- During a redeploy the URL is unbound for a few seconds between `unbind` and `bind`.
- The token is the only thing between the internet and your tools. Rotate it by exporting a new `MCP_TOKEN` and redeploying.

## Related

- [Expose a port](../expose-a-port/): preview URLs on their own
- [MCP server](../mcp-tenki-sandbox/): sandbox tools for an MCP client over stdio
- [OpenCode](../opencode-sandbox/): another server behind a password on a preview URL
- [Tenki docs](https://tenki.cloud/docs) and the [MCP Streamable HTTP spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http)
