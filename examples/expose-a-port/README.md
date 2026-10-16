# How to get a public preview URL for a server in a Tenki sandbox

**Audience:** Node.js developers who want to show a server that runs inside a Tenki sandbox at a public HTTPS URL: a dev-server preview, a running app you want to share, or an agent showing its work.
**Time:** ~2 minutes once you have an API key. In CI, `npm install` and `node verify.mjs` finish in about 6 seconds together.
**Outcome:** `node run.mjs` boots a sandbox, starts a Python HTTP server in it, prints the server's `previewUrl`, fetches that URL from your machine, and prints `GET 200 -> Hello from a Tenki sandbox!`. `node verify.mjs` prints a `✓` line.

> **Honesty note:** `run.mjs` uses top-level `await using`, which needs Node 24 or newer. Node 22 can't parse it. `verify.mjs` does the same work with `try`/`finally` and runs on Node 20, which is what CI uses.

## Why bother

`sandbox.exposePort()` maps a port inside a disposable Tenki sandbox at the Tenki gateway and returns a public HTTPS preview URL. Anyone with that URL can reach the server inside the sandbox's microVM: your machine, a browser, or a webhook. The whole flow is one short script built on the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK.

## Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/expose-a-port
npm install
```

Every later command runs from this directory.

`package.json` installs one dependency, `@tenkicloud/sandbox` 1.4.1 or later. You need Node 24+ for `run.mjs` and Node 20+ for `verify.mjs`.

## Authenticate

The SDK needs a Tenki `tk_` API key. Create one at https://app.tenki.cloud, then export it:

```bash
export TENKI_AUTH_TOKEN=tk_...
```

`run.mjs` passes `process.env.TENKI_AUTH_TOKEN` to `new TenkiSandbox()`. If that's unset, the SDK falls back to `TENKI_API_KEY`, which is the only variable CI sets. `run.mjs` doesn't read the key that `tenki login --api-key <key>` stores in `~/.config/tenki/config.yaml`; `verify.mjs` does.

With a workspace API key you don't need `TENKI_WORKSPACE_ID`, because Tenki infers the workspace from the key. Both scripts pass `TENKI_WORKSPACE_ID` to `createAndWait` if you set it.

## Use it

This is the whole of `run.mjs`:

```js
// Expose a port from a Tenki sandbox and get a public preview URL.
// Start a tiny HTTP server in the sandbox, expose its port, fetch the URL from the host.
import { TenkiSandbox } from "@tenkicloud/sandbox";

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

Run it:

```bash
node run.mjs
```

It prints two lines:

```text
preview URL: https://…
GET 200 -> Hello from a Tenki sandbox!
```

The first line is the URL Tenki returned. The second is your machine fetching it. The URL stops working once `run.mjs` exits; the next section explains why.

## How the preview URL is made

1. The sandbox accepts inbound traffic. `allowInbound: true` lets the Tenki gateway route public traffic to the sandbox port. In SDK 1.4.1 inbound is on by default, so the option makes the default explicit. It's a create-time setting: a sandbox created with `allowInbound: false` rejects `exposePort` with `InboundDisabledError`, and you can't turn inbound on afterwards. Outbound access isn't used here: your machine does the fetching, and the sandbox only listens.
2. The server outlives the `exec()` call. `exec()` blocks until its command exits, so a foreground `python3 -m http.server` would never return. The command backgrounds the server with `setsid … >/tmp/server.log 2>&1 </dev/null &` so it keeps running after `exec()` returns, and `sleep 1` gives it a second to start before the port is exposed.
3. `sandbox.exposePort(port, { ttlMs?, slug? })` maps the sandbox port at the Tenki gateway and returns an [`ExposedPort`](https://www.npmjs.com/package/@tenkicloud/sandbox). Its fields are `port`, `previewUrl`, and the optional `expiresAt`, `previewUrlId`, `slug`, `wildcard`, `wildcardStatus` and `wildcardStatusReason`. `previewUrl` is a real public HTTPS endpoint. Use it as returned: Tenki's docs say the host pattern is not a stable contract, so don't build hostnames yourself.
4. Your machine fetches the URL with a plain `fetch(previewUrl)`, the same way a browser would.

The first requests may need a moment while the server and the gateway route warm up. `run.mjs` fetches once. `verify.mjs` retries up to 15 times, 2 seconds apart, and this is the loop to copy if your server takes a while to start:

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

To manage the mapping:

- Pass `ttlMs` to make the mapping expire on its own. Without it, the SDK sends no expiry with the request.
- Pass a `slug` (`exposePort(PORT, { slug: "my-app" })`) to ask for a named exposure instead of a generated hostname. See the FAQ for when that hostname stays the same across sessions.
- `sandbox.unexposePort(port)` tears the mapping down, and `sandbox.listExposedPorts()` lists what's live.
- `await using` disposes the sandbox, and its preview URL with it, when the scope ends: the `Session` that `createAndWait` returns is an `AsyncDisposable`, and disposing it terminates the sandbox. That's why the URL from `run.mjs` stops working once the script exits.

The site lives in `/home/tenki`, the sandbox's working directory. The SDK's own file methods (`writeFile`, `readFile`) are confined to it. Shell commands run with `exec` can write anywhere, which is why the server command can send its log to `/tmp/server.log`.

## Check it works

```bash
node verify.mjs
```

When it passes, it prints the URL and a `✓` line. The last six characters of the body are random on each run:

```text
  preview URL: https://…
✓ expose-a-port: server → exposePort → host GET 200 → "Hello from Tenki 68n1b3"
```

`verify.mjs` boots a sandbox with inbound enabled, starts the HTTP server, exposes port 8000, fetches the preview URL from your machine, and checks for status `200` and a body containing the random string it wrote in this run. On failure it prints a `✗` line with the reason and exits non-zero. It terminates the sandbox either way. It reads the key from `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY`, then the `auth_token` in `~/.config/tenki/config.yaml`. It takes the workspace from `TENKI_WORKSPACE_ID`, or from `current_workspace_id` in that file if one is there. CI runs it on Node 20 with only `TENKI_API_KEY`.

A pass proves your key can boot a sandbox with inbound enabled and that the gateway serves the exposed port at a public HTTPS URL your machine can reach. It doesn't run `run.mjs`, and it doesn't exercise `slug`, `ttlMs`, `unexposePort` or `listExposedPorts`.

## Troubleshooting

- ❌ **``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export a `tk_` key, or run `tenki login --api-key <key>`.
- ❌ **`missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option` from `node run.mjs`.** Neither variable is set in this shell, and `run.mjs` doesn't read `~/.config/tenki/config.yaml`, so `tenki login` alone isn't enough here. Export the key in the shell you run it from.
- ❌ **`invalid auth token - API keys and service tokens must start with tk_`.** SDK 1.x accepts only `tk_` API keys. Create one at https://app.tenki.cloud.
- ❌ **`node run.mjs` fails with a `SyntaxError` at `await using`.** Your Node is older than 24 and can't parse top-level `await using`. Upgrade to Node 24, or run `node verify.mjs`, which uses `try`/`finally`.
- ❌ **`exposePort` throws `InboundDisabledError`.** The sandbox was created with `allowInbound: false`, and inbound can't be enabled on an existing sandbox. Create a new sandbox with `allowInbound: true` (the default), as `run.mjs` does.
- ❌ **`exec()` doesn't return after you change the server command.** The server is running in the foreground, or still holds `exec`'s output open. Background it with `setsid … >log 2>&1 </dev/null &`, as `run.mjs` does.
- ❌ **`run.mjs` prints a `GET` line with a status other than `200`, or `fetch` throws.** The request arrived before the server and the gateway route were ready, and `run.mjs` doesn't retry. Run it again, or add the retry loop from `verify.mjs` shown above.

## FAQ

**When shouldn't I use this?** When the server shouldn't be public: anyone with the URL can reach it while it's exposed, and this example doesn't add any auth in front of it. When you need a URL that outlives the sandbox. When you need the same hostname every session on a workspace without a reserved preview slug: by default each session gets a generated hostname (see the next question).

**Can I get the same URL every time?** Pass a `slug` to ask for a named exposure. Per Tenki's docs, named exposures stay stable from one session to the next when they're served under a preview slug reserved for your workspace, which is a Team-plan feature you set up in your workspace Settings. Starter workspaces get generated per-session hostnames instead. If the returned `wildcard` is `true`, the URL doesn't serve traffic until `wildcardStatus` is `READY`; read `wildcardStatusReason` when it's `FAILED`.

**How long does the URL stay up?** It stops working when you call `unexposePort`, when the `ttlMs` you passed runs out, or when the sandbox ends, and it serves no traffic while the sandbox is paused. Both scripts end the sandbox when they finish or throw. If the process is killed before that, the sandbox keeps running, because Tenki doesn't pause idle sandboxes. Pass `maxDurationMs` to `createAndWait` to cap the sandbox's lifetime.

## Related

- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox), the SDK this example uses.
- [Tenki docs: port exposure and networking](https://tenki.cloud/docs/sandbox/sessions#port-exposure-and-networking), including named exposures and the workspace preview slug.
- [Tenki docs](https://tenki.cloud/docs). Built on [Tenki](https://tenki.cloud) sandboxes.
- [`../mcp-tenki-sandbox/`](../mcp-tenki-sandbox/): give an MCP client such as Claude or Cursor a Tenki sandbox, including a `tenki_create_preview_url` tool for servers the agent starts.
- [`../snapshots-pause-resume/`](../snapshots-pause-resume/): pause and resume a sandbox. A paused sandbox serves no preview traffic until it's `RUNNING` again.
