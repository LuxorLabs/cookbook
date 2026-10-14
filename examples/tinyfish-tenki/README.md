# TinyFish web agents from a Tenki sandbox

[TinyFish](https://docs.tinyfish.ai/) runs web automation for agents: a natural-language **agent** that browses a page and returns JSON, a remote Chromium **browser** you drive over CDP, **fetch** (up to 10 URLs per call as markdown, HTML, or JSON), and **search**. This example runs the TinyFish TypeScript SDK ([`@tiny-fish/sdk`](https://www.npmjs.com/package/@tiny-fish/sdk)) and `playwright-core` inside a [Tenki](https://tenki.cloud) microVM: your code runs in the sandbox, and the browsers and agents run at TinyFish.

## How it fits together

`run.mjs` (on your machine) boots a sandbox, passes `TINYFISH_API_KEY` into the session environment, installs the two npm packages, uploads `tinyfish.mjs`, and runs it. `tinyfish.mjs` (in the VM) calls fetch and search, then opens a TinyFish browser session and loads a page through Playwright.

```js
// run.mjs: the key goes to this session only, never into an image or template
await using sandbox = await tenki.createAndWait({
  cpuCores: 2,
  memoryMb: 2048,
  env: { TINYFISH_API_KEY: process.env.TINYFISH_API_KEY },
});

await sandbox.exec("npm", {
  args: ["install", "--no-audit", "--no-fund", "@tiny-fish/sdk@0.8.0", "playwright-core@1.64.1"],
});
await sandbox.writeFile("tinyfish.mjs", readFileSync(new URL("./tinyfish.mjs", import.meta.url)));
const result = await sandbox.exec("node", { args: ["tinyfish.mjs", "https://example.com"] });
```

`playwright-core` doesn't download a browser. It only connects to TinyFish's remote Chromium over CDP, so the install is small.

## The code inside the VM (`tinyfish.mjs`)

```js
import { TinyFish } from "@tiny-fish/sdk";
import { chromium } from "playwright-core";

const client = new TinyFish(); // reads TINYFISH_API_KEY
const url = process.argv[2] ?? "https://example.com";

const fetched = await client.fetch.getContents({ urls: [url], format: "markdown" });
console.log("fetch:", fetched.results[0]?.title);

const found = await client.search.query({ query: "remote browser for AI agents" });
console.log("search:", found.results.slice(0, 3).map((r) => r.url).join(" "));

const session = await client.browser.sessions.create({ timeout_seconds: 120 });
let browser;
try {
  browser = await chromium.connectOverCDP(session.cdp_url);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url);
  console.log("browser:", await page.title());
} finally {
  await browser?.close();
  await fetch(`https://api.browser.tinyfish.ai/${session.session_id}`, {
    method: "DELETE",
    headers: { "X-API-Key": process.env.TINYFISH_API_KEY },
  });
}
```

Always end the browser session in `finally`. The SDK has no close method, so call TinyFish's [`DELETE` endpoint](https://docs.tinyfish.ai/browser-api/reference.md) directly. `timeout_seconds` (5 to 86400) is the inactivity timeout, so a session your code fails to close still ends soon after.

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=tk_...                   # Tenki API key
export TINYFISH_API_KEY=sk-tinyfish-...          # from agent.tinyfish.ai/api-keys
node run.mjs
# fetch: Example Domain
# search: https://... https://... https://...
# browser: Example Domain
```

## Ask the agent for data

The same client exposes the agent API. Give it a URL and a goal, and it returns JSON with no selectors to maintain:

```js
const run = await client.agent.run({
  url: "https://news.ycombinator.com",
  goal: "Return the title and points of the top 3 stories as JSON.",
});
console.log(run.status, run.result); // COMPLETED { result: [ { title, points }, ... ] }
```

Pass `output_schema` (a JSON Schema with an object at the top level) to fix the shape of the answer. `agent.stream()` emits progress events and a live preview URL, and `agent.queue()` returns a `run_id` you poll with `client.runs.get()`.

## Verify

```bash
npm install
node verify.mjs
```

[`verify.mjs`](verify.mjs) boots a sandbox, installs `@tiny-fish/sdk` and `playwright-core`, and checks that both import and expose the methods this example uses. That part needs only Tenki credentials. With `TINYFISH_API_KEY` set, it also runs `tinyfish.mjs` in the VM and asserts the fetch, search, and remote-browser results. Without the key, it skips that step and says so.

## Notes

- **Network:** the sandbox talks to TinyFish over the public internet, so a TinyFish browser can't reach a dev server on `localhost` inside your VM. Every Playwright action is a round trip to TinyFish's browser.
- **Session startup:** creating a TinyFish browser session typically takes 10 to 30 seconds. If you pass `url` to `sessions.create`, the call returns before that first navigation finishes, so wait for the page to load before reading it.
- **Proxy:** browser sessions use TinyFish's US residential proxy unless you set `proxy_config` (`{ enabled: false }` connects directly).
- **ESM only:** `@tiny-fish/sdk` is an ES module. Use `.mjs` files or `"type": "module"`.
- **Python:** the official Python SDK is [`tinyfish`](https://pypi.org/project/tinyfish/) on PyPI (`pip install tinyfish`), with the same `client.browser.sessions.create(...)` shape.
- **CLI:** [`@tiny-fish/cli`](https://www.npmjs.com/package/@tiny-fish/cli) installs a `tinyfish` command (`tinyfish agent run "<goal>" --url <url> --sync`, `tinyfish fetch content get <url> --format markdown`, `tinyfish search query "<terms>"`) that prints JSON, which suits an agent shelling out from the sandbox.
- **Pre-built image:** Tenki is preparing a `tenki/tinyfish:stable` image with the CLI, SDK, and `playwright-core` preinstalled. It isn't published yet, so this example installs the packages itself.
