# Anchor Browser

Drive an [Anchor Browser](https://anchorbrowser.io) session from a Tenki sandbox. Anchor runs Chromium on its side and hands your code a Chrome DevTools Protocol (CDP) URL. The sandbox boots Tenki's `tenki/anchor:stable` image, which ships `playwright-core`, opens an Anchor session, loads a page over CDP, and prints its URL and title.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Run the Anchor Browser on Tenki example, following https://github.com/LuxorLabs/cookbook/tree/main/examples/anchor-browser-tenki.
1. Clone https://github.com/LuxorLabs/cookbook, cd into examples/anchor-browser-tenki, check that Node.js is 24 or later, and run npm install.
2. It needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) and ANCHOR_API_KEY (from https://app.anchorbrowser.io/api-keys) exported in the shell. If either isn't set, stop and ask me to export it. Never print a key or write it to a file.
3. Run node run.mjs and confirm it prints the Example Domain title, then run node verify.mjs and confirm the ✓ line.
4. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- Node.js 24 or later. `run.mjs` uses top-level `await using`. `verify.mjs` runs on Node 20.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An Anchor API key from [app.anchorbrowser.io/api-keys](https://app.anchorbrowser.io/api-keys).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/anchor-browser-tenki
npm install
```

This installs `@tenkicloud/sandbox` (`>=1.4.1`) only. `playwright-core` comes from the image.

### 2. Set your API keys

```bash
export TENKI_API_KEY=tk_...   # TENKI_AUTH_TOKEN also works
export ANCHOR_API_KEY=...
```

`run.mjs` reads both from the environment only. `verify.mjs` also accepts a key saved with `tenki login --api-key <key>`.

### 3. Run

```bash
node run.mjs
```

```text
{"url":"https://example.com/","title":"Example Domain"}
```

To load another page, change the URL `run.mjs` passes to `node anchor.mjs`.

### 4. Verify

```bash
node verify.mjs
```

```text
✓ anchor-browser-tenki: boot tenki/anchor:stable → anchor-smoke on PATH → playwright-core <version> → no key in session env → Anchor session over CDP (Example Domain), key scoped to one process → dispose
```

`verify.mjs` boots the image, checks `anchor-smoke` and `playwright-core`, and checks the session environment has no `ANCHOR_API_KEY`. With `ANCHOR_API_KEY` set, it also runs `anchor.mjs`, asserts the title, and checks that a later process can't see the key. Without the key it skips that part and says `ANCHOR_API_KEY unset, live Anchor leg skipped`, which is what CI runs.

## The code

[`run.mjs`](run.mjs) runs on your machine:

```js
// Boot Tenki's tenki/anchor image, upload anchor.mjs, and run it with the Anchor key in that one process.
import { TenkiSandbox, stdoutText, stderrText } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";

const anchorKey = process.env.ANCHOR_API_KEY;
if (!anchorKey) throw new Error("Set ANCHOR_API_KEY");

const tenki = new TenkiSandbox(); // reads TENKI_API_KEY or TENKI_AUTH_TOKEN

// tenki/anchor:stable is the base image plus playwright-core and anchor-smoke: no browser, no key.
// No cpuCores / memoryMb: the image restores from a snapshot at its own size (2 vCPU, 4 GiB), and a
// smaller request is refused. maxDurationMs is a hard cap: Tenki ends the sandbox after 10 minutes even if this script dies.
await using sandbox = await tenki.createAndWait({
  image: "tenki/anchor:stable",
  maxDurationMs: 10 * 60_000,
});

await sandbox.writeFile("anchor.mjs", readFileSync(new URL("./anchor.mjs", import.meta.url)));

// The key goes into this one process's environment, not the session's.
const result = await sandbox.exec("node", {
  args: ["anchor.mjs", "https://example.com"],
  env: { ANCHOR_API_KEY: anchorKey },
  timeoutMs: 3 * 60_000,
});
if (result.status !== "SUCCEEDED") throw new Error(`${result.status}: ${stderrText(result)}`);
console.log(stdoutText(result).trim());
```

[`anchor.mjs`](anchor.mjs) runs inside the sandbox:

```js
// Runs inside the sandbox. Anchor runs the browser; this VM runs the Playwright client.
import { chromium } from "playwright-core"; // preinstalled in tenki/anchor under /home/tenki/node_modules

const apiKey = process.env.ANCHOR_API_KEY;
if (!apiKey) throw new Error("ANCHOR_API_KEY is required");
const url = process.argv[2] ?? "https://example.com";
const sessions = "https://api.anchorbrowser.io/v1/sessions";

// Set Anchor's two timers (in minutes) instead of relying on defaults: max_duration caps the
// session's lifetime, idle_timeout ends it once nothing has been connected to it for that long.
const response = await fetch(sessions, {
  method: "POST",
  headers: { "anchor-api-key": apiKey, "content-type": "application/json" },
  body: JSON.stringify({ session: { timeout: { max_duration: 5, idle_timeout: 1 } } }),
});
if (!response.ok) throw new Error(`Anchor returned HTTP ${response.status}: ${await response.text()}`);
const payload = await response.json();
const session = payload.data ?? payload;

let browser;
try {
  browser = await chromium.connectOverCDP(session.cdp_url);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url);
  console.log(JSON.stringify({ url: page.url(), title: await page.title() }));
} finally {
  // End the Anchor session even if closing the CDP connection throws.
  try {
    await browser?.close();
  } finally {
    const ended = await fetch(`${sessions}/${session.id}`, {
      method: "DELETE",
      headers: { "anchor-api-key": apiKey },
    });
    if (!ended.ok) throw new Error(`Anchor session ${session.id} not ended: HTTP ${ended.status}`);
  }
}
```

- `writeFile` puts `anchor.mjs` in `/home/tenki`, where the image's `playwright-core` resolves.
- The Anchor key goes into the `env` of that one `exec` call, not the session's environment or any file. It is still visible inside the VM while `anchor.mjs` runs.

## Two lifetimes, two caps

| | Ends normally when | Cap if cleanup never runs |
| --- | --- | --- |
| Tenki sandbox | `await using` disposes it as `run.mjs` exits | `maxDurationMs`: 10 minutes |
| Anchor session | `anchor.mjs` sends `DELETE /v1/sessions/{id}` in `finally` | `idle_timeout: 1` (1 minute after the last connection closes), `max_duration: 5` (5 minutes) |

Anchor's timeouts are in minutes, and its docs disagree on the default `max_duration`, so the example sets both. Raise `max_duration` for long tasks and keep `maxDurationMs` above it.

## Anchor's session options

The request body in `anchor.mjs` is where Anchor's options go. With only the timeouts set, none of them is on. See [Anchor's docs](https://docs.anchorbrowser.io/) for plans and details:

- `session.proxy` (`{ active: true, country_code: "gb" }`) routes through Anchor's proxy.
- `browser.extra_stealth` needs the Growth plan and an active proxy.
- `browser.captcha_solver` needs an active proxy or a browser profile.
- `browser.profile` (`{ name, persist: true }`) saves cookies and storage for reuse.
- `identities` attaches stored credentials so Anchor logs in first.

## Things to know

- The browser runs at Anchor, so it can't reach a dev server on the sandbox's `localhost`. For that, run [Chrome inside the sandbox](https://tenki.cloud/docs/sandbox/chrome).
- `stable` moves with each build. To pin one, run `tenki sandbox registry resolve tenki/anchor:stable` and pass `image: "tenki/anchor@<snapshot-id>"`.
- Anchor also publishes an [`anchorbrowser`](https://www.npmjs.com/package/anchorbrowser) SDK. This example calls the REST API with `fetch`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Set ANCHOR_API_KEY` | Export a key from [app.anchorbrowser.io/api-keys](https://app.anchorbrowser.io/api-keys). |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY …` from `run.mjs` | `run.mjs` doesn't read `tenki login`. Export your `tk_` key. |
| ``No token. Set TENKI_API_KEY, or run `tenki login`.`` | `verify.mjs` found no Tenki key. Export one or run `tenki login --api-key <key>`. |
| `SyntaxError` at `await using` | Use Node 24, or run `node verify.mjs` with `ANCHOR_API_KEY` set. |
| `Anchor returned HTTP 401: {"error":"Invalid API Key"}` | Check `ANCHOR_API_KEY` in this shell. |
| `Anchor returned HTTP 429: …` | Anchor's session rate limit. Wait and retry, or check your plan. |
| `Cannot find package 'playwright-core'` | Keep the `writeFile` path relative and the `image` option as written. |
| `✗ playwright-core import probe failed` | The image changed. Pin a build as above. |
| `Anchor session <id> not ended: HTTP <status>` | The session still ends within 1 to 5 minutes. |
| `TIMED_OUT: …` | Raise the `exec` call's `timeoutMs` in `run.mjs`. |

## Related

- [Anchor on Tenki](https://tenki.cloud/docs/sandbox/anchor) in the Tenki docs, including the `anchor-smoke` CLI path
- [Anchor Browser docs](https://docs.anchorbrowser.io/)
- [TinyFish](../tinyfish-tenki/): the same remote-browser-over-CDP shape
- [Run code in a sandbox](../run-code-in-a-sandbox/)
