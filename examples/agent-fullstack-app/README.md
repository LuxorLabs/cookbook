# How to stand up and drive a full-stack app in a Tenki sandbox

**Audience:** Developers building or using an AI agent (Claude Code, another MCP client, or your own Node code) that has to start a web app, call its API, and show you the result somewhere other than your machine.
**Time:** ~5 minutes.
**Outcome:** A task-list app (a JSON API, an HTML frontend, and a SQLite database seeded with 5 tasks) running in one Tenki sandbox, its endpoints exercised, and a public HTTPS URL you can open in a browser.

> **Honesty note:** `run.mjs` leaves the sandbox running after it exits so you can open the URL. Sandboxes are billed per second, and this one runs until you terminate it or its 2-hour `maxDurationMs` cap ends it. `run.mjs` prints a command that terminates it sooner. `verify.mjs` always terminates its sandbox.

## Why bother

When you ask an agent to build and drive an app, it runs a loop: boot an environment, ship the code in, seed the data, start the server, hit the endpoints, expose the UI. This example runs that loop with the [Tenki](https://tenki.cloud) SDK, and every step maps to a tool in the [Tenki MCP server](https://www.npmjs.com/package/@tenkicloud/mcp). Claude or any MCP agent can run the same steps itself through that server, with no backend of yours orchestrating them.

## Install

You need Node.js 20 or later (CI runs this example on Node 20) and a Tenki API key. You don't need Python locally: the app runs on the sandbox's own `python3`.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/agent-fullstack-app
npm install
```

The only direct dependency is `@tenkicloud/sandbox` (`>=1.4.1`). Every later command runs from this directory.

## Authenticate

Create an API key at https://app.tenki.cloud. Keys start with `tk_`, and SDK 1.x accepts nothing else.

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY works too
```

`run.mjs` reads the key only from the environment. `verify.mjs` also falls back to the key that `tenki login --api-key <key>` stores in `~/.config/tenki/config.yaml`.

`TENKI_WORKSPACE_ID` is optional. Tenki infers the workspace from the key, and both scripts pass the variable to `createAndWait` only when it's set.

## Use it

```bash
node run.mjs   # leaves the sandbox up so you can open the URL
```

Run it from this directory: `run.mjs` reads `app/server.py` and `app/seed.py` by relative path.

It prints `seeded 5 tasks into /home/tenki/app.db`, then one line for each API call it makes from inside the sandbox (`GET /api/health`, `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/1`), then the public preview URL and `GET 200 · frontend served`. Open the URL and you'll see the task list, served from the sandbox.

The last line it prints is a `terminate now:` command with the sandbox ID filled in. Paste it from this directory, with your key still exported, to shut the sandbox down. If any step fails, `run.mjs` terminates the sandbox itself before exiting.

### What `run.mjs` does

It creates the sandbox with inbound traffic allowed and a lifetime cap:

```js
// allowInbound: the gateway routes public traffic to the sandbox (for the preview URL).
// This script deliberately leaves the sandbox running so you can open the URL, so
// set a billing guard: it self-terminates after 2 hours.
const sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  allowInbound: true,
  maxDurationMs: 2 * 60 * 60_000,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});
```

Inbound and outbound networking are both on by default in SDK 1.x (`create` defaults `allowInbound` and `allowOutbound` to `true`). The script sets `allowInbound: true` explicitly because the preview URL depends on it. Pass `allowOutbound: false` to cut a sandbox off from the network.

Then it ships the app in, seeds it, and starts the server:

```js
  // 1. Ship the app into the sandbox (agent: tenki_write_file).
  await sandbox.writeFile("server.py", readFileSync(new URL("app/server.py", import.meta.url), "utf8"));
  await sandbox.writeFile("seed.py", readFileSync(new URL("app/seed.py", import.meta.url), "utf8"));

  // 2. Seed the data that powers the backend (agent: tenki_exec).
  const seeded = await sandbox.exec("python3", { args: ["/home/tenki/seed.py"] });
  console.log(stdoutText(seeded).trim());

  // 3. Start the server detached so it outlives this exec() call.
  await sandbox.exec("sh", {
    args: ["-c", "cd /home/tenki && setsid python3 server.py >/tmp/app.log 2>&1 </dev/null & sleep 1"],
  });
```

Three things to know here:

- The SDK's file methods are confined to `/home/tenki`, the sandbox's working directory, so `writeFile("server.py", …)` lands at `/home/tenki/server.py`. Use relative paths or paths under `/home/tenki`. Shell commands run through `exec` can write anywhere, which is why the server log can go to `/tmp/app.log`.
- `exec(cmd, { args })` runs a binary with no shell. Anything that needs shell syntax (`cd`, `&&`, redirects, `&`) goes through `sh -c`.
- Detach long-running servers with `setsid … &` so they outlive the `exec` that started them.

Step 4 calls the API with `python3 -c` and `urllib` from inside the sandbox. Step 5 exposes the port:

```js
  // 5. Expose the frontend so a human (or the agent) can open the live UI.
  const { previewUrl } = await sandbox.exposePort(PORT);
```

### The app

Stdlib-only Python (`http.server` + `sqlite3`), so it boots with no install step. `app/server.py` listens on port 8000:

- `GET /` — the frontend (HTML + JS that fetches `/api/tasks`)
- `GET /api/tasks` — list tasks
- `POST /api/tasks` — create a task: `{"title": "...", "status": "todo"}`
- `PATCH /api/tasks/<id>` — update its status: `{"status": "done"}`
- `GET /api/health` — `{"ok": true, "tasks": N}`

`POST` and `PATCH` are accepted only from inside the sandbox, where the agent's calls come from `127.0.0.1`. Traffic through the preview URL arrives from Tenki's gateway at a non-loopback address, so a write sent there gets `403`, and a body that isn't a JSON object gets `400`. The frontend renders task titles as text, not HTML.

`app/seed.py` creates `/home/tenki/app.db` with 5 tasks, the data behind the backend.

Swap in FastAPI, Express, or Next and Postgres and the shape is the same; the sandbox doesn't care which framework serves the port.

## Let an agent run the same steps

Each step in `run.mjs` has a matching tool in the Tenki MCP server:

| Step | This example | Agent does it with |
| --- | --- | --- |
| Boot an isolated environment | `createAndWait({ allowInbound: true })` | `tenki_create_sandbox` |
| Ship the app in | `sandbox.writeFile(...)` | `tenki_write_file` |
| Seed the data | `exec python3 seed.py` | `tenki_exec` |
| Start the server | `exec sh -c "setsid python3 server.py &"` | `tenki_exec` |
| Hit the endpoints | GET/POST/PATCH `/api/tasks` | `tenki_exec` |
| Expose the UI | `sandbox.exposePort(8000)` | `tenki_expose_port` |

To give Claude Code these tools, add the server with the command from the [tenki-mcp README](https://github.com/LuxorLabs/tenki-mcp):

```bash
claude mcp add tenki --env TENKI_API_KEY=tk_your_key_here -- npx -y @tenkicloud/mcp
```

The local server needs Node 22 or later. The tenki-mcp README also covers its hosted endpoint and other clients, and [mcp-tenki-sandbox](../mcp-tenki-sandbox/) shows the config for Claude Desktop and Cursor.

**One difference from the SDK:** `tenki_create_sandbox` sends `allow_inbound` only when the agent passes it, and the tool's own schema describes inbound networking as off by default. Have the agent pass `allow_inbound: true`, since the preview URL needs inbound access, and `max_duration_seconds` for the same lifetime cap `maxDurationMs` sets here.

## Check it works

```bash
node verify.mjs
```

```
✓ agent-fullstack-app: seed 5 → serve → health ok → POST → PATCH → 6 tasks → bad body 400 → frontend 200 → public POST 403 at <preview-host>
```

`<preview-host>` is the host of that run's preview URL. The check runs the same SDK steps as `run.mjs` and asserts each one: the seed reports 5 tasks, health is ok, `POST` creates a task, `PATCH` marks it done, the list has 6 tasks, a non-object body gets 400, the preview URL returns 200 with a `<title>` when fetched from the public internet, and a `POST` through the preview URL gets 403. It then terminates the sandbox, pass or fail. It calls the SDK directly and needs no model key, so the MCP path and the agent itself aren't exercised, and the page is fetched but not rendered in a browser. CI runs it on Node 20 with only `TENKI_API_KEY` set.

## Troubleshooting

**❌ `` No token. Set TENKI_AUTH_TOKEN, or run `tenki login`. ``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export one, or run `tenki login --api-key <key>`.

**❌ `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option`.** `run.mjs` reads the key only from the environment, not from `~/.config/tenki/config.yaml`. Export `TENKI_AUTH_TOKEN` (or `TENKI_API_KEY`) in the shell you run it from.

**❌ `invalid auth token - API keys and service tokens must start with tk_`.** SDK 1.x accepts only `tk_` API keys. Create one at https://app.tenki.cloud and export it.

**❌ `error: ENOENT: no such file or directory, open 'app/server.py'`.** You ran `run.mjs` from another directory, and it reads the app files by relative path. `cd` into `cookbook/examples/agent-fullstack-app` and run it again. `verify.mjs` resolves the files relative to itself, so it works from anywhere.

**❌ `permission_denied … path outside workdir`.** A `writeFile` or `readFile` path points outside `/home/tenki`, where the SDK's file methods are confined. Use a relative path or one under `/home/tenki`, or write the file with a shell command through `exec`.

**❌ `InboundDisabledError` (`inbound access is disabled`).** The sandbox was created with inbound networking off, and the preview URL needs it. Keep `allowInbound: true` in `createAndWait`, or pass `allow_inbound: true` to `tenki_create_sandbox`.

## FAQ

**When shouldn't I use this?**
When the app has to outlive a sandbox or face real users as is. The app has no auth: `exposePort(8000)` publishes the whole server, so anyone with the URL can read every task, and writes are limited by source address, not by user. The data is a SQLite file inside a disposable sandbox, and it's gone when the sandbox terminates unless you snapshot it first.

**How do I stop the sandbox `run.mjs` left running?**
Paste the `terminate now:` command it printed, from this directory with your key exported. Otherwise the 2-hour `maxDurationMs` cap terminates it.

**How do I keep the seeded state for later runs?**
Snapshot the sandbox and resume it later; see [snapshots-pause-resume](../snapshots-pause-resume/). Pausing is free, and a paused sandbox keeps its memory and disk.

**Can I split the API, a worker, and the database into separate services?**
One sandbox can run several processes that talk to each other over `localhost`, which is usually what you want. For per-service isolation, run one sandbox per service, `exposePort()` each, and pass the URLs as config. Sandboxes reach each other over those public URLs, through the public gateway. Outbound networking is on by default, so don't set `allowOutbound: false` on any sandbox that calls another.

## Related

- [tenki-mcp](https://github.com/LuxorLabs/tenki-mcp) ([`@tenkicloud/mcp` on npm](https://www.npmjs.com/package/@tenkicloud/mcp)): the MCP server whose tools the table maps to.
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox): the SDK `run.mjs` and `verify.mjs` use.
- [Tenki docs](https://tenki.cloud/docs). Product used: Tenki Sandbox, more at [tenki.cloud](https://tenki.cloud).
- [snapshots-pause-resume](../snapshots-pause-resume/): keep a sandbox's state across runs.
- [mcp-tenki-sandbox](../mcp-tenki-sandbox/): wire the Tenki MCP server into Claude Desktop, Cursor, or Claude Code.
