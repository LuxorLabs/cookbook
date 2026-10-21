# TinyFish

Run [TinyFish](https://docs.tinyfish.ai/) web automation from a Tenki sandbox: fetch, search, a natural-language web agent that returns JSON, and a remote Chromium browser you drive over CDP. The sandbox boots from `tenki/tinyfish:stable`, which ships the TinyFish CLI, [`@tiny-fish/sdk`](https://www.npmjs.com/package/@tiny-fish/sdk), and `playwright-core`, so nothing installs in the VM. Your code runs in the sandbox; browsers and agents run at TinyFish.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "TinyFish" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/tinyfish-tenki, check that Node.js is 24 or later, and run npm install.
2. It needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) and TINYFISH_API_KEY (from https://agent.tinyfish.ai/api-keys). If either is missing, stop and ask me to export it. Never print the keys or write them to a file.
3. Run node run.mjs and confirm the fetch, search, and browser lines, then run node verify.mjs.
4. If a step fails, use the Troubleshooting table in the example's README.md.
Then ask me which site and data I want, and change tinyfish.mjs to get it with the TinyFish agent API or the remote browser.
```

## Quick start

You need:

- Node.js 24 or later for `run.mjs`, which uses top-level `await using`. `verify.mjs` runs on Node 20.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- A TinyFish API key from [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/tinyfish-tenki
npm install
```

This installs only `@tenkicloud/sandbox` locally.

### 2. Set your keys

```bash
export TENKI_API_KEY=tk_...
export TINYFISH_API_KEY=sk-tinyfish-...
```

`run.mjs` reads the Tenki key from the environment only (`TENKI_API_KEY` or `TENKI_AUTH_TOKEN`). `verify.mjs` also accepts a key saved with `tenki login --api-key <key>`.

### 3. Run

```bash
node run.mjs
```

```text
fetch: Example Domain
search: https://... https://... https://...
browser: Example Domain
```

### 4. Verify

```bash
node verify.mjs
```

```text
✓ tinyfish-tenki: boot tenki/tinyfish:stable → tinyfish CLI → import → fetch + search + remote browser over CDP (Example Domain) → dispose
```

`verify.mjs` boots the image, runs `tinyfish --version`, and checks that the SDK and `playwright-core` expose the methods this example uses. With `TINYFISH_API_KEY` set, it also runs `tinyfish.mjs` and checks all three lines. Without it, it skips the live TinyFish step and says so in the `✓` line.

## The code

`run.mjs` runs on your machine. It boots the sandbox, uploads `tinyfish.mjs`, and runs it:

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

- The image restores at 2 vCPU and 4096 MiB; smaller sizes are rejected.
- `maxDurationMs` makes Tenki end the sandbox after 10 minutes even if the script is killed.
- `writeFile` puts `tinyfish.mjs` in `/home/tenki`, next to the image's `node_modules`, so its imports resolve.

`tinyfish.mjs` runs inside the sandbox:

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

`@tiny-fish/sdk` is an ES module, so use `.mjs` or `"type": "module"`.

## Browser sessions

- **End every session in `finally`.** SDK 0.8.0 has no close method, so `tinyfish.mjs` calls TinyFish's [`DELETE` endpoint](https://docs.tinyfish.ai/browser-api/reference.md). It retries `409`, `429`, `500`, `503`, `504`, network errors, and 15-second timeouts up to three times, honoring `Retry-After` (up to 30 s), and throws if the session isn't confirmed ended.
- **`timeout_seconds` (5 to 86400) is an inactivity timeout.** A session with no CDP commands for that long ends on its own. Omitting it uses your plan's maximum. `tinyfish.mjs` sets 120.
- **Creating a session takes 10 to 30 seconds.** If you pass `url` to `sessions.create`, wait for the page to load before reading it.
- **Sessions use TinyFish's US residential proxy** unless you set `proxy_config` (`{ enabled: false }` connects directly).
- **The browser runs at TinyFish,** so it can't reach a dev server on the sandbox's `localhost`, and each Playwright action is a round trip.

## Ask the agent for data

Add this to `tinyfish.mjs` after the `client` line to try the agent API:

```js
const run = await client.agent.run({
  url: "https://news.ycombinator.com",
  goal: "Return the title and points of the top 3 stories as JSON.",
});
console.log(run.status, run.result); // COMPLETED { result: [ { title, points }, ... ] }
```

Pass `output_schema` (a JSON Schema with an object at the top level) to fix the answer's shape. `agent.stream()` emits progress events and a live preview URL; `agent.queue()` returns a `run_id` to poll with `client.runs.get()`.

From a shell in the sandbox, the `tinyfish` CLI prints JSON: `tinyfish agent run "<goal>" --url <url> --sync`, `tinyfish fetch content get <url> --format markdown`, `tinyfish search query "<terms>"`. `tinyfish-smoke https://example.com` is the image's own connectivity check.

## Keep the TinyFish key out of the VM

Passing the key through `env` puts it inside the VM, where any code there can read it. Tenki's [secret injection](https://tenki.cloud/docs/sandbox/secrets) shows the VM only a placeholder and swaps in the real key on outbound HTTPS to hosts you allow:

1. Save the key as a workspace secret (needs a Tenki key with Secrets access).
2. Create a request policy that allows it in the `X-API-Key` header, with `GET`, `POST`, and `DELETE` on path `/` for `https://agent.tinyfish.ai`, `https://api.search.tinyfish.ai`, `https://api.fetch.tinyfish.ai`, and `https://api.browser.tinyfish.ai`.
3. Pass `secretPolicies: ["<your policy>"]` and `env: { TINYFISH_API_KEY: "secrets://<secret name>" }` to `createAndWait`.

A sandbox with a secret policy can't open WebSockets, so `connectOverCDP` fails with `501 Not Implemented` (tested 2026-10-16). Fetch, search, the agent API, and creating and deleting sessions work. Use secret injection when you don't need the remote browser. This example passes the key through `env`, and `verify.mjs` doesn't test the injected path.

## Image versions

`tenki/tinyfish:stable` currently pins the CLI at 0.50.0 and the SDK at 0.8.0, and moves when Tenki publishes a new build. To pin the build you tested, run `tenki sandbox registry resolve tenki/tinyfish:stable` and pass `image: "tenki/tinyfish@<snapshot-id>"`. See [Tenki's TinyFish image](https://tenki.cloud/docs/sandbox/tinyfish).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Set TINYFISH_API_KEY` | Export a key from [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys). |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `run.mjs` reads only the environment. Export your `tk_` key. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| ``No token. Set TENKI_API_KEY, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `SyntaxError` at `await using` | Use Node 24, or run `verify.mjs` with `TINYFISH_API_KEY` set. |
| `snapshot restores with 2 vCPU / 4096 MiB` | Request at least 2 cores and 4096 MiB. |
| `✗ tinyfish --version: …` | The sandbox didn't boot from `tenki/tinyfish:stable`. Check `image`. |
| `✗ import probe: …` | The image's SDK changed. Check its version against `tinyfish.mjs`. |
| `✗ node tinyfish.mjs: exit <code>, …` | Run `node run.mjs` to see the full stderr. |
| `✗ fetch leg`, `✗ search leg`, or `✗ browser leg` | The message includes the script's output. Unset `TINYFISH_API_KEY` to check the Tenki half alone. |
| `TinyFish browser session <id> not confirmed ended: …` | The DELETE failed three times. The session still ends after `timeout_seconds` idle. |

To stop a leftover sandbox: `tenki sandbox list`, then `tenki sandbox terminate <session-id>`. For Python, use [`tinyfish`](https://pypi.org/project/tinyfish/) with Tenki's [`tenki`](https://pypi.org/project/tenki/) SDK.

## Related

- [TinyFish docs](https://docs.tinyfish.ai/) and the [Browser API reference](https://docs.tinyfish.ai/browser-api/reference.md)
- [`@tiny-fish/sdk`](https://www.npmjs.com/package/@tiny-fish/sdk) and [`@tiny-fish/cli`](https://www.npmjs.com/package/@tiny-fish/cli)
- [Run code in a sandbox](../run-code-in-a-sandbox/) and [Work with files](../files-in-a-sandbox/)
- [Tenki docs](https://tenki.cloud/docs)
