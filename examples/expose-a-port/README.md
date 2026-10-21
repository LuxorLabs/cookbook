# Expose a port

Start an HTTP server inside a Tenki sandbox, expose its port with `sandbox.exposePort()`, and fetch the public HTTPS preview URL from your machine. Anyone with the URL can reach the server while it is exposed: a browser, a webhook, or another service.

## Quick start

You need:

- Node.js 24 or later for `run.mjs`, which uses top-level `await using`. `verify.mjs` runs on Node 20.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/expose-a-port
npm install
```

### 2. Set your API key

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
```

`run.mjs` reads the key from the environment only. `verify.mjs` also accepts a key saved with `tenki login --api-key <key>`. `TENKI_WORKSPACE_ID` is optional.

### 3. Run

```bash
node run.mjs
```

```text
preview URL: https://…
GET 200 -> Hello from a Tenki sandbox!
```

The URL stops working when the script exits, because `await using` terminates the sandbox.

### 4. Verify

```bash
node verify.mjs
```

```text
  preview URL: https://…
✓ expose-a-port: server → exposePort → host GET 200 → "Hello from Tenki 68n1b3"
```

`verify.mjs` writes a page with a random suffix, exposes port 8000, fetches the preview URL from your machine with retries, and checks for status `200` and that suffix. It terminates the sandbox either way.

## The code

```js
const PORT = 8000;
const BODY = "Hello from a Tenki sandbox!";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// allowInbound: true lets the Tenki gateway route public traffic to the sandbox port.
// (Outbound isn't needed here — the host does the fetching, not the sandbox.)
await using sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  allowInbound: true,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
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
console.log(`GET ${res.status} -> ${(await res.text()).trim()}`); // 200 -> Hello from a Tenki sandbox!
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
- The URL stops serving when you unexpose it, when `ttlMs` runs out, while the sandbox is paused, and when the sandbox ends. Tenki doesn't pause idle sandboxes, so pass `maxDurationMs` to `createAndWait` if a killed script could leave one running.

The server is public while exposed. This example adds no auth in front of it.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `run.mjs` reads only the environment. Export the key in this shell. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `SyntaxError` at `await using` | Use Node 24 or later, or run `verify.mjs`. |
| `InboundDisabledError` from `exposePort` | Create the sandbox with `allowInbound: true`. |
| `exec()` never returns after changing the server command | Background the server with `setsid … >log 2>&1 </dev/null &`. |
| `run.mjs` gets a non-200 status or `fetch` throws | The route wasn't ready yet. Run it again, or add the retry loop above. |

## Related

- [Tenki docs: port exposure and networking](https://tenki.cloud/docs/sandbox/sessions#port-exposure-and-networking)
- [MCP server](../mcp-tenki-sandbox/): includes a `tenki_create_preview_url` tool for servers an agent starts
- [Run a full-stack app](../agent-fullstack-app/): an API, frontend, and database behind one preview URL
- [Pause, snapshot, and resume](../snapshots-pause-resume/)
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox)
