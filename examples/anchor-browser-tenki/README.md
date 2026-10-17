# How to drive an Anchor Browser session from a Tenki sandbox

**Audience:** JavaScript developers who want their agent code in a Tenki microVM and the browser it drives at [Anchor Browser](https://anchorbrowser.io/).
**Time:** ~5 minutes.
**Outcome:** `node run.mjs` boots a Tenki microVM from the public `tenki/anchor:stable` image, opens an Anchor browser session from inside it, loads a page over the Chrome DevTools Protocol (CDP) and prints its URL and title. `node verify.mjs` prints a `✓` line.

> **Tested on 2026-10-17 against live Tenki and Anchor.** `node verify.mjs` and `node run.mjs` (Node 24) both passed: the `tenki/anchor:stable` image boots, `anchor.mjs` opens an Anchor session from inside it, loads example.com over CDP and ends the session, and the Anchor key never reaches the session environment.

> **Honesty note:** The browser doesn't run in your sandbox. It runs at Anchor, and the sandbox drives it over the public internet. It can't reach a dev server on `localhost` inside your VM, and every Playwright action is a round trip to Anchor.

## Why bother

Anchor runs Chromium on its side and hands your code a CDP URL. Anchor says its browser is built for sites that fight automation, with stealth, proxies, captcha solving and managed logins as options you turn on per session. Those are Anchor's claims; see [Anchor's docs](https://docs.anchorbrowser.io/) for what each one does and which plan it needs.

Tenki publishes `tenki/anchor:stable`: the standard [base image](https://tenki.cloud/docs/sandbox/base-image) plus `playwright-core` and an `anchor-smoke` command. It has no local browser, no Anchor API key and no browser profile. This example boots that image, uploads one script and runs it with the Anchor key in that one process's environment. Nothing is installed in the VM.

If you only need a browser for your own sites, or for a dev server inside the VM, you don't need Anchor. Run Chrome in the sandbox instead: see the [Chrome docs page](https://tenki.cloud/docs/sandbox/chrome).

## Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/anchor-browser-tenki
npm install
```

Every later command runs from this directory.

`npm install` installs one dependency on your machine: `@tenkicloud/sandbox` (`>=1.4.1`). `playwright-core` never installs locally. `anchor.mjs` imports the copy the image ships under `/home/tenki/node_modules`.

`run.mjs` uses top-level `await using`, which needs Node.js 24. `verify.mjs` uses `try`/`finally` instead, so it runs on Node 20.

## Authenticate

You need two keys:

```bash
export TENKI_API_KEY=tk_...                  # Tenki API key
export ANCHOR_API_KEY=...                    # from app.anchorbrowser.io/api-keys
```

- **Tenki:** a `tk_` API key from https://app.tenki.cloud. `run.mjs` builds the client with `new TenkiSandbox()`, which reads `TENKI_API_KEY` (or the alias `TENKI_AUTH_TOKEN`). `run.mjs` doesn't read the key that `tenki login` stores in `~/.config/tenki/config.yaml`; `verify.mjs` does. Tenki infers the workspace from the key.
- **Anchor:** an API key from https://app.anchorbrowser.io/api-keys. `run.mjs` stops with `Set ANCHOR_API_KEY` if it's missing.

### Where the Anchor key goes

`run.mjs` passes the key in the `env` of one `exec` call, the one that runs `node anchor.mjs`. It isn't in the session's environment, so other processes in the VM don't see it, and it isn't written to any file, image or template. `verify.mjs` checks both halves when the key is set: the session environment has no `ANCHOR_API_KEY`, and a later process doesn't either.

This is narrower than the [Anchor docs page](https://tenki.cloud/docs/sandbox/anchor), which passes the key to the whole session with `tenki sandbox create --env`. The CLI's `exec` has no per-process environment flag, so from the CLI the session is the narrowest scope. From the SDK, `ExecOptions.env` gets you one process.

The key is still inside the VM while `anchor.mjs` runs, where that process (and anything it runs) can read it. Tenki's [secret injection](https://tenki.cloud/docs/sandbox/secrets) would keep the real key outside the VM, but a VM with a secret policy attached couldn't open WebSocket connections in a test of the [TinyFish example](../tinyfish-tenki/), and `connectOverCDP` needs one. This example doesn't use it.

## Use it

`run.mjs` runs on your machine:

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

Run it:

```bash
node run.mjs
```

```text
{"url":"https://example.com/","title":"Example Domain"}
```

`writeFile` puts `anchor.mjs` in `/home/tenki`, the sandbox's working directory, which is where the image's `playwright-core` resolves from. `sandbox.exec` runs a binary with an argument list and no shell. `await using` terminates the sandbox when the script's scope ends.

`anchor.mjs` runs inside the VM. It follows the script on the [Anchor docs page](https://tenki.cloud/docs/sandbox/anchor#use-playwright-in-your-code), with two changes: it sets both of Anchor's session timeouts, and it checks that the session really ended.

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

To load a different page, change the URL that `run.mjs` passes to `node anchor.mjs`.

## Two lifetimes, two caps

A run has two things that cost money while they're alive: the Tenki sandbox and the Anchor browser session. Each has its own cap, so neither outlives a crashed script for long.

| | Ends normally when | Cap if cleanup never runs |
| --- | --- | --- |
| Tenki sandbox | `await using` disposes it as `run.mjs` exits | `maxDurationMs: 10 * 60_000`: Tenki terminates it after 10 minutes. Sandboxes don't pause on idle |
| Anchor session | `anchor.mjs` sends `DELETE /v1/sessions/{id}` in `finally` | `idle_timeout: 1`: Anchor ends it 1 minute after the last connection closes. `max_duration: 5`: Anchor ends it after 5 minutes regardless |

Anchor's timeouts are in minutes. Anchor's own pages disagree on the default `max_duration`: the [API reference](https://docs.anchorbrowser.io/api-reference/browser-sessions/start-browser-session) says 20 minutes and the [Session Timeout page](https://docs.anchorbrowser.io/advanced/session-timeout) says 180. Both say `idle_timeout` defaults to 5. Setting both explicitly means the example doesn't depend on which is right. Raise `max_duration` for a long agent task, and keep `maxDurationMs` above it.

## Turning on Anchor's features

The request body in `anchor.mjs` is where Anchor's session options go. With only the timeouts set, you get a default session: none of Anchor's stealth, proxy, captcha or login features is on. According to Anchor's docs:

- `session.proxy` (`{ active: true, country_code: "gb" }`) routes the session through Anchor's proxy.
- `browser.extra_stealth` is a Growth plan feature and needs the proxy active.
- `browser.captcha_solver` needs an active proxy or a browser profile.
- `browser.profile` (`{ name, persist: true }` on first use) saves cookies and storage after one login; reuse it by name.
- `identities` attaches stored credentials, and Anchor logs in before your code connects.

These are Anchor's features and descriptions. This example doesn't exercise them.

## Check it works

```bash
node verify.mjs
```

With `ANCHOR_API_KEY` set, it prints:

```text
✓ anchor-browser-tenki: boot tenki/anchor:stable → anchor-smoke on PATH → playwright-core <version> → no key in session env → Anchor session over CDP (Example Domain), key scoped to one process → dispose
```

Without it:

```text
✓ anchor-browser-tenki: boot tenki/anchor:stable → anchor-smoke on PATH → playwright-core <version> → no key in session env → ANCHOR_API_KEY unset, live Anchor leg skipped → dispose
```

[`verify.mjs`](verify.mjs) boots `tenki/anchor:stable`, checks that `anchor-smoke` is on PATH, imports `playwright-core` from `/home/tenki` and checks that `chromium.connectOverCDP` is a function, reads the installed `playwright-core` version, and checks that the session environment has no `ANCHOR_API_KEY`. That part needs only Tenki credentials and makes no Anchor call. With `ANCHOR_API_KEY` set, it also runs `anchor.mjs` with the key in that process's `env`, asserts the title is `Example Domain`, and checks that a later process in the same VM doesn't see the key. Without the key, it skips that leg and says so in the `✓` line. On any failure it prints a `✗` line and exits non-zero.

It reads the Tenki key from `TENKI_API_KEY`, then `TENKI_AUTH_TOKEN`, then the `auth_token` that `tenki login --api-key <key>` writes to `~/.config/tenki/config.yaml`. CI runs it with only `TENKI_API_KEY`, so CI covers the image and the key scoping, not the Anchor session.

`verify.mjs` checks that `anchor-smoke` exists but doesn't run it. To try it, use the CLI steps on the [Anchor docs page](https://tenki.cloud/docs/sandbox/anchor#start-a-session).

## Troubleshooting

- ❌ **`Set ANCHOR_API_KEY`.** `run.mjs` checks for the Anchor key before it boots anything. Export a key from https://app.anchorbrowser.io/api-keys.
- ❌ **`missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option` from `node run.mjs`.** `run.mjs` doesn't read `~/.config/tenki/config.yaml`, so `tenki login` alone isn't enough here. Export your `tk_` key.
- ❌ **``No token. Set TENKI_API_KEY, or run `tenki login`.``** `verify.mjs` found no Tenki key. Export a `tk_` key, or run `tenki login --api-key <key>`.
- ❌ **`node run.mjs` fails with a `SyntaxError` at `await using`.** Your Node is older than 24. Upgrade, or run `node verify.mjs` with `ANCHOR_API_KEY` set, which runs `anchor.mjs` the same way on Node 20.
- ❌ **`Anchor returned HTTP 401: {"error":"Invalid API Key"}`.** Anchor rejected the key. Check `ANCHOR_API_KEY` in the shell you ran from.
- ❌ **`Anchor returned HTTP 429: …`.** Anchor's API reference documents a 429 for "Session creation rate limit exceeded." Wait and retry, or check your plan's concurrency.
- ❌ **`Cannot find package 'playwright-core'`.** `anchor.mjs` ran outside `/home/tenki`, or the sandbox didn't boot from `tenki/anchor:stable`. Keep the `writeFile` path relative and the `image` option as written.
- ❌ **`✗ playwright-core import probe failed`.** The image no longer exposes `chromium.connectOverCDP`. Check the version `verify.mjs` printed, and pin an exact build (below).
- ❌ **`Anchor session <id> not ended: HTTP <status>`.** The `DELETE` failed. The session still ends one minute after its last connection closes (`idle_timeout: 1`), and after five minutes at most (`max_duration: 5`).
- ❌ **`TIMED_OUT: …`.** `anchor.mjs` took longer than the `exec` call's 3-minute `timeoutMs`. Raise it in `run.mjs` if your own script needs longer.

## FAQ

**When shouldn't I use this?** When the browser has to reach something only the VM can reach, such as a dev server on `localhost`, or when the sites you automate don't block headless Chromium. Then Chrome in the sandbox is simpler and keeps page content in your VM: see the [Chrome docs page](https://tenki.cloud/docs/sandbox/chrome).

**What happens if my script dies before cleanup?** See [Two lifetimes, two caps](#two-lifetimes-two-caps). Tenki ends the sandbox within 10 minutes and Anchor ends the browser session within 5. To stop a leftover sandbox sooner, run `tenki sandbox list` and `tenki sandbox terminate <session-id>`.

**How do I pin the image?** `stable` moves to each newly published build. Run `tenki sandbox registry resolve tenki/anchor:stable` once and pass `image: "tenki/anchor@<snapshot-id>"` to `createAndWait`. The [Anchor docs page](https://tenki.cloud/docs/sandbox/anchor#pin-an-exact-build) covers this.

**Can I use Anchor's own SDK?** Yes. Anchor publishes [`anchorbrowser`](https://www.npmjs.com/package/anchorbrowser) on npm. This example uses `fetch` against the REST API, as the Anchor docs page does, so the image's `playwright-core` is the only package it needs.

**Can I use Python?** Tenki's Python SDK is `tenki` (`pip install tenki`), and Anchor documents `pip install anchorbrowser playwright`. This example is JavaScript only, and the image ships the Node.js `playwright-core`.

## Related

- [Anchor docs page on tenki.cloud](https://tenki.cloud/docs/sandbox/anchor): the CLI path with `anchor-smoke`, and pinning a build
- [Anchor Browser docs](https://docs.anchorbrowser.io/): [create a session](https://docs.anchorbrowser.io/quickstart/create-session), [session timeouts](https://docs.anchorbrowser.io/advanced/session-timeout), [network and stealth](https://docs.anchorbrowser.io/network-and-stealth/overview), [managed authentication](https://docs.anchorbrowser.io/essentials/managed-authentication)
- [Chrome docs page on tenki.cloud](https://tenki.cloud/docs/sandbox/chrome): Chrome inside the sandbox instead, with CDP and noVNC
- [`../tinyfish-tenki/`](../tinyfish-tenki/): the same remote-browser-over-CDP shape with TinyFish
- [`../run-code-in-a-sandbox/`](../run-code-in-a-sandbox/): the basic boot, run and terminate loop
