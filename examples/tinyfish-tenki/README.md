# How to run TinyFish web agents and remote browsers from a Tenki sandbox

`node run.mjs` boots a Tenki sandbox from `tenki/tinyfish:stable` and prints one line each from TinyFish fetch, TinyFish search, and a page loaded in TinyFish's remote Chromium. `node verify.mjs` prints a `✓` line.

About 5 minutes.

The browser runs at TinyFish. The sandbox drives it over the public internet. It cannot reach a dev server on `localhost` inside the sandbox, and every Playwright action is a round trip to TinyFish's browser.

## Why bother

[TinyFish](https://docs.tinyfish.ai/) runs web automation for agents: a natural-language agent that browses a page and returns JSON, a remote Chromium browser you drive over the Chrome DevTools Protocol (CDP), fetch (up to 10 URLs per call as markdown, HTML, or JSON), and search.

This example starts a [Tenki](https://tenki.cloud) sandbox from the public image `tenki/tinyfish:stable`. That image ships the TinyFish CLI, the TypeScript SDK ([`@tiny-fish/sdk`](https://www.npmjs.com/package/@tiny-fish/sdk)), and `playwright-core` under `/home/tenki/node_modules`. Your code runs in the sandbox, and the browsers and agents run at TinyFish. `playwright-core` doesn't download a browser. It only connects to TinyFish's remote Chromium over CDP. Your TinyFish key goes into one sandbox session's environment, never into an image or template. The image currently pins the CLI at 0.50.0 and the SDK at 0.8.0. The `stable` tag moves when Tenki publishes a new build.

## Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/tinyfish-tenki
npm install
```

Every later command runs from this directory.

`npm install` installs one direct dependency on your machine: `@tenkicloud/sandbox` (`>=1.4.1`). The TinyFish packages never install locally, and nothing is installed inside the VM. `tenki/tinyfish:stable` already has them. The image restores at 2 vCPU and 4096 MiB, and a smaller `cpuCores` or `memoryMb` is rejected, so both scripts request that size.

`run.mjs` uses top-level `await using`, which needs Node.js 24. Node 22 can't parse it. `verify.mjs` uses `try`/`finally` instead, so it runs on Node 20.

## Authenticate

You need two keys:

```bash
export TENKI_API_KEY=tk_...                      # Tenki API key
export TINYFISH_API_KEY=sk-tinyfish-...          # from agent.tinyfish.ai/api-keys
```

- **Tenki:** a `tk_` API key from https://app.tenki.cloud. `run.mjs` builds the client with `new TenkiSandbox()`, which reads `TENKI_API_KEY` (or `TENKI_AUTH_TOKEN`) from the environment. `run.mjs` doesn't read the key that `tenki login` stores in `~/.config/tenki/config.yaml`; `verify.mjs` does. With a workspace API key you don't need `TENKI_WORKSPACE_ID`, because Tenki infers the workspace from the key. `verify.mjs` passes it through if you set it.
- **TinyFish:** a key from https://agent.tinyfish.ai/api-keys. `run.mjs` stops with `Set TINYFISH_API_KEY` if it's missing, then hands the key to the sandbox through `createAndWait`'s `env`.

### Keeping the TinyFish key out of the VM

Passing the key through `env` puts the real key inside the VM, where any code running there can read it. That's fine for a demo you run yourself. Tenki's [secret injection](https://tenki.cloud/docs/sandbox/secrets) avoids it: the VM sees only a placeholder, and Tenki swaps in the real key on outbound HTTPS requests to hosts you allow. The steps:

1. Save the key as a workspace secret. This needs a Tenki API key with Secrets access.
2. Create a request policy that allows the secret in the `X-API-Key` header, which is where `@tiny-fish/sdk` sends it. Add one rule per TinyFish host, each with methods `GET`, `POST` and `DELETE` and path prefix `/`:
   - `https://agent.tinyfish.ai`
   - `https://api.search.tinyfish.ai`
   - `https://api.fetch.tinyfish.ai`
   - `https://api.browser.tinyfish.ai`, for the browser-session `DELETE`
3. Pass `secretPolicies: ["<your policy>"]` to `createAndWait`, and set `env: { TINYFISH_API_KEY: "secrets://<secret name>" }`.

**It breaks the remote browser.** A live test on 2026-10-16 found:
- **The HTTPS calls work:** fetch, search, and creating and deleting a browser session, while the VM only saw the placeholder.
- **The browser step fails:** Playwright's `connectOverCDP` gets `501 Not Implemented`, because a VM with a secret policy attached can't open WebSocket connections. A WebSocket to an unrelated echo server failed the same way, and succeeded from a VM with no policy.

So this example passes the key through `env`, which the browser step needs. Use secret injection when your code calls only TinyFish's HTTPS APIs (fetch, search, agent). `verify.mjs` doesn't test the injected path.

## Use it

`run.mjs` runs on your machine. It boots a sandbox from `tenki/tinyfish:stable`, uploads `tinyfish.mjs`, and runs it:

```js
// Boot a Tenki sandbox from tenki/tinyfish:stable and run tinyfish.mjs inside it.
import { TenkiSandbox, stdoutText, stderrText } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";

if (!process.env.TINYFISH_API_KEY) throw new Error("Set TINYFISH_API_KEY");

const tenki = new TenkiSandbox(); // reads TENKI_API_KEY

// The key lives in this session's environment only, never in an image or template.
// tenki/tinyfish:stable restores at 2 vCPU / 4096 MiB; a smaller size is rejected.
// maxDurationMs is a hard cap: Tenki ends the sandbox after 10 minutes even if this script dies.
await using sandbox = await tenki.createAndWait({
  image: "tenki/tinyfish:stable",
  cpuCores: 2,
  memoryMb: 4096,
  maxDurationMs: 10 * 60_000,
  env: { TINYFISH_API_KEY: process.env.TINYFISH_API_KEY },
});

await sandbox.writeFile("tinyfish.mjs", readFileSync(new URL("./tinyfish.mjs", import.meta.url)));
const result = await sandbox.exec("node", { args: ["tinyfish.mjs", "https://example.com"] });
if (result.exitCode !== 0) throw new Error(stderrText(result));
console.log(stdoutText(result).trim());
```

Run it:

```bash
node run.mjs
```

```text
fetch: Example Domain
search: https://... https://... https://...
browser: Example Domain
```

`sandbox.exec` runs a binary with an argument list and no shell, which is why `node` takes `args`. Wrap a command in `sh -c` if you need shell syntax. `writeFile` puts `tinyfish.mjs` in the sandbox's working directory, `/home/tenki`, next to the image's `node_modules`, so `node tinyfish.mjs` imports `@tiny-fish/sdk` and `playwright-core` with no install. The SDK's file methods can't write outside that directory. `await using` terminates the sandbox when the script's scope ends.

`tinyfish.mjs` runs inside the VM. It calls fetch and search, then opens a TinyFish browser session and loads the page through Playwright:

```js
// Runs inside the sandbox. TinyFish runs the browser; this VM runs the code.
import { TinyFish } from "@tiny-fish/sdk";
import { chromium } from "playwright-core";

const client = new TinyFish(); // reads TINYFISH_API_KEY
const url = process.argv[2] ?? "https://example.com";

// The SDK has no close method, so end the session with TinyFish's DELETE endpoint. TinyFish says a
// 409, 500, 503 or 504 means termination wasn't confirmed and to retry; on 429 or 503, wait for Retry-After.
// A network error or a request with no response in 15 seconds is retried too.
async function endSession(id) {
  for (let attempt = 1; ; attempt++) {
    let res, failure;
    try {
      res = await fetch(`https://api.browser.tinyfish.ai/${id}`, {
        method: "DELETE",
        headers: { "X-API-Key": process.env.TINYFISH_API_KEY },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return;
      failure = `HTTP ${res.status}`;
    } catch (err) {
      failure = err.cause?.message ?? err.message;
    }
    if ((res && ![409, 429, 500, 503, 504].includes(res.status)) || attempt === 3) {
      throw new Error(`TinyFish browser session ${id} not confirmed ended: ${failure}`);
    }
    const wait = Math.min(Number(res?.headers.get("retry-after")) || attempt, 30);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}

const fetched = await client.fetch.getContents({ urls: [url], format: "markdown" });
console.log("fetch:", fetched.results[0]?.title);

const found = await client.search.query({ query: "remote browser for AI agents" });
console.log("search:", found.results.slice(0, 3).map((r) => r.url).join(" "));

// timeout_seconds caps how long an idle session lives if cleanup never runs.
const session = await client.browser.sessions.create({ timeout_seconds: 120 });
let browser;
try {
  browser = await chromium.connectOverCDP(session.cdp_url);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url);
  console.log("browser:", await page.title());
} finally {
  // End the session even if closing the CDP connection throws.
  try {
    await browser?.close();
  } finally {
    await endSession(session.session_id);
  }
}
```

`new TinyFish()` reads `TINYFISH_API_KEY` from the environment that `run.mjs` set. `@tiny-fish/sdk` is an ES module, so use `.mjs` files or `"type": "module"`. To load a different page, change the URL that `run.mjs` passes to `node tinyfish.mjs`.

## How a TinyFish browser session starts and ends

- **Always end the browser session in `finally`.** `@tiny-fish/sdk` 0.8.0 has no close method (its `browser.sessions` resource has only `create`), so `tinyfish.mjs` calls TinyFish's [`DELETE` endpoint](https://docs.tinyfish.ai/browser-api/reference.md) directly. TinyFish documents that a `409`, `500`, `503`, or `504` from that call means termination wasn't confirmed and you should retry the delete. On a `503` or a `429` rate limit, wait for `Retry-After` before retrying. `tinyfish.mjs` does that: `endSession` retries those codes up to three times, waiting for `Retry-After` when TinyFish sends it (at most 30 seconds). It also retries a network error, and a request that gets no response within 15 seconds. It throws if the session still isn't confirmed ended. A session that fails to close then fails the run instead of passing quietly.
- **`timeout_seconds` (5 to 86400) is the inactivity timeout**, so a session your code fails to close still ends once it has been idle that long. TinyFish counts a session as inactive when no CDP commands are being sent. If you omit `timeout_seconds`, or pass more than your plan allows, your plan's maximum applies. `tinyfish.mjs` sets 120.
- **Creating a TinyFish browser session typically takes 10 to 30 seconds.** If you pass `url` to `sessions.create`, the call returns before that first navigation finishes, so wait for the page to load before reading it. `tinyfish.mjs` creates the session without a `url` and navigates with `page.goto`.
- **Browser sessions use TinyFish's US residential proxy** unless you set `proxy_config` (`{ enabled: false }` connects directly).

## Ask the agent for data

The same client exposes the agent API. Give it a URL and a goal, and it returns JSON with no selectors to maintain. This snippet isn't part of the example's scripts; to try it, add it to `tinyfish.mjs` after the `client` line:

```js
const run = await client.agent.run({
  url: "https://news.ycombinator.com",
  goal: "Return the title and points of the top 3 stories as JSON.",
});
console.log(run.status, run.result); // COMPLETED { result: [ { title, points }, ... ] }
```

Pass `output_schema` (a JSON Schema with an object at the top level) to fix the shape of the answer. `agent.stream()` emits progress events and a live preview URL, and `agent.queue()` returns a `run_id` you poll with `client.runs.get()`.

## Check it works

```bash
node verify.mjs
```

With `TINYFISH_API_KEY` set, it prints:

```text
✓ tinyfish-tenki: boot tenki/tinyfish:stable → tinyfish CLI → import → fetch + search + remote browser over CDP (Example Domain) → dispose
```

Without it:

```text
✓ tinyfish-tenki: boot tenki/tinyfish:stable → tinyfish CLI → import → TINYFISH_API_KEY unset, live TinyFish leg skipped → dispose
```

[`verify.mjs`](verify.mjs) boots a sandbox from `tenki/tinyfish:stable`, runs `tinyfish --version`, and checks that `@tiny-fish/sdk` and `playwright-core` import and expose the methods this example uses: `browser.sessions.create`, `fetch.getContents`, `search.query`, `agent.run`, and `chromium.connectOverCDP`. That part needs only Tenki credentials. The probe builds the client with a placeholder key and makes no TinyFish call. With `TINYFISH_API_KEY` set, it also runs `tinyfish.mjs` in the VM and asserts the `fetch: Example Domain`, `search: https://…`, and `browser: Example Domain` lines. Without the key, it skips that step and says so in the `✓` line. On any failure it prints a `✗` line and exits non-zero.

It reads the Tenki key from `TENKI_API_KEY`, then `TENKI_AUTH_TOKEN`, then the `auth_token` that `tenki login --api-key <key>` writes to `~/.config/tenki/config.yaml`. CI runs it on Node 20 with only `TENKI_API_KEY`, so CI covers the image boot, the CLI, and the import check, not the live TinyFish calls.

A pass with both keys proves that fetch, search, and a remote-browser page load work from inside a Tenki sandbox with your keys. It doesn't run `run.mjs` itself, and it only checks that `agent.run` exists, not that an agent run succeeds.

## Troubleshooting

- ❌ **`Set TINYFISH_API_KEY`.** `run.mjs` checks for the TinyFish key before it boots anything. Export a key from https://agent.tinyfish.ai/api-keys in the shell you run it from.
- ❌ **`missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option` from `node run.mjs`.** Neither variable is set, and `run.mjs` doesn't read `~/.config/tenki/config.yaml`, so `tenki login` alone isn't enough here. Export your `tk_` key.
- ❌ **`invalid auth token - API keys and service tokens must start with tk_`.** Tenki SDK 1.x accepts only `tk_` API keys. Create one at https://app.tenki.cloud.
- ❌ **``No token. Set TENKI_API_KEY, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_API_KEY`, `TENKI_AUTH_TOKEN`, or `~/.config/tenki/config.yaml`. Export a `tk_` key, or run `tenki login --api-key <key>`.
- ❌ **`node run.mjs` fails with a `SyntaxError` at `await using`.** Your Node is older than 24 and can't parse top-level `await using`. Upgrade to Node 24, or run `node verify.mjs` with `TINYFISH_API_KEY` set, which runs `tinyfish.mjs` in a sandbox the same way and works on Node 20. `verify.mjs` prints only the `✓` line, not the three output lines.
- ❌ **`snapshot restores with 2 vCPU / 4096 MiB`.** `tenki/tinyfish:stable` needs at least that size. Both scripts request 2 cores and 4096 MiB. A smaller `cpuCores` or `memoryMb` is rejected.
- ❌ **`✗ tinyfish --version: …`.** The sandbox did not boot from `tenki/tinyfish:stable`, so the `tinyfish` command is missing. Check the `image` passed to `createAndWait`.
- ❌ **`✗ import probe: …`.** One of the five methods isn't a function in the image's packages. The image currently pins `@tiny-fish/sdk` at 0.8.0. If this fails after Tenki republishes `stable`, check that build's SDK against the calls in `tinyfish.mjs`.
- ❌ **`✗ node tinyfish.mjs: exit <code>, …`.** `tinyfish.mjs` threw inside the VM, and the message ends with the last 400 characters of its stderr. Run `node run.mjs` to see the full stderr.
- ❌ **`✗ fetch leg: …`, `✗ search leg: …`, or `✗ browser leg: …`.** `tinyfish.mjs` ran, but a line didn't match what `verify.mjs` expects. The message includes the script's full output, so you can see which TinyFish call returned something else. Unset `TINYFISH_API_KEY` to check the Tenki half on its own.
- ❌ **`TinyFish browser session <id> not confirmed ended: …`.** The `DELETE` that ends the browser session didn't succeed after three tries, or returned a status TinyFish doesn't document as retryable. The message ends with the last failure: `HTTP <status>`, a network error, or `The operation was aborted due to timeout`. The session still ends once it has had no CDP commands for `timeout_seconds` (120 here). Check the status code against TinyFish's [Browser API reference](https://docs.tinyfish.ai/browser-api/reference.md).

## FAQ

**When shouldn't I use this?** When the browser has to reach something that exists only inside the VM, such as a dev server on `localhost`: TinyFish's browser runs at TinyFish, outside the sandbox. Also when you want Chromium running in the sandbox itself. The image ships `playwright-core`, which doesn't download a browser, so every Playwright action is a round trip to TinyFish.

**What happens if my script dies before cleanup?** The TinyFish browser session ends once it has had no CDP commands for `timeout_seconds` (120 here). The Tenki sandbox is different: `await using` doesn't run if the process is killed, and Tenki doesn't pause idle sandboxes, so it keeps running. Both scripts pass `maxDurationMs: 10 * 60_000` to `createAndWait`, so Tenki ends the sandbox after 10 minutes even if the script dies first. Raise it if your own script needs longer. To find and stop a leftover sandbox, run `tenki sandbox list` and then `tenki sandbox terminate <session-id>`.

**Can I use Python?** The official TinyFish Python SDK is [`tinyfish`](https://pypi.org/project/tinyfish/) on PyPI (`pip install tinyfish`), with the same `client.browser.sessions.create(...)` shape. This example is JavaScript only. Tenki's Python SDK is `tenki` (`pip install tenki`).

**Can an agent in the sandbox call TinyFish from a shell?** Yes. The image puts [`tinyfish`](https://www.npmjs.com/package/@tiny-fish/cli) on `PATH`. It prints JSON to stdout by default: `tinyfish agent run "<goal>" --url <url> --sync`, `tinyfish fetch content get <url> --format markdown`, `tinyfish search query "<terms>"`. The image's Node is 24, which the CLI requires. `tinyfish-smoke https://example.com` is the image's own connectivity check: the SDK opens a browser session, Playwright loads the page, and the CLI closes it. The scripts in this example call the SDK directly.

**Can I pin the image build?** `tenki/tinyfish:stable` moves to each newly published build. To stay on the build you tested, run `tenki sandbox registry resolve tenki/tinyfish:stable` and pass `image: "tenki/tinyfish@<snapshot-id>"` to `createAndWait`. A snapshot reference stays put after `stable` advances. This example uses the moving tag. `verify.mjs` checks that `tinyfish --version` runs and that the five methods the script calls are still functions.

## Related

- [TinyFish docs](https://docs.tinyfish.ai/), and the [Browser API reference](https://docs.tinyfish.ai/browser-api/reference.md) for session creation, the `DELETE` endpoint, and the inactivity timeout
- [`@tiny-fish/sdk` on npm](https://www.npmjs.com/package/@tiny-fish/sdk), [`tinyfish` on PyPI](https://pypi.org/project/tinyfish/), [`@tiny-fish/cli` on npm](https://www.npmjs.com/package/@tiny-fish/cli)
- [Tenki's TinyFish image](https://tenki.cloud/docs/sandbox/tinyfish)
- [Tenki docs](https://tenki.cloud/docs)
- [`../run-code-in-a-sandbox/`](../run-code-in-a-sandbox/): the basic boot, run, and terminate loop with `@tenkicloud/sandbox`.
- [`../files-in-a-sandbox/`](../files-in-a-sandbox/): the SDK's file API, which `run.mjs` uses to upload `tinyfish.mjs`.
