# Expose a port

Start an HTTP server inside a Luxor sandbox, expose its port with `sandbox.exposePort()`, and fetch the public HTTPS preview URL from your machine. Anyone with the URL can reach the server while it is exposed: a browser, a webhook, or another service.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Luxor Agent Cloud "Expose a port" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo and cd into examples/expose-a-port.
2. Check that Node.js is 24 or later, then run npm install.
3. The scripts need a Luxor Agent Cloud API key (starts with tk_) in LUXORAI_AUTH_TOKEN. If it isn't set, stop and ask me to export it (keys come from https://app.luxor.ai). Never print the key or write it to a file.
4. Run node run.mjs and confirm it prints a preview URL and "GET 200 -> Hello from a Luxor sandbox!", then run node verify.mjs.
5. If a step fails, use the Troubleshooting table in the example's README.md.
Then show me how to serve my own app from the sandbox on a preview URL.
```

## Quick start

You need:

- Node.js 24 or later for `run.mjs`, which uses top-level `await using`. `verify.mjs` runs on Node 20.
- A Luxor Agent Cloud API key (`tk_...`) from [app.luxor.ai](https://app.luxor.ai).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/expose-a-port
npm install
```

### 2. Set your API key

```bash
export LUXORAI_AUTH_TOKEN=tk_...   # LUXORAI_API_KEY also works
```

`run.mjs` reads the key from the environment only. `verify.mjs` also accepts a key saved with `luxor login --api-key <key>`. `LUXORAI_WORKSPACE_ID` is optional.

### 3. Run

```bash
node run.mjs
```

```text
preview URL: https://…
GET 200 -> Hello from a Luxor sandbox!
```

The URL stops working when the script exits, because `await using` terminates the sandbox.

### 4. Verify

```bash
node verify.mjs
```

```text
  preview URL: https://…
✓ expose-a-port: server → exposePort → host GET 200 → "Hello from Luxor Agent Cloud 68n1b3"
```

`verify.mjs` writes a page with a random suffix, exposes port 8000, fetches the preview URL from your machine with retries, and checks for status `200` and that suffix. It terminates the sandbox either way.

## The code

```js
const PORT = 8000;
const BODY = "Hello from a Luxor sandbox!";

const luxor = new LuxorSandbox({ authToken: process.env.LUXORAI_AUTH_TOKEN || process.env.TENKI_AUTH_TOKEN });

// allowInbound: true lets the Luxor Agent Cloud gateway route public traffic to the sandbox port.
// (Outbound isn't needed here — the host does the fetching, not the sandbox.)
await using sandbox = await luxor.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  allowInbound: true,
  workspaceId: process.env.LUXORAI_WORKSPACE_ID || process.env.TENKI_WORKSPACE_ID,
});

// Write a one-file site, then start a detached HTTP server.
// setsid + redirected stdio keeps it running after this exec() returns.
await sandbox.exec("sh", {
  args: [
    "-c",
    `printf '%s' '${BODY}' > /home/tenki/index.html; cd /home/tenki; ` +
      `setsid python3 -m http.server ${PORT} >/tmp/server.log 2>&1 </dev/null & sleep 1`,
  ],
});

// Map the sandbox port at the gateway -> a public HTTPS preview URL.
const { previewUrl } = await sandbox.exposePort(PORT);
console.log(`preview URL: ${previewUrl}`);

// Fetch it from the host (the public internet), just like a browser would.
const res = await fetch(previewUrl);
console.log(`GET ${res.status} -> ${(await res.text()).trim()}`); // 200 -> Hello from a Luxor sandbox!
```

## How it works

- **Inbound is a create-time setting.** `allowInbound` is on by default in SDK 1.4.1; `run.mjs` sets it explicitly. A sandbox created with `allowInbound: false` rejects `exposePort` with `InboundDisabledError`, and inbound cannot be turned on later.
- **Background the server.** `exec()` waits for its command to exit, so start long-running servers with `setsid … >log 2>&1 </dev/null &`.
- **Use `previewUrl` as returned.** `exposePort(port, { ttlMs?, slug? })` returns `{ port, previewUrl, expiresAt?, previewUrlId?, slug?, wildcard?, wildcardStatus?, wildcardStatusReason? }`. The hostname pattern is not a stable contract, so don't build URLs yourself.
- **Retry the first fetch.** The server and gateway route can take a moment to warm up. `run.mjs` fetches once; `verify.mjs` retries up to 15 times, 2 seconds apart:

```js
  // Fetch from the host; retry while the server + gateway warm up.
  let status, text;
  for (let i = 0; i < 15; i++) {
    try {
      const res = await fetch(previewUrl, { redirect: "follow" });
      ({ status } = res);
      text = await res.text();
      if (status === 200 && text.includes(BODY)) break;
    } catch { /* gateway warming up */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
```

## Managing the URL

- `ttlMs` makes the mapping expire on its own. Without it, no expiry is set.
- `slug` (`exposePort(PORT, { slug: "my-app" })`) asks for a named exposure. Named exposures keep the same hostname across sessions when served under a preview slug reserved for your workspace (a Team-plan feature in workspace Settings). Starter workspaces get a generated hostname per session. If `wildcard` is `true`, wait for `wildcardStatus` to be `READY`, and read `wildcardStatusReason` if it is `FAILED`.
- `sandbox.unexposePort(port)` removes a mapping, and `sandbox.listExposedPorts()` lists the live ones.
- The URL stops serving when you unexpose it, when `ttlMs` runs out, while the sandbox is paused, and when the sandbox ends. Luxor Agent Cloud doesn't pause idle sandboxes, so pass `maxDurationMs` to `createAndWait` if a killed script could leave one running.

The server is public while exposed. This example adds no auth in front of it.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set LUXORAI_AUTH_TOKEN, or run `luxor login`.`` | `verify.mjs` found no key. Export one or run `luxor login --api-key <key>`. |
| `missing auth token - set LUXORAI_AUTH_TOKEN or LUXORAI_API_KEY ...` | `run.mjs` reads only the environment. Export the key in this shell. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.luxor.ai](https://app.luxor.ai). |
| `SyntaxError` at `await using` | Use Node 24 or later, or run `verify.mjs`. |
| `InboundDisabledError` from `exposePort` | Create the sandbox with `allowInbound: true`. |
| `exec()` never returns after changing the server command | Background the server with `setsid … >log 2>&1 </dev/null &`. |
| `run.mjs` gets a non-200 status or `fetch` throws | The route wasn't ready yet. Run it again, or add the retry loop above. |

## Related

- [Luxor Agent Cloud docs: port exposure and networking](https://luxor.ai/docs/sandbox/sessions#port-exposure-and-networking)
- [MCP server](../mcp-luxor-sandbox/): includes a `tenki_create_preview_url` tool for servers an agent starts
- [Run a full-stack app](../agent-fullstack-app/): an API, frontend, and database behind one preview URL
- [Pause, snapshot, and resume](../snapshots-pause-resume/)
- [`@luxorai/sandbox` on npm](https://www.npmjs.com/package/@luxorai/sandbox)
