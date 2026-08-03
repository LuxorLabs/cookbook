# Expose a port / preview URL

Run a web server inside a disposable Tenki sandbox, expose its port, and get a public HTTPS **preview URL** you can hit from anywhere — in ~20 lines with the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK.

Great for previewing a dev server, sharing a running app, or letting an agent show its work.

## The code (`run.mjs`)

```js
import { TenkiSandbox } from "@tenkicloud/sandbox";

const PORT = 8000;
const BODY = "Hello from a Tenki sandbox!";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// allowInbound: true lets the Tenki gateway route public traffic to the sandbox port.
await using sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  allowInbound: true,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

// Write a one-file site, then start a detached HTTP server.
// setsid + redirected stdio keeps it running after this exec() returns.
await sandbox.exec("sh", {
  args: ["-c",
    `printf '%s' '${BODY}' > /home/tenki/index.html; cd /home/tenki; ` +
    `setsid python3 -m http.server ${PORT} >/tmp/server.log 2>&1 </dev/null & sleep 1`],
});

// Map the sandbox port at the gateway -> a public HTTPS preview URL.
const { previewUrl } = await sandbox.exposePort(PORT);
console.log(`preview URL: ${previewUrl}`);       // https://<slug>.<region>.sb.tenki.sh

// Fetch it from the host, just like a browser would.
const res = await fetch(previewUrl);
console.log(`GET ${res.status} -> ${(await res.text()).trim()}`); // 200 -> Hello from a Tenki sandbox!
```

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=...      # from `tenki login` (~/.config/tenki/config.yaml)
export TENKI_WORKSPACE_ID=...
node run.mjs                     # preview URL: https://…  /  GET 200 -> Hello from a Tenki sandbox!
```

Or just prove it end-to-end against live Tenki:

```bash
node verify.mjs   # server -> exposePort -> host GET 200 -> "Hello from Tenki …"
```

## How it works

1. **`allowInbound: true`** on `createAndWait` tells Tenki to accept inbound traffic for this sandbox. Omit it and `exposePort` throws `InboundDisabledError`. *Outbound* isn't needed here — the **host** fetches the URL, the sandbox only listens.
2. **`sandbox.exposePort(port, { ttlMs?, slug? })`** maps a guest port at the Tenki gateway and returns an [`ExposedPort`](https://www.npmjs.com/package/@tenkicloud/sandbox): `{ port, previewUrl, expiresAt?, previewUrlId?, slug? }`. The `previewUrl` is a real public HTTPS endpoint.
3. Anyone (your host, a browser, a webhook) can now `GET` that URL and reach the server inside the microVM.
4. `sandbox.unexposePort(port)` tears the mapping down; `sandbox.listExposedPorts()` lists what's live.

## Notes

- **The server must be running when the URL is hit.** `exec()` blocks until its command exits, so a foreground `python3 -m http.server` would never return. Background it with `setsid … >log 2>&1 </dev/null &` (as above) so it outlives the `exec()` call, then expose the port.
- **First requests may need a beat.** The server and the gateway route take a moment to warm up — retry the fetch a few times (see `verify.mjs`).
- **Pass a `slug`** (`exposePort(PORT, { slug: "my-app" })`) for a stable, readable hostname, or **`ttlMs`** to auto-expire the mapping.
- `await using` disposes the sandbox — and its preview URL — when the scope ends (`Session` is an `AsyncDisposable`). Requires Node 20+.
- Tenki confines file I/O to `/home/tenki` — the site is written there.

Built on [Tenki](https://tenki.cloud) sandboxes.
